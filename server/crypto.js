// ╔═══════════════════════════════════════════════════════════╗
// ║  crypto.js  — AES-256-GCM helper for sensitive columns    ║
// ╚═══════════════════════════════════════════════════════════╝
//
// Used by Phase 17 to encrypt tbl_project.project_api_key (and any other
// secret-at-rest we add later) so a DB dump can't be read directly.
//
// Format on disk
// ──────────────
// All encrypted blobs are prefixed with `enc:v1:` so we can detect them at
// decrypt time and migrate gracefully. Layout:
//
//     enc:v1:<base64(iv || ciphertext || authTag)>
//
//   iv         = 12 bytes (96-bit nonce, recommended for GCM)
//   ciphertext = variable
//   authTag    = 16 bytes (GCM auth tag)
//
// Rationale: AES-256-GCM gives confidentiality + integrity in one primitive.
// Tampering with the ciphertext is detected at decrypt time (throws).
// The `v1` discriminator lets us bump algorithms later without breaking
// the rest of the codebase.
//
// Key management
// ──────────────
// ENCRYPTION_KEY env var = 64-char hex (32 bytes binary).
// Rotation requires a one-off migration that decrypts with old + re-encrypts
// with new. NEVER hardcode the key; don't commit it to git.
//
// Backward compat
// ───────────────
// `isEncrypted(s)` checks for the `enc:v1:` prefix; callers that read DB
// values can transparently fall through to plaintext when the column was
// populated before Phase 17. The matching migration handles the bulk upgrade.

const crypto = require('crypto');

const ALG  = 'aes-256-gcm';
const IV_LEN = 12;          // 96 bits — GCM standard
const TAG_LEN = 16;         // 128 bits
const PREFIX = 'enc:v1:';

/** Lazily load + cache the key so we don't re-parse on every call. */
let _keyCache = null;
function _key() {
    if (_keyCache) return _keyCache;
    const hex = (process.env.ENCRYPTION_KEY || '').trim();
    if (!hex) throw new Error('ENCRYPTION_KEY is not configured');
    if (hex.length !== 64) throw new Error('ENCRYPTION_KEY must be 64 hex chars (32 bytes)');
    _keyCache = Buffer.from(hex, 'hex');
    if (_keyCache.length !== 32) throw new Error('ENCRYPTION_KEY decode failed');
    return _keyCache;
}

/** True if `s` looks like an encrypted blob produced by this module. */
function isEncrypted(s) {
    return typeof s === 'string' && s.startsWith(PREFIX);
}

/**
 * Encrypt a UTF-8 string. Returns the disk format `enc:v1:<base64>`.
 * Idempotent: if input is already encrypted, returns it unchanged.
 */
function encrypt(plaintext) {
    if (plaintext === null || plaintext === undefined) return plaintext;
    if (isEncrypted(plaintext)) return plaintext;
    const iv = crypto.randomBytes(IV_LEN);
    const cipher = crypto.createCipheriv(ALG, _key(), iv);
    const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return PREFIX + Buffer.concat([iv, ct, tag]).toString('base64');
}

/**
 * Decrypt a blob produced by `encrypt`. Returns plaintext string.
 *
 * If the input is NOT in our format (e.g. a legacy plaintext value that
 * hasn't been migrated yet) we return it as-is. Callers can detect via
 * `isEncrypted` if they need stricter checking.
 *
 * Throws on a corrupted blob (wrong key, tampering, truncated input).
 */
function decrypt(blob) {
    if (blob === null || blob === undefined) return blob;
    if (!isEncrypted(blob)) return blob;       // legacy plaintext — return as-is
    const b = Buffer.from(blob.slice(PREFIX.length), 'base64');
    if (b.length < IV_LEN + TAG_LEN + 1) throw new Error('encrypted blob truncated');
    const iv  = b.subarray(0, IV_LEN);
    const tag = b.subarray(b.length - TAG_LEN);
    const ct  = b.subarray(IV_LEN, b.length - TAG_LEN);
    const decipher = crypto.createDecipheriv(ALG, _key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

/**
 * Safe wrapper for paths that may still hit legacy data. Returns the
 * decrypted string on success; returns the original on legacy plaintext;
 * returns null if decryption throws (logs but doesn't crash the request).
 */
function tryDecrypt(blob) {
    try { return decrypt(blob); }
    catch (e) {
        console.warn('[crypto] decrypt failed:', e.message);
        return null;
    }
}

module.exports = { encrypt, decrypt, tryDecrypt, isEncrypted };
