# Credit Balance Concept — Project vs User (May 2026)

> Status: **DESIGN / NOT IMPLEMENTED.** This document captures the agreed
> direction for how project-level and user-level credit balances should
> relate. Build work is deferred — see "Build checklist" at the end.

## Background

The app tracks money in three quantities today:

| Quantity | Table | Current meaning |
|---|---|---|
| `project_credits` | `tbl_balance` | Project pool that has **not yet been allocated** to users |
| `user_credits` | `tbl_credits` | Money **already handed to a user** (personal wallet) |
| `project_credits_amount` | `tbl_balance` | Lifetime top-up accumulator (never decreases) |

Current flow (from `server.js` ~line 1438):

```
top up project   →  project_credits +X
allocate to user →  project_credits −X , user_credits +X   (pool → wallet)
user chats       →  user_credits −cost                      (project_credits unchanged)
```

### Problems with the current model

1. **Dashboard `project_credits` shows only the un-allocated remainder** — once
   money is allocated to users it disappears from the project figure, so the
   project looks poorer than it is.
2. **No single "project remaining" number** — when a user spends, the project
   pool doesn't move, so nothing answers "how much does this project have left?"
3. **Drift risk** — `tbl_credits` and `tbl_balance` are two parallel money
   stores with no enforced invariant.

## Options considered

### Concept A — Envelope / allocation
Project pool → allocate to each user's wallet → user spends own wallet.
- `user_credits` is **real money** owned by the user.
- Invariant: `project_remaining = project_credits + Σ user_credits`.
- ✅ Strict per-user budgets; users can't touch each other's money.
- ❌ Admin must allocate up front; money is locked per user; multiple sources of truth.

### Concept B — Shared pool + per-user cap  ← **CHOSEN**
One real pool per project; every user spends from it; `user_credits`/`daily_cap`
acts as a **spending limit**, not a wallet.
- Single source of truth = `tbl_balance.project_credits`.
- ✅ Money is fungible (heavy users use more, light users don't lock funds);
  low admin overhead; no drift; matches B2B billing (customer funds a project).
- ❌ One user can draw the shared pool up to their cap.

### Concept C — User wallets only, project = rollup
`user_credits` is real money topped up per user; project balance is a derived
`SUM(user_credits)`. Simplest, but project-level budgeting is weak. Rejected.

## Decision

**Adopt Concept B**, with these specifics agreed:

- **Cap type:** **Daily cap** (`tbl_user.daily_cap`, already exists). Resets at
  midnight Asia/Bangkok, so users recover on their own without admin action.
- **On cap hit:** **Block**, with a path for the user to request a temporary
  increase (admin approves).

### Rationale
1. The customer funds one pool per project → one real money figure.
2. No drift: `tbl_credits` stops being a parallel wallet; the truth is the pool.
3. Low admin burden: set a cap once; daily reset handles the rest.
4. Reuses what we already built — `tbl_user_credit_transaction` (per-user
   journal) and `tbl_daily_usage` (per-user/day rollup) already answer
   "who used how much."

## Target model

```
            ┌──────────────────────────────┐
 top up  →  │  PROJECT POOL (real money)    │  ← single source of truth
            │  tbl_balance.project_credits  │
            └───────────────┬──────────────┘
                            │ every user deducts from this pool
        ┌───────────────────┼───────────────────┐
     user A              user B              user C
   daily_cap 500       daily_cap 300       daily_cap 1000
   used today 480      used today 50       used today 0
```

| Field | Role under Concept B |
|---|---|
| `tbl_balance.project_credits` | 💰 Real money. Deducted on chat, increased on top-up. |
| `tbl_user.daily_cap` | 🚧 Per-user, per-day spend ceiling (exists). |
| `tbl_daily_usage` | 📊 "How much has this user spent today" counter (exists). |
| `tbl_credits.user_credits` | ⚠️ No longer a wallet — keep for history or deprecate. |

## Chat gate — two checks (order matters)

```
user sends a message → estimate cost
  CHECK 1: project_credits ≥ cost ?
     ✗ → BLOCK "Project credits exhausted — contact admin to top up"   (pool empty)
  CHECK 2: usage_today + cost ≤ daily_cap ?
     ✗ → BLOCK "Daily quota reached (฿X / ฿Y) · resets midnight"  + [Request more]
  ✓ both → deduct project_credits −cost + log transaction + answer
```

> ❗ The two failure modes MUST show different messages. "Pool empty" needs an
> admin top-up; "cap reached" the user can wait out or request an increase.

## Cap-hit handling — request-more workflow (new)

New table `tbl_quota_request`:

```
id, user_id, project_id, requested_extra, reason,
status (pending | approved | denied),
created_at, resolved_by, resolved_at
```

Flow:

```
user hits cap → [Request more] → enter amount + reason → create request (pending)
                                                          ↓
admin dashboard shows 🔔 "1 request pending" → [Approve] / [Deny]
   approve → grant a TODAY-ONLY bonus → user can chat again immediately
```

Today-only bonus (does not change the permanent cap) via
`tbl_daily_cap_bonus (user_id, bonus_date, extra_amount)`:

```
effective_cap(user, today) = daily_cap + COALESCE(today's approved bonus, 0)
```

Tomorrow the cap returns to normal automatically.

## Admin actions
- Raise `daily_cap` permanently (consistently heavy user).
- Approve / deny temporary quota requests.
- Top up the project (fixes the "pool empty" case).
- See who hits their cap often (from `tbl_daily_usage`).

## UX guards
1. **80% warning** — yellow banner "You've used 80% of today's quota."
2. **On cap hit** — send button greyed, clear message, countdown to reset,
   "Request more" button.
3. **Distinct copy** — pool-empty (Concept B) ≠ cap-reached (per-user).

## Build checklist (deferred)

| # | Task | Size |
|---|---|---|
| 1 | Chat handler: deduct from `project_credits` instead of `user_credits`; add the two-check gate | M |
| 2 | Migration: `tbl_quota_request` + `tbl_daily_cap_bonus` | S |
| 3 | API: request / approve / deny quota | M |
| 4 | User UI: request button + 80% banner + block messages | M |
| 5 | Admin UI: pending-request list + approve | M |
| 6 | Data migration: fold `tbl_credits.user_credits` back into `project_credits` | ⚠️ careful |

> **Highest risk = #6.** Money currently lives in `tbl_credits` (per-user
> wallets). Before switching to a single pool we must decide how to return each
> user's wallet balance to the project pool (e.g. `project_credits +=
> Σ user_credits`, then zero the wallets) and reconcile against
> `tbl_user_credit_transaction` so balances stay auditable.
