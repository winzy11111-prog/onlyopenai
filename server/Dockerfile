# ╔═══════════════════════════════════════════════════════════╗
# ║ PetabyteAi — backend server image                         ║
# ╚═══════════════════════════════════════════════════════════╝
# Multi-stage: small runtime, only prod deps, non-root user.

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund

# ── runtime ──────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

# tini handles PID 1 signal forwarding so SIGTERM reaches node cleanly
RUN apk add --no-cache tini curl

# non-root uid/gid
RUN addgroup -S app && adduser -S -G app app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# drop anything that shouldn't be in the image
RUN rm -rf .env db.json *.log logs smoke-*.js test-*.js dump-schema.js \
 && chown -R app:app /app \
 && mkdir -p /app/logs && chown -R app:app /app/logs

USER app

ENV NODE_ENV=production \
    PORT=3001

EXPOSE 3001

# simple health probe: /api/health returns 200
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -fsS http://localhost:${PORT:-3001}/api/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
