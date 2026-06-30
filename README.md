# PipekAI — AI Coding Assistant for SAP / ABAP

PipekAI is a multi-tenant AI chat assistant specialised for **SAP / ABAP** work
(code review, BAPI lookup, transaction/SPRO help, RAP & Fiori guidance, and
general SAP Q&A). It pairs a frontier OpenAI model with a curated SAP prompt
catalog and knowledge base, with per-project credit billing built in.

> Backend serves both the REST/streaming API **and** the static frontend on a
> single port. Customers reach it over HTTPS via a Cloudflare tunnel.

---

## ✨ Features

- **Streaming chat** (SSE) with an SAP-specialist persona
- **Skill router** — a lightweight model classifies each question and applies
  the best-matching prompt from the catalog
- **Knowledge base** — local SAP reference files surfaced through function tools
  (`find_bapi`, `get_transaction_info`, `get_best_practice`, …)
- **Multi-tenant** — each *project* = one customer/org; data is scoped by
  `project_id`, and each project can use its own OpenAI key
- **Credit billing (Concept B)** — usage is charged to a per-project pool,
  priced per model from `tbl_pricing`, with a full transaction ledger
- **Admin prompt management** — add / edit / delete prompts from the UI
  (stored in the DB, hot-reloaded — no redeploy)
- **Daily caps & rate limiting**, CSRF protection, account lockout, audit log

---

## 🏗️ Architecture

```
Browser ──HTTPS──▶ Cloudflare tunnel ──▶ Node/Express server (:3001)
                                              │  serves API + static frontend
                                              ├──▶ PostgreSQL  (users, credits, history, prompts)
                                              └──▶ OpenAI      (gpt-5.5 answer · gpt-4o-mini router)
```

- **Backend:** Node.js + Express (`server/server.js`) — REST + SSE streaming,
  also serves the static frontend.
- **Frontend:** vanilla HTML/CSS/JS (`index.html`, `login.html`, `admin.html`,
  `change-password.html`, `js/`, `css/`) — no build step.
- **Database:** PostgreSQL with versioned SQL migrations (auto-applied on boot).
- **AI:** OpenAI — main answer model + a cheap router model; prompts in
  `tbl_prompt`, knowledge files in `server/knowledge/`.

---

## 🧱 Tech Stack

| Layer | Tech |
|-------|------|
| Runtime | Node.js (≥ 18) |
| Web | Express, CORS, Helmet |
| Auth | session cookie (HttpOnly) + CSRF, bcrypt, `express-rate-limit` |
| DB | PostgreSQL (`pg`) + SQL migrations |
| AI | `openai` SDK (gpt-5.5 + gpt-4o-mini) |
| Validation | `zod` |
| Logging | `pino` / `pino-http` / `pino-roll` |
| Misc | `multer` (uploads), `exceljs` (exports), `https-proxy-agent` |

---

## 📁 Project Structure

```
.
├── index.html / login.html / admin.html / change-password.html   # frontend pages
├── js/ · css/ · assets/                                          # frontend assets
├── server/
│   ├── server.js                # main Express app (API + static + chat)
│   ├── skill-prompts.js         # DB-backed prompt registry (+ file fallback)
│   ├── migrate-schema.js        # migration runner (runs on boot)
│   ├── reset-admin.js           # admin password reset CLI
│   ├── config/skill-prompts.json# seed/fallback prompt catalog
│   ├── knowledge/               # 17 SAP/ABAP reference files (function-tool RAG)
│   ├── migrations/*.sql         # versioned schema migrations
│   └── .env                     # secrets/config (gitignored — see .env.production.example)
├── windows/install-services.ps1 # register the app as a Windows service (NSSM)
├── docs/                        # deployment + DB + schema docs
├── start.js                     # local dev launcher (backend + static server)
└── start-server.sh / .bat
```

---

## 🚀 Getting Started (local dev)

**Prerequisites:** Node.js ≥ 18, a PostgreSQL database, an OpenAI API key.

```bash
cd server
npm install
cp .env.production.example .env      # then fill in your values (see below)
npm run migrate                      # create/seed the schema (also auto-runs on boot)
npm start                            # http://localhost:3001
```

Open `http://localhost:3001/login.html`.

---

## ⚙️ Configuration (`server/.env`)

| Key | Description |
|-----|-------------|
| `NODE_ENV` | `production` enables secure cookies (requires HTTPS) |
| `PORT` | server port (default `3001`) |
| `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASS` | PostgreSQL connection (`localhost` if same host) |
| `OPENAI_API_KEY` | OpenAI key for chat |
| `OPENAI_MODEL` | main answer model (e.g. `gpt-5.5`) |
| `OPENAI_TEMPERATURE` | number to use; empty to omit (some models reject custom temperature) |
| `OPENAI_ASSISTANT_ID` / `OPENAI_VECTOR_STORE_ID` | assistant + vector store ids |
| `ENCRYPTION_KEY` | 64-hex AES key used to encrypt per-project OpenAI keys |
| `ALLOWED_ORIGINS` | comma-separated allowed origins for CORS (include your domain) |
| `CHAT_RATE_LIMIT_PER_MIN`, `MAX_BALANCE`, `LOCKOUT_*`, `LOGIN_MAX_PER_15MIN`, `LOG_*` | tunables |

> `.env` is gitignored. Never commit real secrets — use `server/.env.production.example` as the template.

---

## 🤖 Models & Pricing

- **Answer model:** set by `OPENAI_MODEL` (e.g. `gpt-5.5`).
- **Router model:** `gpt-4o-mini` (cheap/fast skill classification on every message).
- Per-model rates live in **`tbl_pricing`** (`*_cost` = paid to OpenAI, `*_price`
  = charged to the customer; stored per 1K tokens). Switching models only needs
  `OPENAI_MODEL` updated + a matching `tbl_pricing` row — no code change.
- Money balances are stored at 4-decimal precision so the pool reconciles
  exactly with the credit ledger.

---

## 🗄️ Database

Migrations in `server/migrations/*.sql` are applied automatically on boot
(tracked in `_meta.schema_migrations` by filename + SHA-256 — never edit an
applied migration; add a new one).

Key tables: `tbl_user`, `tbl_project`, `tbl_balance` (project pool),
`tbl_credits`, `tbl_user_credit_transaction` (ledger), `tbl_daily_usage`,
`tbl_response`, `tbl_chat_session` / `tbl_chat_message`, `tbl_prompt` (+history),
`tbl_pricing`, `tbl_session`, `tbl_audit_log`.

See `docs/database-overview.md` and `docs/schema-current.sql`.

---

## 🚢 Deployment

Production runs on a Windows server, exposed via a Cloudflare tunnel.

- **Full guide:** `docs/deployment-windows.md`
- **Service install (NSSM):** `windows/install-services.ps1`
- After deploy: `nssm restart PetabyteAi` (migrations auto-apply on boot)

For external (customer) access the app must be served over **HTTPS** — use a
Cloudflare named tunnel (auto-HTTPS) or a reverse proxy with a TLS certificate.

---

## 📜 Scripts (`server/`)

| Command | What it does |
|---------|--------------|
| `npm start` | run the server |
| `npm run dev` | run with nodemon (auto-reload) |
| `npm run migrate` | apply pending migrations |
| `npm run migrate:status` | show migration status |
| `npm run reset-admin` | reset the `admin` password |

---

## 🔒 Security Notes

- Sessions use an HttpOnly, session-scoped cookie (closing the browser logs out)
  plus CSRF double-submit tokens and per-token rate limiting.
- Per-project OpenAI keys are encrypted at rest with `ENCRYPTION_KEY`.
- Change the default `admin` password before any public use.
- Never expose the database port publicly — only the app (`:3001`) goes through
  the tunnel.

---

## 📚 Docs

- `docs/deployment-windows.md` — Windows + tunnel deployment
- `docs/database-overview.md` — schema overview
- `docs/credit-balance-concept.md` — billing model (Concept B)
- `docs/schema-current.sql` — current schema snapshot
