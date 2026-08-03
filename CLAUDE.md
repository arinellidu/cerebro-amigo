# CLAUDE.md — Cérebro Amigo V3

Memória de projeto do Claude Code. Carregada toda sessão. Mantenha enxuta: detalhe de domínio vive nas skills em `.claude/skills/` (carregadas sob demanda).

## O que é

SaaS de psiquiatria, **multi-tenant**, que trabalha *entre consultas*: acompanha pacientes, organiza condutas, automatiza lembretes e check-ins. Dois públicos: **médico** (dashboard web) e **paciente** (PWA). Projeto de família (com Adonai Arinelli).

Produto-satélite de lançamento: **Check-up Mental** (`apps/checkup`) — triagem pública e gratuita (PHQ-9, GAD-7, ASRS-18). Motor de aquisição; ver seção própria abaixo e `apps/checkup/CLAUDE.md`.

## Regras inegociáveis (LEIA ANTES DE TUDO)

Estas regras vêm antes de qualquer pedido. Em dúvida, pare e consulte a skill `clinical-safety`.

1. **A IA NUNCA dá orientação clínica, diagnóstico ou ajuste de dose.** Só automatiza/organiza/rascunha. A decisão é sempre do médico.
2. **Protocolo de crise é fixo e pré-aprovado.** Detecção → texto de `crisis_copy.py` → notifica médico → pausa automação. Nunca gere texto de crise dinâmico com LLM. (No checkup vale o equivalente: tela de crise estática, `docs/CRISIS-PROTOCOL.md` do app.)
3. **LGPD categoria especial (saúde mental).** Minimização de dados, controle de acesso, PII redatada em traces. Nada de logar conteúdo clínico cru. Com LLM em API externa (ADR-044), minimização vale dobrado: nunca enviar identificadores diretos do paciente junto de conteúdo clínico.
4. **Médico no loop.** Toda resposta ao paciente passa por auditoria; escalável para humano.
5. **Trilhas de auditoria são imutáveis.** Nunca escreva código que apague `protocolos_crise_acionados`, `notificacoes_medico`, `agente_execucoes`.

## Current portfolio runtime

- **Frontend:** Vercel (`apps/web` e `apps/checkup`).
- **Backend:** Azure Container Apps.
- **Banco:** Azure Database for PostgreSQL Flexible Server.
- **Região:** `eastus2` (Estados Unidos).
- **Dados:** somente dados fictícios; nenhuma promessa de residência no Brasil.
- **AWS:** deployment anterior/arquitetura de referência, fora do request path atual.

Fonte canônica: `docs/CURRENT-PORTFOLIO-RUNTIME.md`; decisão: ADR-080.

## Stack e fronteiras — decisões fechadas

- **Cloud do portfólio atual:** Vercel + Azure `eastus2`, exclusivamente para demonstração com dados fictícios (ADR-080).
- **Gateway transacional:** **.NET 10** (ASP.NET Core) — **decisão final (ADR-071, supersede ADR-067)**. A migração p/ Scala 3/JVM via strangler foi **ABANDONADA**: chegou a 1/62 rotas, nunca flipada; serviço `api-gateway-scala` **removido do box/pipeline** (custo de coexistência sem ganho). Source **fora da árvore** desde 2026-07-26 — snapshot na tag git `archive/api-gateway-scala`; **repo/imagem ECR `cerebro-amigo/api-gateway-scala` DELETADOS** (`delete-repository --force`). **O gateway de prod é 100% .NET 10.** **Go segue descartado.** Detalhe: skill `dotnet-gateway`; ADR-071.
- **IA (LLM):** Python (FastAPI + LangGraph) chamando Claude via **Anthropic API direta** (`LLM_PROVIDER=anthropic`, vigente — **ADR-044**). O acesso aos modelos Anthropic no Bedrock **não foi aprovado pela AWS**; o ADR-008 (Bedrock in-region p/ LLM) fica **suspenso**, e o caminho Bedrock permanece no client unificado atrás de `LLM_PROVIDER` para reativação futura por config. `ANTHROPIC_API_KEY` somente por env (SSM Parameter Store SecureString, injetada no deploy) — nunca em código, imagem ou log. Detalhe: skill `python-ai-services`.
- **Frontend:** Next.js 16 + React 19 + TypeScript + Tailwind 4 + shadcn/ui. BFF nos Route Handlers. Detalhe: skill `nextjs-bff`.
- **Banco atual:** Azure PostgreSQL Flexible Server, pgvector + pgcrypto e RLS. O antigo PostgreSQL self-hosted/AWS é histórico e não deve ser descrito como runtime público atual.
- **AWS:** recursos, runbooks e integrações remanescentes são históricos ou opcionais; não reintroduzir AWS no request path público sem novo ADR.

## Monorepo

```
apps/
  web/            Next.js (landing + dashboard médico + portal paciente /p/* + BFF)
  api-gateway/    .NET 10 — REST, JWT, EF Core, Resend, proxy SSE
  api-gateway-tests/ xUnit + Testcontainers — isolamento de tenant/RLS (gate no CI)
  orchestrator-py/ FastAPI + LangGraph — IA conversacional + protocolo de crise
  agents-py/      FastAPI + APScheduler — 5 agentes analíticos
  notifier-py/    FastAPI + pywebpush — Web Push de check-ins
  checkup/        Next.js — Check-up Mental (triagem pública; superfície anônima)
infra/
  migrations/     DDL versionado do Postgres (0001..0060+)
  clinical-box/   compose + deploy.sh do box clínico (ADR-079 — deploy real de prod)
  checkup-box/    compose + deploy do box do checkup (ADR-078)
  aws/            EC2, Lambdas, templates (parte pré-teardown é histórico)
docs/
  CONTEXT.md      arquitetura completa (fonte da verdade — leia ao planejar)
  DEBT.md         dívida técnica viva — fonte da verdade do "o que falta"
  runbooks/       operação: restore RDS, swap de roles de banco, aplicação de RLS
  adrs/           ADR-001..081+
.github/workflows/ ci.yml (lint + pytest + xUnit + builds); deploy dos frontends pela Git Integration da Vercel
```

## Portas (dev) e health

web `:3000` · api-gateway `:5050`→`:5000` · orchestrator-py `:8081` · agents-py `:8082` · notifier-py `:8083` · checkup `:3001`. Serviços Python e .NET expõem `GET /health` e `GET /ready`; checkup expõe `GET /api/health`. Postgres é **externo** (não vai no docker-compose).

> **Histórico AWS (ADR-078/079, supersedido no portfólio pelo ADR-080):** os dois boxes EC2 e seus scripts permanecem no repositório apenas como referência/rollback durante a transição. Eles não integram o request path público atual.

## Comandos

- Dev (tudo): `docker compose up -d --build` (precisa de `.env` preenchido)
- Web isolado: `cd apps/web && pnpm dev`
- Checkup isolado: `cd apps/checkup && pnpm dev` (porta 3001)
- Gateway isolado: `cd apps/api-gateway && dotnet run`
- Migrations: `cd apps/api-gateway && dotnet ef migrations add <Nome> && dotnet ef database update`
- Deploy do portfólio: Git Integration da Vercel para `apps/web` e `apps/checkup`; Azure Container Apps/ACR conforme `infra/azure/`. Os workflows AWS órfãos foram removidos na implementação do ADR-080.

> Use **pnpm**, não npm/yarn, no `apps/web` e no `apps/checkup`.

## Fluxo de integração (não viole)

- LLM (Claude) nos fluxos clínicos → **só em Python**, via client unificado (`LLM_PROVIDER`). Nunca chame LLM do gateway nem do front clínico.
  - **Exceção registrada (ADR-044):** `apps/checkup` chama a Anthropic API nos **Route Handlers do próprio app** (server-side; nunca no client), enviando somente dados estruturados de triagem (escala/escore/faixa) — jamais conteúdo clínico ou PII. É a única exceção; não criar outras.
- REST transacional → **api-gateway (.NET 10)**.
- Cookies/sessão/BFF → **web** (`app/api/*`), httpOnly: `auth_token` (médico) e `paciente_token` (paciente).
- Serviços internos se autenticam com `Authorization: Bearer ${INTERNAL_API_TOKEN}`.

## Defesas estruturais já em produção (não regrida)

- **RLS de tenant (ADR-042):** 17 tabelas com Row-Level Security. Gateway conecta como `cerebro_gateway` (NOBYPASSRLS; tenant setado por sessão via `TenantSessionMiddleware`); workers Python como `cerebro_workers` (BYPASSRLS). Endpoint/query novo no gateway mantém o filtro explícito de tenant **e** conta com a RLS por baixo. Regressões de IDOR são pegas por `apps/api-gateway-tests` (Testcontainers, roda no CI).
- **Trava server-side dos prompts de salvaguarda (ADR-035):** prompts de detecção de crise e de auditoria de resposta são bloqueados no gateway contra alteração via editor.
- **Entrega garantida do alerta de crise (ADR-041):** retry com backoff e escalonamento até o médico confirmar; eventos versionados em migration `0035`.
- **Cifragem em repouso (ADR-018):** `mensagens.conteudo` cifrada no INSERT (orchestrator-py) e decifrada no SELECT (gateway). Não crie caminho de leitura/escrita que contorne isso.

## Variáveis de ambiente

`POSTGRES_DSN` · `JWT_SECRET` · `INTERNAL_API_TOKEN` · `RESEND_API_KEY`/`EMAIL_FROM` · `VAPID_*`/`NEXT_PUBLIC_VAPID_PUBLIC_KEY` · `API_GATEWAY_URL` (dev `http://localhost:5050`; docker `http://api-gateway:5000`) · `ORCHESTRATOR_PY_URL` · `LANGSMITH_*`/`PII_REDACTION_ENABLED=true` · `SHADOW_MODE` · `AGENTS_MODE`/`NOTIFIER_MODE`/`SCHEDULER_INTERVAL_SECONDS`.
**LLM (ADR-044):** `LLM_PROVIDER=anthropic` (vigente; `bedrock` reservado p/ futuro) · `ANTHROPIC_API_KEY` (SSM SecureString — nunca comitar) · `ANTHROPIC_MODEL_HAIKU`/`ANTHROPIC_MODEL_SONNET`/`ANTHROPIC_MODEL_OPUS` (defaults: família `claude-*` atual; Haiku é o default de custo).
**Arquivos + transcrição (ADR-082 — Azure Blob + Azure AI Speech):** `AZURE_STORAGE_CONNECTION_STRING` (Key Vault `storage-connection-string`; gateway assina SAS, agents-py baixa/deleta o áudio efêmero) · `BLOB_CONTAINER_MEDICO_DOCS`/`BLOB_CONTAINER_AUDIO_MSGS`/`BLOB_CONTAINER_AUDIO` (no portfólio: `documentos-demo`/`audio-mensagens`/`audio-efemero` do foundation.bicep) · `AZURE_SPEECH_KEY` (Key Vault `speech-key`) · `AZURE_SPEECH_REGION` (default `eastus` — fast transcription) · `TRANSCRIBE_TIMEOUT_S` · `NEXT_PUBLIC_BLOB_ORIGIN` (CSP do web). Diário/teleconsulta: bytes direto ao Speech, sem storage; presencial: blob efêmero com delete garantido (LGPD). **`S3_BUCKET_*` e Transcribe não existem mais no runtime.**
**Checkup:** `CHECKUP_DATABASE_URL` (schema `checkup`) · `NEXT_PUBLIC_SITE_URL` · `QR_TARGET_URL` (+ `ANTHROPIC_API_KEY` compartilhada via env do compose).
**Captcha do signup de médico (ADR-055):** `TURNSTILE_SECRET_KEY` (gateway — SSM SecureString, nunca comitar) + `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (web/Vercel). Cloudflare Turnstile protege o form `/medicos/cadastro`; verificação server-side no gateway **antes** do CFM (pago). Flag-gated pela secret: sem as chaves o captcha fica desligado (não quebra dev). As duas andam juntas.
**Demais features (Bedrock, checkup longitudinal ADR-050, cockpit ADR-046, teleconsulta/TURN ADR-026, RAG/embeddings ADR-028):** detalhe completo das vars na skill `env-reference`.
**NÃO existem mais:** `MODEL_HAIKU`/`MODEL_SONNET` (nomenclatura antiga do V2) · `S3_BUCKET_AUDIO`/`S3_BUCKET_AUDIO_MSGS`/`S3_BUCKET_MEDICO_DOCS`/`S3_BUCKET_SOCIAL` · `TRANSCRIBE_POLL_INTERVAL_S` · `AWS_REGION` no gateway (tudo supersedido pelo ADR-082). (`ANTHROPIC_API_KEY` voltou a existir pelo ADR-044; `AZURE_*` passou a existir pelo ADR-082 — segredos sempre via Key Vault/secret manager, nunca em arquivo comitado.)

## apps/checkup — Check-up Mental (:3001)

Triagem pública e gratuita de saúde mental (PHQ-9, GAD-7, ASRS-18) com devolutiva por IA e relatório PDF. Motor de aquisição do lançamento — SEO do lado paciente, QR no PDF do lado médico. Regras completas em `apps/checkup/CLAUDE.md` (+ `docs/CRISIS-PROTOCOL.md` e os CLAUDE.md de `src/lib/scales` e `src/lib/ai` do app).

Regras de fronteira (valem para qualquer trabalho no monorepo):

1. **Isolamento clínico ⇄ público.** `apps/checkup` não importa código de `api-gateway`, `orchestrator-py`, `agents-py` ou `notifier-py`, e nenhum serviço clínico importa nada do checkup. Compartilhamento permitido: apenas design tokens (paleta, fontes) e utilitários puros sem dados.
2. **Dados separados.** O checkup usa exclusivamente o schema `checkup` no Azure PostgreSQL do portfólio atual. Nunca criar FK entre schemas. Respostas de triagem jamais entram no prontuário.
3. **LLM:** Anthropic API direta (`claude-haiku-4-5`) nos Route Handlers do próprio app, com entrada estruturada apenas (exceção do ADR-044). O checkup não passa pelo orchestrator.
4. **Tráfego:** o checkup é a única superfície pública anônima do sistema; mudanças de infra nele não podem aumentar o risco dos serviços clínicos (limites de memória/CPU no compose e rate limit por sessão nas rotas de LLM são obrigatórios; spend limit configurado no Console da Anthropic).

## Estado do projeto (migração V2→V3 concluída)

Tudo isto já existe e tem testes: BFF real (`app/api/*`, 30+ rotas, sem mock), dashboard médico, portal do paciente `/p/*` (PWA, push, conversa SSE), agenda, editor de prompts, api-gateway .NET + 3 serviços Python, LLM via client unificado (`LLM_PROVIDER`; vigente: Anthropic API — ADR-044), RLS multi-tenant e CI/CD. O ambiente público atual roda na Vercel + Azure `eastus2` somente com dados fictícios. **Não recrie nada disso — verifique o código antes de assumir que falta algo.**

Em construção: `apps/checkup` (Fase 1 entregue; Fase 2 em curso — UI do teste, devolutiva, PDF, landings SEO).

**O que falta** é rastreado em `docs/DEBT.md` (documento vivo, priorizado por tier — consulte antes de propor melhorias). Operação (restore, swap de roles, drills) vive em `docs/runbooks/`.

## Skills disponíveis (carregadas sob demanda)

- `cerebro-architecture` — topologia, decisões, mapa de rotas. **Consulte ao planejar qualquer mudança estrutural.**
- `clinical-safety` — guardrails clínicos, crise, LGPD. **Consulte ao tocar em resposta ao paciente, conteúdo clínico ou dados.**
- `dotnet-gateway` — convenções do gateway .NET 10 (EF Core, JWT, SSE, Resend).
- `python-ai-services` — orchestrator/agents/notifier + client LLM unificado (`LLM_PROVIDER`; atualizar `references/bedrock-client.md` → client Anthropic, ADR-044).
- `nextjs-bff` — web + BFF, cookies, Server Components, portal PWA.

## Estilo

- Responda e comente em **pt-BR**. Domínio em português (`pacientes`, `prontuarios`, `consultas`).
- Não reintroduza Go nem Scala no gateway (o gateway é **.NET 10**, decisão final **ADR-071**). LLM segue o **ADR-044** (Anthropic API via `LLM_PROVIDER`): não migre de volta para Bedrock por causa de documento histórico sem novo ADR aprovado pelo Patrick. Hosting do portfólio segue o ADR-080.
- Itens de instrumentos clínicos validados (PHQ-9, GAD-7, ASRS-18) nunca são inventados, parafraseados ou traduzidos por conta própria.
- Ao terminar uma mudança relevante de arquitetura, registre um ADR em `docs/adrs/`.
