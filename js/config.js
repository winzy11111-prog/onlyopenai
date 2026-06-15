/* =========================================================
   PetabyteAi — Frontend Runtime Config
   ─────────────────────────────────────────────────────────
   Single source of truth for the backend API base URL.
   Replaces hardcoded "http://localhost:3001" throughout JS.

   Resolution order:
     1. window.__API_BASE__   (server-injected at runtime, optional)
     2. Same host as the page on port 3001 (works in LAN/prod)
     3. Fallback: localhost:3001

   Usage in any module:
     const url = window.AppConfig.api('/api/users');
     fetch(window.AppConfig.api('/api/login'), { ... });
   ========================================================= */
(function () {
    'use strict';

    function resolveBase() {
        try {
            // 1) Server-injected override (from start.js or similar)
            if (typeof window !== 'undefined' && window.__API_BASE__) {
                return String(window.__API_BASE__).replace(/\/+$/, '');
            }
            // 2) Auto-detect: same host as the page, port 3001
            //    e.g. page on http://192.168.69.50:8080 → API on http://192.168.69.50:3001
            if (typeof window !== 'undefined' && window.location && window.location.hostname) {
                const host = window.location.hostname;
                // Skip "file://" and exotic protocols
                if (host && host !== '') {
                    return 'http://' + host + ':3001';
                }
            }
        } catch (_) { }
        // 3) Last-resort fallback
        return 'http://localhost:3001';
    }

    const API_BASE = resolveBase();

    window.AppConfig = {
        API_BASE: API_BASE,
        api: function (path) {
            if (!path) return API_BASE;
            return API_BASE + (path.charAt(0) === '/' ? path : '/' + path);
        },
    };

    // Keep a flat alias too — some legacy code uses BASE directly
    if (typeof window.BASE === 'undefined') window.BASE = API_BASE;

    // Friendly debug line (one per page load)
    try { console.info('[config] API_BASE = ' + API_BASE); } catch (_) { }
})();
