# Go-Live Checklist — Cérebro Amigo V3

Consolida os gates de lançamento (cobrar médicos reais + abrir checkup público no modo
**full público**). Verdito: o **código está pronto** — os gates abaixo são quase todos
**ops / Adonai / Patrick**. Ordem por risco. Marque `[x]` ao concluir.

> Já resolvido em código (PRs #108 + de-risk): CSRF logout (T1-9), BFF barra token de
> paciente (T1-10), logout não-silencioso, HSTS + Permissions-Policy no web, gotcha `$$`
> no `.env.example`, reconcile Asaas agendado detect-only. CRM no signup já é hard-gate
> (CFM/Infosimples) — só confirmar env (Gate 2).

## Gate 1 — Segurança clínica (Adonai + ops) · INEGOCIÁVEL
Runbook: `crisis-resilience-rollout.md`.
- [ ] (Adonai) Curar + atestar `_TERMOS_CRISE_RAW` → `LISTA_ATESTADA=True`.
- [ ] (Adonai) Revisar copy → `INSTABILIDADE_COPY.atestado=True`.
- [ ] (ops+Adonai) Validar em `SHADOW_MODE=true` em staging (triggers + outage simulado).
- [ ] (ops) Flip `CRISIS_RESILIENCE_ENABLED=true` + `docker compose up -d --force-recreate orchestrator-py` + `/ready` 200.
> Sem isto, o incidente de 2026-06-17 (flood de crise em outage de LLM) **repete**.

## Gate 2 — Dinheiro / custo (ops/Patrick)
- [ ] **RDS Reserved Instance**: corrigir cartão + re-comprar RI `db.t4g.small` Multi-AZ (RI falhou `payment-failed`, RDS roda on-demand ~$70/mês a mais; crédito AWS acabou jun/2026).
- [ ] Confirmar env de prod no box (`.env`), conferindo contra `.env.example`:
  - `ASAAS_ENV=prod` · `ASAAS_API_KEY` (⚠ dobrar `$$` — vide `.env.example`) · `ASAAS_WEBHOOK_TOKEN` · `RESEND_API_KEY` (clínico).
  - `CRM_VALIDATION_ENABLED=true` + `INFOSIMPLES_TOKEN` (senão o signup aceita CRM `NaoValidado` — bypass).
- [ ] (opcional) `ASAAS_RECONCILE_INTERVAL_HORAS` (default 24) — job já loga divergência local×Asaas.

## Gate 3 — Aquisição / checkup (ops + Adonai)
- [ ] **CK-4 — e-mail do checkup**: `RESEND_API_KEY` no SSM `/cerebro-amigo/checkup/resend-api-key` + domínio verificado no Resend (SPF/DKIM/DMARC). Sem isso `/api/email-report` = 502 → sem captura de lead.
- [ ] **Decouple do checkup (full público)**: provisionar ASG+ALB. Runbook `checkup-decouple-readiness.md` (Gate 0 da role `checkup_app` primeiro!) → `checkup-decouple-cutover.md`.
- [ ] (Adonai) Revisor SEO E-E-A-T real (CRM + consentimento) → `apps/checkup/src/lib/seo/reviewer.ts` (hoje `null`, seguro). *Launch-week.*
- [ ] (ops) GSC: TXT no DNS (Vercel) p/ monitorar tráfego orgânico no dia 1. *Launch-week.*

## Gate 4 — DNS / rede (ops)
- [ ] **Apex `cerebroamigo.com.br`** ainda na Vercel (Route53 bloqueado: zona ilegível p/ Rafaela). `www` já no EC2. Resolver acesso à zona → apontar apex→ALB.

## Gate 5 — Resiliência (full público) (ops)
- [ ] **SPOF do EC2**: `web` + 5 serviços clínicos num box só. ADR-043 item B (2ª instância + ALB) antes do push de tráfego.
- [ ] **RDS**: ligar Performance Insights + orçar RDS Proxy (`max_connections=181`; checkup ASG 1→6 pressiona).

## Não-blocker (já ok / deferido)
- Asaas prod: cutover concluído 2026-06-16 (smoke R$5, webhook ativo). Resíduo (Patrick): prova orgânica do auto-flip no próximo pagamento real.
- CSP enforce no `apps/web`: follow-up (inventariar origens S3/Turnstile/WebRTC + rollout Report-Only). HSTS + Permissions-Policy já no ar.
- Testes unitários de `isSameOrigin` (web sem test runner) · background sync PWA (T4-5).
