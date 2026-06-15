# `_archive/`

Files that aren't part of the running app but are worth keeping for
reference, forensics, or rare re-runs. Nothing in here is loaded by
`server.js`, `start.js`, `package.json scripts`, or any HTML — it is
safe to ignore during normal development.

## Layout

| Folder | What's in it |
|--------|-------------|
| `smoke-tests/`        | Phase 7–14 manual verification scripts (15 files). Reference for future Playwright tests. |
| `migrations-applied/` | One-shot data migration scripts that already ran against prod and are not idempotent / re-runnable. |
| `legacy/`             | Code paths abandoned during refactors (alternate DB driver, old SPA shell). |
| `design/`             | Static design previews / mockups not part of the runtime. |

## Restore

Each subfolder has its own `README.md`. To bring a file back into use,
just `mv` it to its original path and update whichever caller you need
to wire it in.
