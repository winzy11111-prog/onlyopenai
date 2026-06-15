# Legacy code paths

Modules that were superseded by current production code. Kept so older
phases of git history still make sense and as reference if we ever
revisit the design decision.

## Files

| File | Was used for | Replaced by |
|------|-------------|-------------|
| `db-json.js` + `db.json` | JSON-file "database" (drop-in `pg.Pool` shape) — used pre-Phase-5 before we wired up real PostgreSQL. | `pg` driver hitting Postgres directly in `server.js`. |
| `app.js` | Old SPA controller (vanilla-JS router + state) for the user chat page. | Replaced by inline `<script>` inside `index.html` (kept the JS local so each page is self-contained). |

## Note

`mock-ai.js` is **NOT** legacy and is still actively loaded by
`index.html` as the offline-fallback for the chat client. It lives at
`js/mock-ai.js` and stays there.
