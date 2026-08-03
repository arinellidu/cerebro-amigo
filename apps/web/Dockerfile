# Build context = monorepo root

FROM node:24.15.0-alpine AS deps
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@10.33.3 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/
RUN pnpm install --frozen-lockfile --ignore-scripts --filter "./apps/web..."

FROM node:24.15.0-alpine AS builder
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@10.33.3 --activate
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/web/node_modules ./apps/web/node_modules
COPY package.json pnpm-workspace.yaml ./
COPY apps/web ./apps/web
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
# NEXT_PUBLIC_* são BUILD-time: inlined no bundle do cliente durante `next build`.
# Na Vercel vinham do dashboard; fora dela (Docker/CI) PRECISAM chegar como build-arg,
# senão saem vazias (Turnstile/captcha + Web Push quebram). Passados pelo bake/CI.
# Ver docs/runbooks/web-vercel-to-ec2-env.md. Não são segredo (vão pro cliente).
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY
ARG NEXT_PUBLIC_HUB_URL
ARG NEXT_PUBLIC_MANUAL_PIX_CHAVE
ARG NEXT_PUBLIC_MANUAL_PIX_NOME
ARG NEXT_PUBLIC_MANUAL_PAGAMENTO_URL
ENV NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY \
    NEXT_PUBLIC_VAPID_PUBLIC_KEY=$NEXT_PUBLIC_VAPID_PUBLIC_KEY \
    NEXT_PUBLIC_HUB_URL=$NEXT_PUBLIC_HUB_URL \
    NEXT_PUBLIC_MANUAL_PIX_CHAVE=$NEXT_PUBLIC_MANUAL_PIX_CHAVE \
    NEXT_PUBLIC_MANUAL_PIX_NOME=$NEXT_PUBLIC_MANUAL_PIX_NOME \
    NEXT_PUBLIC_MANUAL_PAGAMENTO_URL=$NEXT_PUBLIC_MANUAL_PAGAMENTO_URL
# Turbopack usa raiz do workspace para resolver o pacote `next`
RUN cd apps/web && node_modules/.bin/next build

FROM node:24.15.0-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup -S app && adduser -S app -G app

COPY --from=builder --chown=app:app /repo/apps/web/.next/standalone ./
COPY --from=builder --chown=app:app /repo/apps/web/public ./apps/web/public
COPY --from=builder --chown=app:app /repo/apps/web/.next/static ./apps/web/.next/static

USER app
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/api/health', r => process.exit(r.statusCode < 500 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "apps/web/server.js"]
