# DB Migrations

Append-only SQL files that build the PostgreSQL schema from scratch.
Run automatically on every server boot by `migrate-schema.js`; idempotent
(`CREATE … IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, etc.) so re-running
is safe.

> ⚠️ **Never delete a file from this folder.** A fresh deploy (new DB
> server) replays the entire history to recreate the current schema. The
> runner records the SHA-256 of each file in `_meta.schema_migrations`,
> so editing an applied file fails loudly — write a new migration instead.

## Running

```bash
# Apply pending migrations (server boot does this automatically)
cd server && npm run migrate

# Show status without changes
npm run migrate:status
```

## Convention

- **Filename**: `phase<N>-<NNN>-<short-slug>.sql`
- **Header comment**: one-line "what" + one paragraph "why"
- **Idempotency**: prefer `IF NOT EXISTS`. If not possible, add `DO $$ … END $$;`
  guard so re-runs are no-ops.
- **One concern per file**: a column add + an index = two files.

## Timeline

| # | File | Phase | Adds / Changes |
|---|------|-------|----------------|
|  1 | `phase0-000-initial-schema.sql` | 0 | **Baseline** — every `tbl_*` table, FKs, indexes, seed admin |
|  2 | `phase5-001-decimal-money.sql` | 5 | Money columns: `FLOAT` → `DECIMAL(12,2)` (exact arithmetic) |
|  3 | `phase6-001-pk-and-userid.sql` | 6 | Primary keys + `tbl_response.user_id` |
|  4 | `phase6-002-indexes.sql` | 6 | Hot-path indexes |
|  5 | `phase6-003-project-meta.sql` | 6 | `tbl_project`: description, pricing rates, credit limit |
|  6 | `phase7-001-sessions-and-soft-delete.sql` | 7 | `tbl_session` (server-side) + soft-delete flags |
|  7 | `phase8-001-account-lockout-and-pw-change.sql` | 8 | `failed_attempts` / `locked_until` / `must_change_pw` |
|  8 | `phase9-001-csrf-token.sql` | 9 | CSRF token column on `tbl_session` |
|  9 | `phase11-001-username-unique.sql` | 11 | `UNIQUE (username)` on `tbl_user` |
| 10 | `phase11-002-daily-cap.sql` | 11 | `tbl_user.daily_cap` (per-user spend ceiling) |
| 11 | `phase11-003-action-admin-project-nullable.sql` | 11 | `tbl_action_admin.project_id` → nullable |
| 12 | `phase12-001-chat-sessions.sql` | 12 | `tbl_chat_session` + `tbl_chat_message` (history) |
| 13 | `phase12-002-migrate-legacy-chat-sessions.sql` | 12 | Backfill from legacy `chat_sessions` → `tbl_chat_*` |
| 14 | `phase14-001-action-admin-detail.sql` | 14 | `tbl_action_admin`: before/after diff columns |
| 15 | `phase15-001-openai-project-link.sql` | 15 | `tbl_project.openai_project_id` + service account |
| 16 | `phase15-002-cascade-project-id.sql` | 15 | `ON UPDATE CASCADE` on every `project_id` FK |
| 17 | `phase16-001-topup-history.sql` | 16 | Dedicated `tbl_topup_history` (split from action log) |
| 18 | `phase16-002-cached-input-rate.sql` | 16 | `tbl_project.cached_input_rate` (50 % billing) |
| 19 | `phase17-001-encrypt-api-keys.sql` | 17 | Bulk-encrypt existing `project_api_key` values |
| 20 | `phase17-002-sync-prep.sql` | 17 | Composite PK on `tbl_daily_token` + `tbl_sync_state` |
| 21 | `phase19-001-favorite-chat.sql` | 19.7 | `tbl_chat_session.is_favorite` + partial index |
| 22 | `phase19-002-action-admin-role-fk.sql` | 19.9 | Adds missing FK `tbl_action_admin.role_id → tbl_user_role.role_id` (matches designer's schema) |
| 23 | `phase20-001-project-credits-amount.sql` | 20 | `tbl_balance.project_credits_amount` — lifetime top-up accumulator (never decreases). Powers dashboard summary + future customer tiers. |
| 24 | `phase21-001-pricing-and-daily-usage.sql` | 21 | `tbl_pricing` (master cost/price per model with effective-date versioning) + `tbl_daily_usage` (pre-aggregated rollup per user/session/model with computed margin). |
| 25 | `phase21-002-rename-topup-history.sql` | 21.2 | Rename `tbl_topup_history` → `tbl_topup_project` (naming alignment with other project-scoped tables). Idempotent. |
| 26 | `phase21-003-daily-usage-rollup-to-user.sql` | 21.3 | Collapse `tbl_daily_usage` from (date, user, session, model) → (date, user). Single row per user per day; per-model detail still in `tbl_chat_message`. Idempotent. |
| 27 | `phase21-004-usage-views.sql` | 21.4 | Read-only VIEWs (`v_user_daily_usage`, `v_project_daily_usage`, `v_user_lifetime_usage`) — friendly column names + JOINs for pgAdmin queries. CREATE OR REPLACE — safe to re-run. |
| 28 | `phase21-005-user-credit-transaction.sql` | 21.5 | **`tbl_user_credit_transaction`** — per-user financial transaction journal (topup/usage/adjustment/refund). Signed amount + balance snapshot + ref back to source event. Backfills usage from `tbl_chat_message` and topup from `tbl_action_admin`. |
| 29 | `phase21-006-credit-transaction-view.sql` | 21.6 | VIEW `v_user_credit_transaction` — joined with user/project + computes `tx_date`, `tx_month`, `display_name`, `amount_display` for dashboard Day/Month views. |
| 30 | `phase21-007-drop-legacy-tables.sql` | 21.7 | **Cleanup** — drops 3 orphan tables left from the original schema before the `tbl_*` convention: `projects`, `users`, `usage_history`. They had no code refs, no view refs, and no FKs from active tables. `DROP TABLE IF EXISTS … CASCADE`, idempotent. |
| 31 | `phase21-008-daily-usage-total-token.sql` | 21.8 | `tbl_daily_usage.total_token` — GENERATED column (`input_tokens + output_tokens`). Idempotent (`ADD COLUMN IF NOT EXISTS`). |
| 32 | `phase21-009-daily-usage-builder.sql` | 21.9 | **Daily usage builder** — `fn_build_daily_usage(from,to)` (RETURNS TABLE, read-only preview) + `sp_refresh_daily_usage(from,to)` (UPSERT into `tbl_daily_usage`). Re-aggregates `tbl_response` → per-day/user rollup, priced per-event from `tbl_pricing`. plpgsql (non-inlinable); `created_at::date` for Bangkok-local bucketing. `CREATE OR REPLACE` — safe to re-run. |
| 33 | `phase21-010-quota-request-tables.sql` | 21.10 | **Concept B** — `tbl_quota_request` (user-initiated cap-increase request, admin-resolved) + `tbl_daily_cap_bonus` (today-only cap bump granted on approval). See `docs/credit-balance-concept.md`. Idempotent. |
| 34 | `phase21-011-consolidate-credits.sql` | 21.11 | **One-shot data migration** — folds per-user wallets (`tbl_credits.user_credits`) back into project pools (`tbl_balance.project_credits`) and zeros the wallets. Writes a `wallet_consolidation` audit row in `tbl_user_credit_transaction` per fold. After this, the only spendable money is the project pool; per-user `daily_cap` becomes a limit, not a wallet. Idempotent — re-running finds 0 wallets > 0. |
| 35 | `phase21-012-bonus-balance.sql` | 21.12 | **Persistent bonus balance** (Concept B Phase 2) — `tbl_user.bonus_balance`. Approved quota requests now top up a persistent balance instead of a today-only bump. `effective_cap = daily_cap + bonus_balance`; bonus is drawn down only by daily spend above `daily_cap` (computed at spend time → no cron needed) and leftover carries over indefinitely. `tbl_daily_cap_bonus` kept as grant history. Idempotent. |

_Total: 35 migrations · all currently applied to prod DB._

> **Scheduling note:** the daily auto-refresh (call `sp_refresh_daily_usage` for
> yesterday at 00:30) is **not** a migration — it needs `pg_cron`, which is a
> server-admin install. The ready-to-apply SQL + DBA instructions live in
> `server/scripts/pg_cron-daily-rollup.sql`.

## Adding a new migration

1. Pick the next `phase<N>-<NNN>-<slug>.sql` number.
2. Drop the file in this folder.
3. Restart the server (or run `npm run migrate`) — runner picks it up.
4. Update the table above so the timeline stays accurate.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `[migrate] ⚠ file MODIFIED since applied` | You edited an applied file | Don't — add a NEW file that does the correction |
| New file not picked up | Filename doesn't match `*.sql` glob | Rename, must end in `.sql` |
| Apply fails with FK error | Order issue (newer file depends on older table) | Filenames sort lexicographically — fix the prefix |
| Production migration list out of sync with this README | Someone added a migration and forgot the docs | Update the table above |
