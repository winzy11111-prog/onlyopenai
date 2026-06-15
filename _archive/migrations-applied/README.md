# Applied one-shot migration scripts

These scripts ran ONCE against the live DB during their phase and made
non-idempotent data changes (renames, bulk encryption, rate-limited API
calls). They are kept for **forensics** ("what exactly happened on the
day we shipped Phase 17?") and as **reference** for writing future
one-shots, not for re-running.

> The everyday schema migration runner (`server/migrate-schema.js` + the
> `server/migrations/*.sql` files) is unaffected by anything here.

## Files

| File | Phase | What it did |
|------|-------|-------------|
| `db-audit.js`                  | 5  | Audited the live schema (column widths, sample rows) before the Phase 5 money-type migration so we knew what would change. |
| `db-migrate.js`                | 5  | Bootstrap migrator before `migrate-schema.js` existed. Applied `phase5-001-decimal-money.sql` from the project root. |
| `migrate.js`                   | 5  | One-time `db.json` → PostgreSQL data import. Used while we still had a JSON-backed mode. |
| `migrate-unify-project-id.js`  | 15 | Renamed `tbl_project.project_id` values so they match the OpenAI project ids (rides on Phase 15.2's `ON UPDATE CASCADE`). |
| `sync-openai-projects.js`      | 15 | Created one OpenAI project + service-account API key per active dashboard project (rate-limited; ran in batches). |
| `encrypt-keys.js`              | 17 | Bulk-encrypted every plaintext `project_api_key` in `tbl_project` with the AES-256-GCM helper. Skips rows already prefixed `enc:v1:`. |

## Re-running (rare)

Each script has `--apply` (or similar dry-run flag) — read the file
header before doing anything. Restore to the project root first:

```bash
# example: re-run encrypt-keys
mv _archive/migrations-applied/encrypt-keys.js server/
cd server && node encrypt-keys.js          # dry run
node encrypt-keys.js --apply               # actually run
```
