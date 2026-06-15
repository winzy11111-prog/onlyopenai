// ╔═══════════════════════════════════════════════════════════╗
// ║  openai-admin.js                                          ║
// ║  Thin wrapper around the OpenAI Admin API.                ║
// ║  All calls require OPENAI_ADMIN_KEY (sk-admin-…) in .env. ║
// ╚═══════════════════════════════════════════════════════════╝
//
// Exports
// ───────
//   isEnabled()                          → boolean
//   createProject(name)                  → { id, name, status, ... }
//   archiveProject(projectId)            → { id, status: 'archived', ... }
//   createServiceAccount(projectId, name) → { id, name, api_key: { value, ... } }
//   listProjects(limit?)                 → [ {id, name, …} ]
//
// Design notes
// ────────────
// • All errors are turned into Error instances with a `.status` and `.openai`
//   payload so callers can distinguish "OpenAI rejected the request" from
//   "network is down".
// • We deliberately do NOT cache anything here — caching belongs to the route
//   that owns the data (so its TTL/invalidation logic stays in one place).
// • Service-account name pattern: 'dashboard-sa' so we can find it later.

const ADMIN_KEY = process.env.OPENAI_ADMIN_KEY || '';
const BASE = 'https://api.openai.com';

function isEnabled() { return !!ADMIN_KEY; }

async function call(method, path, body) {
    if (!ADMIN_KEY) {
        const err = new Error('OPENAI_ADMIN_KEY not configured');
        err.status = 500;
        throw err;
    }
    const res = await fetch(BASE + path, {
        method,
        headers: {
            Authorization: 'Bearer ' + ADMIN_KEY,
            'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try { json = await res.json(); } catch (_) { /* empty body */ }
    if (!res.ok) {
        const msg = json?.error?.message || `HTTP ${res.status}`;
        const err = new Error(`OpenAI Admin: ${method} ${path} → ${msg}`);
        err.status = res.status;
        err.openai = json?.error || json;
        throw err;
    }
    return json;
}

// ── Projects ──────────────────────────────────────────────
async function createProject(name) {
    if (!name || !String(name).trim()) throw new Error('project name required');
    return call('POST', '/v1/organization/projects', { name: String(name).trim() });
}

async function archiveProject(projectId) {
    if (!projectId) throw new Error('projectId required');
    return call('POST', `/v1/organization/projects/${encodeURIComponent(projectId)}/archive`);
}

async function listProjects(limit = 100) {
    return call('GET', `/v1/organization/projects?limit=${limit}`);
}

// ── Service accounts (= the path to a programmatic API key) ───
async function createServiceAccount(projectId, name = 'dashboard-sa') {
    if (!projectId) throw new Error('projectId required');
    return call(
        'POST',
        `/v1/organization/projects/${encodeURIComponent(projectId)}/service_accounts`,
        { name: String(name).slice(0, 64) }
    );
}

// Promote a project user (or service-account) to a different role.
// Used right after createServiceAccount so the SA's API key gets
// PERMISSIONS=All instead of "Inherited" (member).
//
// OpenAI exposes both PATCH and POST for the same path; POST works on all
// org tiers, PATCH sometimes 405s on older accounts. We use POST for safety.
async function setProjectUserRole(projectId, userId, role = 'owner') {
    if (!projectId || !userId) throw new Error('projectId + userId required');
    return call(
        'POST',
        `/v1/organization/projects/${encodeURIComponent(projectId)}/users/${encodeURIComponent(userId)}`,
        { role: String(role) }
    );
}

// ── Usage / Cost (Phase 17.3) ────────────────────────────
//
// GET /v1/organization/usage/completions
//   Aggregated chat-completion usage at the org level, grouped however we
//   ask. We use bucket_width=1d and group_by=[project_id, model] to match
//   the granularity of tbl_daily_token.
//
// Caveats
// ───────
//   - There's a 5-30 minute reporting lag on OpenAI's side — buckets for
//     "today" may still be updating, so the sync re-reads the trailing
//     2 days every run to catch up late writes (UPSERT pattern in caller).
//   - The Usage API pages with `next_page` cursor; we follow until done.
//   - Times are UNIX seconds (UTC). Caller converts to Bangkok date.
//
// Returns: a flat array of buckets:
//   [{ start_time, end_time, results: [{ project_id, model,
//                                         input_tokens, output_tokens,
//                                         input_cached_tokens, num_model_requests, ... }] }]
async function fetchUsageCompletions({ startTime, endTime } = {}) {
    if (!ADMIN_KEY) {
        const err = new Error('OPENAI_ADMIN_KEY not configured');
        err.status = 500;
        throw err;
    }
    if (!startTime) {
        // default: last 3 days (overkill but lets us re-fill any gap on first run)
        startTime = Math.floor(Date.now() / 1000) - 3 * 86400;
    }
    if (!endTime) endTime = Math.floor(Date.now() / 1000);

    const out = [];
    let page = null;
    let safety = 50;            // hard cap to avoid runaway pagination
    while (safety-- > 0) {
        const qs = new URLSearchParams({
            start_time:   String(startTime),
            end_time:     String(endTime),
            bucket_width: '1d',
            // OpenAI caps limit per bucket_width: 1m→1440, 1h→168, 1d→31.
            // We request the max so a single page covers up to a month
            // of daily buckets (and pagination kicks in only if we ever
            // ask for >31 days at once).
            limit:        '31',
        });
        qs.append('group_by', 'project_id');
        qs.append('group_by', 'model');
        if (page) qs.set('page', page);
        const r = await fetch(BASE + '/v1/organization/usage/completions?' + qs.toString(), {
            headers: { Authorization: 'Bearer ' + ADMIN_KEY },
        });
        let json = null;
        try { json = await r.json(); } catch (_) { /* empty body */ }
        if (!r.ok) {
            const msg = json?.error?.message || `HTTP ${r.status}`;
            const err = new Error(`OpenAI Usage: ${msg}`);
            err.status = r.status;
            err.openai = json?.error || json;
            throw err;
        }
        const buckets = Array.isArray(json?.data) ? json.data : [];
        for (const b of buckets) out.push(b);
        if (!json?.has_more || !json?.next_page) break;
        page = json.next_page;
    }
    return out;
}

module.exports = {
    isEnabled,
    createProject,
    archiveProject,
    listProjects,
    createServiceAccount,
    setProjectUserRole,
    fetchUsageCompletions,
};
