---
name: env-reference
description: Variáveis de ambiente detalhadas de features inativas/opcionais do portfólio — Bedrock (embeddings/caminho futuro de LLM), checkup longitudinal (ADR-050 Parte 2), Cockpit de Aquisição (ADR-046/050), teleconsulta/TURN (ADR-026) e RAG/embeddings (ADR-028). Use ao configurar, depurar ou deployar qualquer uma dessas features, ao mexer no compose/env delas, ou ao encontrar essas variáveis em código.
---

# Referência de variáveis de ambiente por feature

Movido verbatim do `CLAUDE.md` raiz (doctor, 2026-07-26). As vars core, LLM (ADR-044), Azure Blob/Speech (ADR-082), Checkup base e captcha (ADR-055) continuam no raiz. Regra geral inalterada: **segredos sempre via Key Vault/secret manager, nunca em arquivo comitado.**

**Bedrock (somente embeddings/RAG + caminho futuro de LLM):** `AWS_REGION=sa-east-1` · `BEDROCK_REGION=sa-east-1` · `BEDROCK_MODEL_HAIKU`/`BEDROCK_MODEL_SONNET`/`BEDROCK_MODEL_OPUS` (inativos enquanto `LLM_PROVIDER=anthropic`) · credenciais via IAM role (prod) ou `AWS_PROFILE` (dev). Última dependência AWS de runtime (DEBT T1-10); no portfólio `EMBEDDINGS_ENABLED=false`.

**Checkup longitudinal (ADR-050 Parte 2):** `NEXT_PUBLIC_CHECKUP_TRACKING_ENABLED` (flag dark; opt-in/cron só ativam se `=true` — manter `false` até SES no ar) · `CHECKUP_ENCRYPTION_KEY` (SSM SecureString — cifra/decifra `email_enc` via pgp_sym, padrão ADR-018; sem ela `/api/tracking` e o cron são fail-closed 503; **nunca comitar**) · `CHECKUP_CRON_TOKEN` (SSM SecureString — Bearer dos `POST /api/tracking/cron` (envio) e `/api/tracking/retention` (purga), disparados por scheduler externo/EventBridge; sem ele = 503) · `CHECKUP_TRACKING_RETENTION_DAYS` (opcional, default 365 — TTL da purga). Envio do nudge usa SES in-region (role do EC2/ASG), **depende de SES production-access (CK-4)**. Operação: runbook `docs/runbooks/checkup-tracking-retention.md`.

**Cockpit de Aquisição (ADR-046/ADR-050):** `CHECKUP_METRICS_TOKEN` (SSM SecureString — **mesmo valor** no web/BFF e no checkup; o checkup valida e responde **503 fail-closed** sem ele) · `CHECKUP_METRICS_URL` (web; default `https://checkup.cerebroamigo.com.br/api/funnel-metrics`). O BFF clínico junta as duas fontes isoladas (gateway `public` + checkup `checkup`) — o gateway **nunca** lê o schema `checkup`.

**Teleconsulta (vídeo P2P, ADR-026):** `STUN_URLS` · `TURN_URLS` · `TURN_SECRET` · `TURN_TTL_SECONDS` · `TURN_REALM` · `TURN_EXTERNAL_IP`; coturn no compose sob `profiles: ["turn"]` (prod: `COMPOSE_PROFILES=turn`). Mídia E2E, sem gravação.

**RAG / embeddings (ADR-028):** `EMBEDDINGS_ENABLED` · `BEDROCK_EMBED_MODEL=cohere.embed-multilingual-v3` (on-demand in-region 1024-dim; **NÃO** usar `cohere.embed-v4` = profile global cross-region) · `RAG_TOP_K` · `RAG_INDEX_INTERVAL_HOURS`. Embedding é sempre Bedrock in-region (LGPD), independente de `LLM_PROVIDER`. Decifra fonte com `ENCRYPTION_KEY` antes de indexar (ADR-018).
