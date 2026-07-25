# ─── Base ─────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS base
RUN npm install -g pnpm@11
WORKDIR /app

# ─── Dependencies ─────────────────────────────────────────────────────────────
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/core/package.json ./packages/core/
COPY packages/adapters/package.json ./packages/adapters/
COPY packages/db/package.json ./packages/db/
COPY packages/shared/package.json ./packages/shared/
COPY packages/config/package.json ./packages/config/
COPY packages/code-analysis/package.json ./packages/code-analysis/
COPY apps/api/package.json ./apps/api/
RUN pnpm install --frozen-lockfile

# ─── Development ──────────────────────────────────────────────────────────────
FROM deps AS development
COPY . .
EXPOSE 3001
CMD ["pnpm", "--filter", "@codeon/api", "dev"]

# ─── Builder ──────────────────────────────────────────────────────────────────
FROM deps AS builder
COPY . .
RUN pnpm build --filter @codeon/api...

# ─── Production ───────────────────────────────────────────────────────────────
FROM node:22-alpine AS production
RUN npm install -g pnpm@11 && addgroup -S codeon && adduser -S codeon -G codeon
WORKDIR /app

COPY --from=builder --chown=codeon:codeon /app/apps/api/dist ./apps/api/dist
COPY --from=builder --chown=codeon:codeon /app/packages/core/dist ./packages/core/dist
COPY --from=builder --chown=codeon:codeon /app/packages/adapters/dist ./packages/adapters/dist
COPY --from=builder --chown=codeon:codeon /app/packages/db/dist ./packages/db/dist
COPY --from=builder --chown=codeon:codeon /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder --chown=codeon:codeon /app/packages/config/dist ./packages/config/dist
COPY --from=builder --chown=codeon:codeon /app/node_modules ./node_modules
COPY --from=builder --chown=codeon:codeon /app/package.json ./

USER codeon
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1
CMD ["node", "apps/api/dist/index.js"]
