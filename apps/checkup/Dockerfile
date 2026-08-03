# Build context = monorepo root (igual ao apps/web/Dockerfile)

FROM node:24.15.0-alpine AS deps
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@10.33.3 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/checkup/package.json ./apps/checkup/
RUN pnpm install --frozen-lockfile --ignore-scripts --filter "./apps/checkup..."

FROM node:24.15.0-alpine AS builder
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@10.33.3 --activate
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/checkup/node_modules ./apps/checkup/node_modules
COPY package.json pnpm-workspace.yaml ./
COPY apps/checkup ./apps/checkup
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN cd apps/checkup && node_modules/.bin/next build

FROM node:24.15.0-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup -S app && adduser -S app -G app

COPY --from=builder --chown=app:app /repo/apps/checkup/.next/standalone ./
COPY --from=builder --chown=app:app /repo/apps/checkup/public ./apps/checkup/public
COPY --from=builder --chown=app:app /repo/apps/checkup/.next/static ./apps/checkup/.next/static

USER app
EXPOSE 3001
ENV PORT=3001
ENV HOSTNAME=0.0.0.0

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3001/api/health', r => process.exit(r.statusCode < 500 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "apps/checkup/server.js"]
