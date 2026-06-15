/**
 * app.js — Core SPA Logic for AgentHub
 * Handles routing, state, and rendering for all views
 */

const AppState = {
    currentPlan: 'starter',
    balance: 100.00,
    history: [],       // { id, skillId, skillName, prompt, response, inputTokens, outputTokens, cost, timestamp }
    selectedSkill: 'auto',   // default: Smart Auto Detect
    isRunning: false,

    save() {
        localStorage.setItem('agenthub_plan', this.currentPlan);
        localStorage.setItem('agenthub_balance', this.balance.toString());
        localStorage.setItem('agenthub_history', JSON.stringify(this.history));
    },

    load() {
        this.currentPlan = localStorage.getItem('agenthub_plan') || 'starter';
        this.balance = parseFloat(localStorage.getItem('agenthub_balance') || '100');
        try {
            this.history = JSON.parse(localStorage.getItem('agenthub_history') || '[]');
        } catch { this.history = []; }
    },

    addHistory(entry) {
        entry.id = Date.now();
        entry.timestamp = new Date().toISOString();
        this.history.unshift(entry);
        if (this.history.length > 200) this.history = this.history.slice(0, 200);
        this.balance = Math.max(0, this.balance - entry.cost);
        this.save();
        // Sync per-user keys so admin sees live data
        try {
            const session = typeof Auth !== 'undefined' ? Auth.getSession() : null;
            if (session && session.username) {
                localStorage.setItem(`agenthub_balance_${session.username}`, this.balance.toString());
                localStorage.setItem(`agenthub_history_${session.username}`, JSON.stringify(this.history));
                // Sync to admin users list
                if (typeof Auth !== 'undefined') {
                    const users = Auth.getUsers();
                    const idx = users.findIndex(u => u.username === session.username);
                    if (idx !== -1) {
                        users[idx].balance = this.balance;
                        users[idx].history = this.history;
                        Auth.saveUsers(users);
                    }
                }
                // ── Persist to PostgreSQL (fire-and-forget) ───────────
                if (session.userId) {
                    fetch(BASE + '/api/history', {
                        method: 'POST',
                        headers: Auth.authHeaders(),
                        body: JSON.stringify({
                            userId: session.userId,
                            skillId: entry.skillId,
                            skillName: entry.skillName,
                            skillEmoji: entry.skillEmoji,
                            prompt: entry.prompt,
                            response: entry.response,
                            inputTokens: entry.inputTokens,
                            outputTokens: entry.outputTokens,
                            cost: entry.cost,
                            durationMs: entry.durationMs,
                        }),
                    }).catch(function (e) { console.warn('[DB] History save failed:', e.message); });
                }
            }
        } catch (e) { }
    },

    get todayHistory() {
        const today = new Date().toDateString();
        return this.history.filter(h => new Date(h.timestamp).toDateString() === today);
    },

    get totalTokens() {
        return this.history.reduce((s, h) => s + h.inputTokens + h.outputTokens, 0);
    },

    get totalCost() {
        return this.history.reduce((s, h) => s + h.cost, 0);
    },

    get todayTokens() {
        return this.todayHistory.reduce((s, h) => s + h.inputTokens + h.outputTokens, 0);
    },

    get todayRequests() {
        return this.todayHistory.length;
    },

    get todayCost() {
        return this.todayHistory.reduce((s, h) => s + h.cost, 0);
    },

    get skillUsage() {
        const map = {};
        this.history.forEach(h => {
            map[h.skillName] = (map[h.skillName] || 0) + 1;
        });
        return Object.entries(map)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);
    },
};

// =====================================================
// UI Helpers
// =====================================================
function $(id) { return document.getElementById(id); }
function setText(id, val) { const el = $(id); if (el) el.textContent = val; }

function showToast(msg, type = 'info') {
    const container = $('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s';
        setTimeout(() => toast.remove(), 300);
    }, 2800);
}

function formatDate(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// =====================================================
// ROUTER
// =====================================================
const app = {
    currentView: 'home',

    navigate(view) {
        // hide all
        document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

        const target = $(`view-${view}`);
        const navTarget = $(`nav-${view}`);
        if (target) target.classList.remove('hidden');
        if (navTarget) navTarget.classList.add('active');

        this.currentView = view;
        window.scrollTo(0, 0);

        // Render view-specific content
        const renderers = {
            home: () => { },
            dashboard: () => app.renderDashboard(),
            skills: () => app.renderSkills(),
            playground: () => app.renderPlayground(),
            billing: () => app.renderBilling(),
        };
        if (renderers[view]) renderers[view]();

        // Update sidebar
        app.updateSidebar();

        // Close mobile sidebar
        $('sidebar').classList.remove('open');
    },

    updateSidebar() {
        setText('sidebar-balance', PRICING.formatTHBShort(AppState.balance));
        // Show current project name
        try {
            const session = typeof Auth !== 'undefined' ? Auth.getSession() : null;
            if (session && session.projectId) {
                const projects = JSON.parse(localStorage.getItem('agenthub_projects') || '[]');
                const proj = projects.find(p => p.id === session.projectId);
                const el = document.getElementById('sidebar-project-name');
                if (el && proj) el.textContent = proj.name;
            }
        } catch { }
    },

    // ========================
    // DASHBOARD
    // ========================
    renderDashboard() {
        const plan = PRICING.plans[AppState.currentPlan];
        setText('dashboard-plan-chip', `${plan.name} Plan`);
        setText('stat-requests', AppState.todayRequests);
        setText('stat-requests-total', AppState.history.length);
        setText('stat-tokens-today', AppState.todayTokens.toLocaleString());
        setText('stat-tokens-total', AppState.totalTokens.toLocaleString());
        setText('stat-cost-today', PRICING.formatTHBShort(AppState.todayCost));
        setText('stat-cost-total', PRICING.formatTHBShort(AppState.totalCost));
        setText('stat-balance', PRICING.formatTHBShort(AppState.balance));

        // Recent list
        const recent = $('dashboard-recent');
        const last5 = AppState.history.slice(0, 5);
        if (last5.length === 0) {
            recent.innerHTML = `<div class="empty-state small"><div class="empty-icon">📋</div><p>ยังไม่มีประวัติการใช้งาน<br/>ลองใช้ <a href="#playground" data-view="playground" class="link">Playground</a></p></div>`;
        } else {
            recent.innerHTML = last5.map(h => `
        <div class="recent-item">
          <div>
            <div class="recent-skill">${h.skillEmoji || '🤖'} ${h.skillName}</div>
            <div class="recent-time">${formatDate(h.timestamp)}</div>
          </div>
          <div class="recent-cost">${PRICING.formatTHBShort(h.cost)}</div>
        </div>
      `).join('');
        }

        // Skill bars
        const bars = $('skill-bars');
        const usage = AppState.skillUsage;
        if (usage.length === 0) {
            bars.innerHTML = `<div class="empty-state small"><div class="empty-icon">📊</div><p>ยังไม่มีข้อมูล</p></div>`;
        } else {
            const max = usage[0][1];
            bars.innerHTML = usage.map(([name, count]) => `
        <div class="skill-bar-item">
          <div class="skill-bar-header">
            <span class="skill-bar-name">${name}</span>
            <span class="skill-bar-count">${count} ครั้ง</span>
          </div>
          <div class="skill-bar-track">
            <div class="skill-bar-fill" style="width: ${(count / max * 100).toFixed(0)}%"></div>
          </div>
        </div>
      `).join('');
        }
    },

    // ========================
    // SKILLS CATALOG
    // ========================
    renderSkills(filter = '') {
        const grid = $('skills-grid');
        const skills = filter
            ? PRICING.skills.filter(s => s.name.includes(filter) || s.desc.includes(filter) || s.tags.some(t => t.includes(filter)))
            : PRICING.skills;

        grid.innerHTML = skills.map(skill => `
      <div class="skill-card" onclick="app.trySkill('${skill.id}')">
        <div class="skill-card-emoji">${skill.emoji}</div>
        <div class="skill-card-name">${skill.name}</div>
        <div class="skill-card-desc">${skill.desc}</div>
        <div class="skill-card-tags">
          ${skill.tags.map(t => `<span class="skill-tag">${t}</span>`).join('')}
        </div>
        <button class="skill-card-try">ลองเลย →</button>
      </div>
    `).join('');
    },

    trySkill(skillId) {
        AppState.selectedSkill = skillId;
        this.navigate('playground');
    },

    // ========================
    // PLAYGROUND
    // ========================
    renderPlayground() {
        const pgSelect = $('pg-skill-select');
        pgSelect.innerHTML = PRICING.skills.map(skill => `
      <div class="skill-option ${AppState.selectedSkill === skill.id ? 'selected' : ''}"
           onclick="app.selectSkill('${skill.id}')"
           id="pg-opt-${skill.id}">
        <span class="skill-option-emoji">${skill.emoji}</span>
        <span>${skill.name}</span>
      </div>
    `).join('');

        // Prompt counter
        const prompt = $('pg-prompt');
        if (prompt) {
            prompt.addEventListener('input', () => {
                const len = prompt.value.length;
                const tokens = PRICING.estimateTokens(prompt.value);
                setText('pg-char-count', `${len} ตัวอักษร`);
                setText('pg-token-est', `~${tokens} input tokens`);
            });
        }
    },

    selectSkill(skillId) {
        AppState.selectedSkill = skillId;
        document.querySelectorAll('.skill-option').forEach(el => el.classList.remove('selected'));
        const opt = $(`pg-opt-${skillId}`);
        if (opt) opt.classList.add('selected');
    },

    async runPlayground() {
        if (AppState.isRunning) return;

        // Default to 'auto' if nothing selected — user just types and runs
        const selectedId = AppState.selectedSkill || 'auto';
        const skill = PRICING.skills.find(s => s.id === selectedId) || PRICING.skills[0];
        const prompt = $('pg-prompt').value.trim();

        if (!prompt) { showToast('กรุณาใส่คำถามหรือ ABAP code ก่อน', 'error'); return; }
        if (AppState.balance <= 0) { showToast('เครดิตหมด กรุณาติดต่อผู้ดูแลระบบ', 'error'); return; }

        AppState.isRunning = true;
        const runBtn = $('pg-run-btn');
        runBtn.disabled = true;
        runBtn.innerHTML = `<span class="loading-spinner" style="width:16px;height:16px;border-width:2px"></span> กำลังประมวลผล...`;

        // Reset response area
        const responseEl = $('pg-response');
        responseEl.innerHTML = `<div class="response-text cursor-blink" id="streaming-text"></div>`;
        $('cost-breakdown').style.display = 'none';
        $('response-badges').innerHTML = '';

        let accumulated = '';

        // Get project-based rates
        const getProjectRates = () => {
            try {
                const session = typeof Auth !== 'undefined' ? Auth.getSession() : null;
                if (session && session.projectId) {
                    const projects = JSON.parse(localStorage.getItem('agenthub_projects') || '[]');
                    const proj = projects.find(p => p.id === session.projectId);
                    if (proj) return { inputRate: proj.inputRate, outputRate: proj.outputRate };
                }
            } catch (e) { }
            // Fallback to plan
            const plan = PRICING.plans[AppState.currentPlan] || PRICING.plans.starter;
            return { inputRate: plan.inputRate, outputRate: plan.outputRate };
        };

        const rates = getProjectRates();

        await AIClient.run(
            skill.id,
            prompt,
            skill.systemPrompt,
            // onChunk
            (chunk) => {
                accumulated += chunk;
                const streamEl = $('streaming-text');
                if (streamEl) streamEl.textContent = accumulated;
                responseEl.scrollTop = responseEl.scrollHeight;
            },
            // onDone
            (result) => {
                // Remove cursor
                const streamEl = $('streaming-text');
                if (streamEl) streamEl.classList.remove('cursor-blink');

                // Use cost from backend if available, else compute from tokens
                const costResult = {
                    inputTokens: result.inputTokens,
                    outputTokens: result.outputTokens,
                    inputRate: rates.inputRate,
                    outputRate: rates.outputRate,
                    inputCost: (result.inputTokens / 1000) * rates.inputRate,
                    outputCost: (result.outputTokens / 1000) * rates.outputRate,
                    total: result.cost != null
                        ? result.cost
                        : (result.inputTokens / 1000) * rates.inputRate + (result.outputTokens / 1000) * rates.outputRate,
                };

                // Show badges
                $('response-badges').innerHTML = `
          <span class="response-badge badge-tokens">${(result.inputTokens + result.outputTokens).toLocaleString()} tokens</span>
          <span class="response-badge badge-time">${(result.durationMs / 1000).toFixed(1)}s</span>
        `;

                // Show cost breakdown
                $('cost-breakdown').style.display = 'block';
                setText('cb-input-tokens', result.inputTokens.toLocaleString());
                setText('cb-input-rate', `฿${costResult.inputRate.toFixed(2)}`);
                setText('cb-output-tokens', result.outputTokens.toLocaleString());
                setText('cb-output-rate', `฿${costResult.outputRate.toFixed(2)}`);
                setText('cb-total', PRICING.formatTHB(costResult.total));

                // Save to history
                AppState.addHistory({
                    skillId: skill.id,
                    skillName: skill.name,
                    skillEmoji: skill.emoji,
                    prompt: prompt.slice(0, 100),
                    response: accumulated.slice(0, 200),
                    inputTokens: result.inputTokens,
                    outputTokens: result.outputTokens,
                    cost: costResult.total,
                    durationMs: result.durationMs,
                });

                app.updateSidebar();
                showToast(`✅ เสร็จแล้ว! ค่าใช้จ่าย ${PRICING.formatTHBShort(costResult.total)}`, 'success');

                // Reset button
                AppState.isRunning = false;
                runBtn.disabled = false;
                runBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg> รัน Agent Skill`;
            },
            // rates (6th arg) — for backend cost calculation
            rates
        );
    },

    // ========================
    // BILLING
    // ========================
    renderBilling() {
        setText('bill-month-cost', PRICING.formatTHBShort(AppState.totalCost));
        setText('bill-requests', AppState.history.length);
        setText('bill-tokens', AppState.totalTokens.toLocaleString());
        setText('bill-balance', PRICING.formatTHBShort(AppState.balance));

        const container = $('history-container');
        if (AppState.history.length === 0) {
            container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🗂️</div>
          <h4>ยังไม่มีประวัติการใช้งาน</h4>
          <p>เริ่มต้นใช้งานได้ที่ <a href="#playground" data-view="playground" class="link">Playground</a></p>
        </div>`;
            return;
        }

        container.innerHTML = `
      <table class="history-table">
        <thead>
          <tr>
            <th>Skill</th>
            <th>Prompt</th>
            <th>Tokens (In/Out)</th>
            <th>ค่าใช้จ่าย</th>
            <th>เวลา</th>
          </tr>
        </thead>
        <tbody>
          ${AppState.history.map(h => `
            <tr>
              <td class="history-skill">${h.skillEmoji || '🤖'} ${h.skillName}</td>
              <td style="max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--text-muted)">${h.prompt}</td>
              <td class="history-tokens">${h.inputTokens} / ${h.outputTokens}</td>
              <td class="history-cost">${PRICING.formatTHBShort(h.cost)}</td>
              <td style="color:var(--text-muted);font-size:0.78rem">${formatDate(h.timestamp)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    },

    clearHistory() {
        if (!confirm('ต้องการล้างประวัติการใช้งานทั้งหมดหรือไม่?')) return;
        AppState.history = [];
        AppState.balance = 100.00;
        AppState.save();
        showToast('ล้างประวัติเรียบร้อย', 'info');
        app.renderBilling();
        app.updateSidebar();
    },

    // ========================
    // INIT
    // ========================
    init() {
        AppState.load();

        // Default route
        const hash = window.location.hash.replace('#', '') || 'home';
        this.navigate(hash);

        // Nav click handler (sidebar + links with data-view)
        document.addEventListener('click', (e) => {
            const navEl = e.target.closest('[data-view]');
            if (navEl) {
                e.preventDefault();
                this.navigate(navEl.dataset.view);
            }
        });

        // Skills search
        const searchInput = $('skill-search');
        if (searchInput) {
            searchInput.addEventListener('input', () => this.renderSkills(searchInput.value.trim()));
        }

        // Mobile hamburger
        $('hamburger-btn').addEventListener('click', () => {
            $('sidebar').classList.toggle('open');
        });

        // Close sidebar on outside click
        document.addEventListener('click', (e) => {
            if (window.innerWidth <= 768) {
                const sidebar = $('sidebar');
                if (!sidebar.contains(e.target) && !$('hamburger-btn').contains(e.target)) {
                    sidebar.classList.remove('open');
                }
            }
        });
    },
};

// =====================================================
// Boot
// =====================================================
document.addEventListener('DOMContentLoaded', () => app.init());
