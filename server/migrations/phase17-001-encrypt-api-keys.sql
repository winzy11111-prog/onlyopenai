-- ╔═══════════════════════════════════════════════════════════╗
-- ║ Phase 17.1 — placeholder for encryption migration          ║
-- ╚═══════════════════════════════════════════════════════════╝
-- The actual bulk encryption of existing tbl_project.project_api_key values
-- is performed by a Node script (encrypt-keys.js) because SQL has no access
-- to the application's ENCRYPTION_KEY.
--
-- This file exists so the migration runner records that we've "applied
-- phase 17 encryption" — it just adds a comment to the column.

COMMENT ON COLUMN tbl_project.project_api_key IS
    'OpenAI API key for this project. Phase 17+: encrypted at rest via AES-256-GCM. '
    'Format: "enc:v1:<base64>" (see server/crypto.js). Legacy plaintext rows '
    'may still exist until encrypt-keys.js has been run.';
