# Runbook — deploy do signup externo de médico (ADR-046, Fase 5)

> **Cérebro Amigo** · https://www.cerebroamigo.com.br — motor de aquisição: Check-up Mental (`checkup.cerebroamigo.com.br`).

Coloca em produção o auto-cadastro de médico externo + atribuição do Check-up.
Fases 1-4 **implementadas e consolidadas no repositório** (migrations `0041`/`0042`,
`MedicoOnboardingService`, endpoint público `/auth/medico/signup`, web `/medico` +
`/medicos/cadastro` + BFF). Toca **auth clínico** + duas migrations. **A ordem importa.**

Topologia (reconciliada):
- **gateway** (.NET) + **checkup** (events) → EC2/ASG via pipeline (`deploy-clinical` / `deploy-checkup`).
- **web** (`/medico`, `/medicos/cadastro`, BFF) → **Vercel** (projeto www git-conectado, rootDir `apps/web`).

---

## ⚠️ Fase 0 — Migrations ANTES do código (bloqueia tudo)

O INSERT de onboarding (admin **e** self-signup) já referencia `medicos.signup_source` /
`checkup_rid`; o checkup grava `funnel_events.rid`. Se o gateway/checkup subir **antes** das
migrations, o INSERT quebra. Aplicar **primeiro**, via box (alcança o RDS), como o Gate 0:

> ⚠️ **DB ALVO = `cerebro_v3`** (NÃO `cerebro`, o V2 legado). O `/opt/cerebro/.env` do box está
> **stale** (`POSTGRES_DB=cerebro`) — a DSN abaixo já força `cerebro_v3`; não confie no `.env`.
> (mesmo gotcha do runbook `apply-0038-rls-iteracao2.md`.)

```bash
# No Session Manager do box i-057860cd97edafefb (psql via docker, admin cerebroadmin).
# As migrations 0041/0042 já estão consolidadas no repo. Aplicar ANTES do merge/deploy (Fase 2).
# BRANCH = a branch do PR do ADR-046 (antes do merge) OU main (depois do merge).
BRANCH=main
ADMIN='postgresql://cerebroadmin:<SENHA>@cerebro-postgres.ch8u4aig6zs6.sa-east-1.rds.amazonaws.com:5432/cerebro_v3?sslmode=require'
cd /opt/cerebro-amigo-v3 && git fetch origin
git show origin/$BRANCH:infra/migrations/0041_medicos_signup_attribution.sql | sudo docker run --rm -i postgres:16-alpine psql "$ADMIN" -v ON_ERROR_STOP=1 -f -
git show origin/$BRANCH:infra/migrations/0042_checkup_funnel_events_rid.sql | sudo docker run --rm -i postgres:16-alpine psql "$ADMIN" -v ON_ERROR_STOP=1 -f -
```

Confere (deve listar as colunas novas):
```sql
\d medicos          -- signup_source, checkup_rid presentes
\d checkup.funnel_events  -- session_id nullable, rid presente
```

> Migrations são aditivas/idempotentes (`ADD COLUMN IF NOT EXISTS`, `DROP NOT NULL`). Seguras de re-rodar.

## Fase 1 — Env (confirmar, já devem existir)

- **Gateway:** `INFOSIMPLES_TOKEN`, `CRM_VALIDATION_ENABLED`, `RESEND_API_KEY`/`EMAIL_FROM`,
  `PORTAL_PACIENTE_URL` (link de ativação) — já usados pelo onboarding admin.
- **Captcha (ADR-055):** `TURNSTILE_SECRET_KEY` no **gateway** (SSM SecureString) +
  `NEXT_PUBLIC_TURNSTILE_SITE_KEY` na **Vercel** (web). As duas andam juntas: sem elas o
  captcha fica desligado (sem proteção, mas não quebra). Gerar no Cloudflare Turnstile (gratuito).
- **Vercel (web):** `API_GATEWAY_URL=https://api.cerebroamigo.com.br` (já existe p/ os outros BFF).
  `CHECKUP_EVENTS_URL` — opcional (default `https://checkup.cerebroamigo.com.br/api/events`).

## Fase 1b — Ativar o captcha Turnstile (ADR-055)

Opcional, mas recomendado antes de divulgar o cadastro orgânico. **Flag-gated:** enquanto as
duas chaves não estiverem setadas, o captcha fica desligado (o signup funciona sem ele). As
**duas andam juntas**. Gerar o widget no Cloudflare Turnstile (gratuito) → obter a `site key`
(pública) e a `secret key` (segredo). **Nunca** comitar a secret.

**1. Site key → Vercel** (build-time; exige rebuild)
- Painel: Project → Settings → Environment Variables → `NEXT_PUBLIC_TURNSTILE_SITE_KEY` =
  `<SITE_KEY>`, scopes **Production + Preview**. Ou via CLI:
  ```bash
  vercel env add NEXT_PUBLIC_TURNSTILE_SITE_KEY production   # repetir p/ preview
  ```
- Redeploy o www (a `NEXT_PUBLIC_*` só entra no bundle client num novo build).

**2. Secret → gateway (box)** (runtime; lida via `env_file: .env`)
```bash
# box i-057860cd97edafefb via Session Manager
cd /opt/cerebro-amigo-v3
grep -q '^TURNSTILE_SECRET_KEY=' .env || echo 'TURNSTILE_SECRET_KEY=<SECRET_KEY>' >> .env
docker compose up -d api-gateway     # relê o .env e recarrega a secret
# (opcional) guardar no SSM p/ sobreviver a reprovisionamento do box:
aws ssm put-parameter --region sa-east-1 --type SecureString \
  --name /cerebro-amigo/turnstile/secret-key --value '<SECRET_KEY>'
```
> O `api-gateway` no compose usa `env_file: .env` → basta a var estar no `.env` do box; sem
> mudança de compose nem de imagem. O deploy clínico **não regenera** o `.env` (só
> `git pull && docker compose up`), então editar o `.env` é o passo manual de verdade.

**Desativar / rotacionar:** remover as duas chaves (ou só a secret) volta o captcha ao estado
desligado. Para rotacionar, gerar novo par no Turnstile e repetir os passos 1 e 2.

> ⚠️ `NEXT_PUBLIC_*` é build-time: o web do **box** (imagem ECR) não embute a site key — ok,
> porque o `/medicos/cadastro` público é servido pela Vercel. Se um dia o box passar a servir
> o cadastro público, passar `NEXT_PUBLIC_TURNSTILE_SITE_KEY` como build-arg no `docker-bake`.

## Fase 2 — Merge → deploy

Merge do PR em `main` (normal, **sem** `[skip ci]` — queremos deployar). O pipeline (path filter):
- `apps/api-gateway/**` mudou → **deploy-clinical** (recria stack clínico no EC2; blip de crise breve).
- `apps/checkup/**` mudou → **deploy-checkup** (instance refresh do ASG).
- `apps/web/**` mudou → **Vercel** builda o www (separado do pipeline EC2). *(O container web do EC2 também
  recria no deploy-clinical, mas o público `/medicos/cadastro` é servido pela Vercel.)*

CI deploy-checkup precisa das perms IAM já concedidas (`CerebroCheckupAsgDeploy`).

## Fase 3 — Smoke E2E (domínio real)

1. **QR/atribuição:** abrir `https://www.cerebroamigo.com.br/medico?src=checkup&rid=smoke1234` →
   banner aparece; conferir `qr_scanned` no CloudWatch do checkup (sem erro de DB) ou no
   `checkup.funnel_events WHERE rid='smoke1234'`.
2. **Form:** `/medicos/cadastro?src=checkup&rid=smoke1234` → `doctor_signup_started` gravado.
3. **Signup:** preencher com um **CRM Regular real de teste** (nome batendo com CFM) + e-mail teu →
   202 "confira seu e-mail". Conferir: `medicos.signup_source='checkup'`, `checkup_rid='smoke1234'`,
   `crm_situacao='Regular'`; `assinaturas.status='trial'`.
4. **Anti-fraude:** repetir com nome divergente → 422 `nome_divergente`. CRM cancelado → 422 `crm_invalido`.
   6 tentativas rápidas do mesmo IP → 429.
   **Captcha (ADR-055, se as chaves Turnstile estiverem setadas):** o widget aparece no form e o
   POST sem token resolvido → 403 `captcha_invalido`. Sem as chaves, o passo é pulado (desligado).
5. **Ativação:** abrir o link do e-mail (`/ativar-conta?token=`) → define senha → `/login` entra → JWT ok.
6. **Métrica:** `SELECT signup_source, count(*) FROM medicos GROUP BY 1;` e junção
   `funnel_events.rid ⇄ medicos.checkup_rid`.
7. **Cockpit de Aquisição (ADR-050):** abrir `/admin/aquisicao` → métrica norte ("médicos por 1.000 testes") +
   funil de ponta a ponta renderizam. Requer `CHECKUP_METRICS_TOKEN` (mesmo valor no web e no checkup) — sem ele,
   o funil do checkup aparece como indisponível (lado clínico ainda renderiza).

## Rollback

- Código: reverter o merge (gateway/checkup pelo pipeline; web pela Vercel).
- Migrations: aditivas — não precisam reverter (colunas nullable, sem uso quebra nada). Se exigido:
  `ALTER TABLE medicos DROP COLUMN signup_source, DROP COLUMN checkup_rid;` (cuidado: perde atribuição).

## Pendências conhecidas (pós-MVP)
- Teste xUnit dedicado do endpoint `/auth/medico/signup` (mock CfmClient/Resend) — hoje coberto por build + 44 testes de isolamento.
- Enumeração de e-mail (409 `email_em_uso`) — risco baixo (CRM é público); avaliar resposta genérica.
- Spoof de X-Forwarded-For no rate-limit — mitigado por cache 30d do CfmClient + spend limit Infosimples
  + Turnstile (ADR-055) quando ativo.
- Teste xUnit dedicado do endpoint `/api/v1/admin/aquisicao` (Cockpit, ADR-050) — hoje coberto por build; read-only.

---

*Cérebro Amigo by Arinelli · https://www.cerebroamigo.com.br · Check-up Mental — motor de aquisição.*
