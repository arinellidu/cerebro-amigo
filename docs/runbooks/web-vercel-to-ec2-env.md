# Runbook — Env mapping Vercel → EC2 (migração do frontend web)

Migração do `apps/web` da Vercel para o box clínico EC2 (`sa-east-1`). Mata cold
start (container = `node server.js` sempre quente) e sai da Vercel (cartão/custo).
Container `web` já existe no `docker-compose.yml`; standalone já configurado em
`next.config` (`output: "standalone"` quando `!VERCEL`). Falta: roteamento (Caddy,
ver `infra/caddy/web-vhost.Caddyfile`), DNS e **este mapping de env**.

## Duas classes de variável (a distinção que quebra a migração)

| Classe | Quando é lida | Onde colocar no box |
| --- | --- | --- |
| **Server / runtime** | a cada request, dentro do `node server.js` | `.env` do box (o compose já faz `env_file: .env`) |
| **`NEXT_PUBLIC_*`** | **no `next build`** — inlined no bundle do cliente | **build-arg** no `docker build` (CI) + `ARG`/`ENV` no Dockerfile builder |

⚠️ Na Vercel as `NEXT_PUBLIC_*` vinham do dashboard no momento do build. No Docker
o build roda no CI (GitHub Actions); se não forem passadas como `--build-arg`,
saem **vazias** do bundle → `NEXT_PUBLIC_TURNSTILE_SITE_KEY` quebra o captcha do
signup e `NEXT_PUBLIC_VAPID_PUBLIC_KEY` quebra o Web Push. Esse container nunca foi
o frontend live (Vercel servia), por isso o bug ainda não apareceu.

## Server / runtime — vão no `.env` do box

Já injetadas pelo bloco `environment:` do compose (não duplicar no `.env`):

| Var | Valor no box |
| --- | --- |
| `API_GATEWAY_URL` | `http://api-gateway:5000` (interno do compose — **não** mais a URL pública) |
| `ORCHESTRATOR_PY_URL` | `http://orchestrator-py:8081` |
| `AGENTS_PY_URL` | `http://agents-py:8082` |
| `NOTIFIER_PY_URL` | `http://notifier-py:8083` |
| `CHECKUP_METRICS_URL` | `https://checkup.cerebroamigo.com.br/api/funnel-metrics` |

Faltam no `.env` do box (copiar do dashboard da Vercel):

| Var | Origem | Nota |
| --- | --- | --- |
| `CHECKUP_METRICS_TOKEN` | SSM SecureString | mesmo valor do checkup; sem ele cockpit = 503 |
| `CHECKUP_EVENTS_URL` | Vercel | endpoint de eventos do checkup que o web chama |
| `INTERNAL_API_TOKEN` | SSM | Bearer p/ o BFF falar com serviços internos |
| `FRONTEND_URL` | `https://www.cerebroamigo.com.br` | URLs absolutas; conferir que não usa `VERCEL_URL` |
| `PORTAL_PACIENTE_URL` | `https://www.cerebroamigo.com.br/p` | links do portal |

## `NEXT_PUBLIC_*` — build-arg no CI + ARG no Dockerfile

Lista (todas do dashboard da Vercel):

```
NEXT_PUBLIC_TURNSTILE_SITE_KEY     # captcha signup médico (ADR-055)
NEXT_PUBLIC_VAPID_PUBLIC_KEY       # Web Push (PWA paciente)
NEXT_PUBLIC_HUB_URL                # link do hub (MyBestBrain card)
NEXT_PUBLIC_MANUAL_PIX_CHAVE       # checkout PIX manual
NEXT_PUBLIC_MANUAL_PIX_NOME
NEXT_PUBLIC_MANUAL_PAGAMENTO_URL
```

### Patch no `apps/web/Dockerfile` (stage builder), antes do `next build`:

```dockerfile
# --- NEXT_PUBLIC_* precisam existir NO BUILD (inlined no bundle do cliente) ---
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
# (linha do next build já existe abaixo)
```

### No CI (`.github/workflows/deploy.yml`), no step de build da imagem web:

```yaml
- name: Build web image
  run: |
    docker build -f apps/web/Dockerfile \
      --build-arg NEXT_PUBLIC_TURNSTILE_SITE_KEY="${{ secrets.NEXT_PUBLIC_TURNSTILE_SITE_KEY }}" \
      --build-arg NEXT_PUBLIC_VAPID_PUBLIC_KEY="${{ secrets.NEXT_PUBLIC_VAPID_PUBLIC_KEY }}" \
      --build-arg NEXT_PUBLIC_HUB_URL="${{ secrets.NEXT_PUBLIC_HUB_URL }}" \
      --build-arg NEXT_PUBLIC_MANUAL_PIX_CHAVE="${{ secrets.NEXT_PUBLIC_MANUAL_PIX_CHAVE }}" \
      --build-arg NEXT_PUBLIC_MANUAL_PIX_NOME="${{ secrets.NEXT_PUBLIC_MANUAL_PIX_NOME }}" \
      --build-arg NEXT_PUBLIC_MANUAL_PAGAMENTO_URL="${{ secrets.NEXT_PUBLIC_MANUAL_PAGAMENTO_URL }}" \
      -t $ECR/cerebro-amigo/web:$TAG .
```

`NEXT_PUBLIC_*` não são segredo (vão pro cliente de qualquer forma), mas ficam em
GitHub Secrets por conveniência de um lugar só.

## Vars da Vercel que somem off-Vercel (conferir fallback)

`VERCEL`, `VERCEL_URL`, `VERCEL_ENV`, `VERCEL_PROJECT_PRODUCTION_URL`,
`NEXT_PUBLIC_VERCEL_OBSERVABILITY_BASEPATH` — auto-setadas pela Vercel; no box
ficam `undefined`. `next.config` já trata `VERCEL` (standalone + images
unoptimized). Conferir que nenhum código monta URL absoluta a partir de
`VERCEL_URL` (usar `FRONTEND_URL`).

## Gotchas

- **next/image**: off-Vercel está `unoptimized:true` → serve original. Aceitar, ou
  add `sharp`, ou resize via CloudFront (`infra/aws/cloudfront-checkup.yaml` de modelo).
- **Server Actions origin** (Next 16): se der "Invalid Server Actions request",
  setar `experimental.serverActions.allowedOrigins` no `next.config` com
  `www.cerebroamigo.com.br`. Caddy passa `Host` original → normalmente ok.
- **Cookies httpOnly** (`auth_token`/`paciente_token`): domínio `cerebroamigo.com.br`
  não muda → sessões sobrevivem ao cutover.
- **Warming cron** (do downgrade): vira **desnecessário** com container quente — remover.

## Ordem de cutover (DNS por último)
1. Patch Dockerfile + CI (build-arg) · 2. Preencher `.env` do box · 3. `docker compose up -d web` + healthy · 4. Anexar `web-vhost.Caddyfile` + `caddy reload` (TLS LE) · 5. Testar via `/etc/hosts` · 6. **Só então** repontar DNS www+apex → IP do box · 7. Desligar Vercel · 8. ADR (supersede "web na Vercel").
