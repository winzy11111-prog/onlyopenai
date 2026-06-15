# Archived smoke / test scripts

Manual one-shot scripts used during early-phase development (Phase 7–14, Tier 1)
to verify each feature as it landed. Moved out of `server/` in Phase 19.8 so the
active source tree only shows production code.

## What's here

| File | Phase | Verifies |
|------|-------|----------|
| `smoke-p7.js`, `smoke-p7-restart.js` | 7 | Bearer sessions + soft delete |
| `smoke-p8.js`, `smoke-p8-frontend.js` | 8 | Account lockout + must-change-pw |
| `smoke-p9.js` | 9 | CSRF double-submit token |
| `smoke-p10.js` | 10 | Input validation schemas + CSP header |
| `smoke-p11.js`, `smoke-p11-blockB.js`, `smoke-p11-blockC.js` | 11 | Credit transfer / daily-cap / project pool |
| `smoke-p12-sessions.js` | 12 | Chat session threading + persistence |
| `smoke-phase14-router.js`, `smoke-phase14-audit.js` | 14 | Router intent map + audit log |
| `smoke-tier1-search.js`, `smoke-tier1-stop.js` | T1 | Session search ILIKE + stop-stream |
| `test-openai.js` | — | One-line probe for OpenAI SDK shape |

## Notes

- **No production code references these** — `server.js`, `start.js`, `package.json` do not import them.
- **May be out of date** — Schema has changed since they were written (e.g. `tbl_chat_session.is_favorite` was added in Phase 19.7). Assume each script needs review before re-running.
- **Restore**: just `mv ../_archive/smoke-tests/*.js ./` from inside `server/`.
- **Replacement plan**: when we wire up Playwright (Group D item), these become reference for what flows to cover.
