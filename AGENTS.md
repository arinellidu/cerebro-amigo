# AGENTS.md — Cérebro Amigo V3

Guia para agentes de IA de código (Cursor, Codex, Copilot, Claude Code, etc.) que trabalham neste repositório. Formato aberto [agents.md](https://agents.md).

> **Fonte canônica:** `CLAUDE.md` (raiz) é a memória de projeto mais detalhada; este AGENTS.md é o espelho portável entre ferramentas. Em conflito, vale `CLAUDE.md` + os ADRs em `docs/adrs/`. Detalhe de domínio mora nas skills em `.claude/skills/` e em `docs/CONTEXT.md` (arquitetura) / `docs/DEBT.md` (o que falta).

---

## O que é

SaaS de **psiquiatria, multi-tenant**, que trabalha *entre consultas*: acompanha pacientes, organiza condutas, automatiza lembretes e check-ins. Dois públicos: **médico** (dashboard web) e **paciente** (PWA `/p/*`). O ambiente público atual é um portfólio com dados exclusivamente fictícios.

Produto-satélite: **Check-up Mental** (`apps/checkup`) — triagem pública e anônima (PHQ-9, GAD-7, ASRS-18), motor de aquisição.

## Current portfolio runtime

- Frontend: Vercel.
- Backend: Azure Container Apps.
- Banco: Azure Database for PostgreSQL Flexible Server.
- Região: `eastus2` (Estados Unidos).
- Dados: somente dados fictícios; nenhuma promessa de residência no Brasil.
- AWS: deployment anterior/arquitetura de referência, fora do request path atual.

Fonte canônica: `docs/CURRENT-PORTFOLIO-RUNTIME.md`; decisão: ADR-080.

---

## ⛔ Regras inegociáveis (LEIA ANTES DE QUALQUER MUDANÇA)

Estas regras vêm antes de qualquer pedido. Em dúvida sobre se algo é clínico, **trate como clínico**.

1. **A IA NUNCA dá orientação clínica, diagnóstico ou ajuste de dose.** Só automatiza/organiza/rascunha. A decisão é sempre do médico.
2. **Protocolo de crise é fixo e pré-aprovado.** Detecção → texto estático de `crisis_copy.py` → notifica médico → pausa automação. **Nunca** gere texto de crise com LLM. O texto vive em DOIS lugares (`orchestrator-py` e `agents-py`) como cópia verbatim, verificada por hash SHA-256 — alterar um sem o outro é erro grave.
3. **Fail-safe de crise (ADR-063):** erro no classificador é tratado COMO crise. Nunca faça `catch & ignore` nessa rota.
4. **LGPD categoria especial (saúde mental).** Minimização de dados, PII redatada em traces, nada de logar conteúdo clínico cru. Com LLM em API externa (ADR-044): nunca enviar identificadores diretos do paciente junto de conteúdo clínico.
5. **Médico no loop.** Toda resposta ao paciente passa por auditoria; escalável para humano.
6. **Trilhas de auditoria são imutáveis.** Nunca escreva código que apague `protocolos_crise_acionados`, `notificacoes_medico`, `agente_execucoes`, `condutas_eventos`, `acessos_prontuario`.
7. **Instrumentos clínicos validados (PHQ-9, GAD-7, ASRS-18) nunca são inventados, parafraseados ou traduzidos** por conta própria.

Antes de tocar em resposta ao paciente, conteúdo clínico, crise, prompt de LLM sobre sintomas/humor/medicação, prescrição ou dado de saúde: consulte a skill `clinical-safety`.

---

## Stack (decisões fechadas — não regredir)

- **Cloud do portfólio atual:** Vercel + Azure `eastus2`, somente dados fictícios (ADR-080).
- **Gateway transacional:** **.NET 10** (ASP.NET Core) — decisão final **ADR-071**. ❌ Não migrar para Go nem Scala (strangler Scala abandonado; source só recuperável). Go descartado.
- **IA (LLM):** **Python** (FastAPI + LangGraph) chamando Claude via **Anthropic API direta** (`LLM_PROVIDER=anthropic`, **ADR-044**). ❌ Não migrar de volta para Bedrock sem novo ADR. Bedrock continua só para embeddings/RAG in-region (LGPD).
- **Frontend/BFF:** Next.js 16 + React 19 + TypeScript (strict) + Tailwind 4 + shadcn/ui. BFF nos Route Handlers (`app/api/*`).
- **Banco:** Azure PostgreSQL Flexible Server, pgvector + pgcrypto. RLS multi-tenant.
- **AWS:** material histórico/de referência; não descreve o runtime público atual.

---

## Monorepo (pnpm workspaces)

```
apps/
  web/              Next.js 16 — landing + dashboard médico + portal paciente /p/* + BFF (App Router em /app)
  checkup/          Next.js 16 — Check-up Mental (triagem pública anônima; App Router em /src/app)
  api-gateway/      .NET 10 — REST, JWT, EF Core, RLS, Resend, proxy SSE (minimal APIs)
  api-gateway-tests/ xUnit + Testcontainers — isolamento de tenant/RLS (gate no CI)
  orchestrator-py/  FastAPI + LangGraph — IA conversacional + protocolo de crise (:8081)
  agents-py/        FastAPI + APScheduler — agentes analíticos + RAG (:8082)
  notifier-py/      FastAPI + pywebpush — Web Push / e-mail de check-ins e crise (:8083)
infra/
  migrations/       DDL versionado do Postgres (0001..0058+) — FONTE DA VERDADE do schema
  azure/             Runtime atual do portfólio (Vercel + Container Apps + PostgreSQL)
  aws/              EC2, RDS, ALB, ASG, CloudFront, Lambdas, watchdogs, policies
  ci/, caddy/, scripts/
docs/
  CONTEXT.md        arquitetura completa (leia ao planejar)
  DEBT.md           dívida técnica viva (consulte antes de propor melhorias)
  adrs/             ADR-001..081+
  runbooks/         operação (restore RDS, swap de roles, drills, cutovers)
.claude/skills/     conhecimento de domínio carregado sob demanda
```

> **Atenção à assimetria:** `apps/web` usa `/app` (alias `@/* → .`); `apps/checkup` usa `/src/app` (alias `@/* → ./src`).

---

## Setup

- **Node 24** + **pnpm 10.33.3** (via corepack) para `apps/web` e `apps/checkup`. Use **pnpm**, nunca npm/yarn.
- **Python 3.12+** para os 3 serviços `*-py` (deps em `pyproject.toml`).
- **.NET 10 SDK** para o gateway.
- **Docker** para rodar tudo junto e para os testes do gateway (Testcontainers).
- Copie `.env.example` (cobertura completa: DB, auth, LLM, AWS, Asaas, MEMED, etc.) → `.env` antes de subir o compose.

---

## Comandos

### Tudo junto (dev)
```bash
docker compose up -d --build      # precisa de .env preenchido
```
> O compose é apenas para desenvolvimento/local. No portfólio atual, os frontends
> são promovidos pela Git Integration da Vercel e o backend segue `infra/azure/`.

### Web (`apps/web`) — porta 3000
```bash
cd apps/web && pnpm dev            # dev (Next 16, React Compiler + cacheComponents/PPR ligados)
cd apps/web && pnpm build          # build (faz type-check strict)
cd apps/web && pnpm lint           # eslint .
cd apps/web && pnpm exec tsc --noEmit   # type-check isolado (não há script "test"; web sem testes unitários)
```

### Checkup (`apps/checkup`) — porta 3001
```bash
cd apps/checkup && pnpm dev        # next dev -p 3001
cd apps/checkup && pnpm test       # vitest run (motor de escalas — testes unitários OBRIGATÓRIOS antes da UI)
cd apps/checkup && pnpm build
cd apps/checkup && pnpm lint       # next lint
```
> Filtro a partir da raiz também funciona: `pnpm -F @cerebro-amigo/web <script>` ou `pnpm -F @cerebro-amigo/checkup <script>`.

### Gateway (`apps/api-gateway`) — porta 5050→5000, health `/health` e `/ready`
```bash
cd apps/api-gateway && dotnet run
cd apps/api-gateway && dotnet build --configuration Release
cd apps/api-gateway-tests && dotnet test --configuration Release   # xUnit + Testcontainers (PRECISA de Docker)
```

### Serviços Python (`orchestrator-py` :8081, `agents-py` :8082, `notifier-py` :8083)
Health: `/health` e `/ready`. Por serviço:
```bash
cd apps/<servico>-py
python -m venv .venv && source .venv/bin/activate && pip install -e '.[dev]'
uvicorn app.main:app --host 0.0.0.0 --port <8081|8082|8083> --reload
pytest tests/ -v --tb=short        # testes (env mockado, sem DB real)
ruff check app/ tests/ && mypy app/   # lint + type-check
```

### Migrations
- **Fonte da verdade = `infra/migrations/00NN_*.sql`** (versionado, SQL puro, aplicado no CI em Postgres real e no RDS).
- EF Core (`Data/Migrations/`) é auto-gerado localmente, não é a fonte canônica:
```bash
cd apps/api-gateway && dotnet ef migrations add <Nome> && dotnet ef database update
```
- Schema novo → adicione um `infra/migrations/00NN_*.sql` e mantenha o filtro de tenant + RLS.

---

## Portas e health

| Serviço | Porta dev | Health |
|---|---|---|
| web | 3000 | — |
| checkup | 3001 | `GET /api/health` |
| api-gateway | 5050→5000 | `GET /health` · `GET /ready` |
| orchestrator-py | 8081 | `GET /health` · `GET /ready` |
| agents-py | 8082 | `GET /health` · `GET /ready` |
| notifier-py | 8083 | `GET /health` · `GET /ready` |

Postgres é **externo** (RDS), não vai no docker-compose.

---

## Fronteiras de integração (não viole)

- **LLM (Claude) nos fluxos clínicos → só em Python**, via client unificado (`LLM_PROVIDER`). Nunca chame LLM do gateway nem do front clínico.
  - **Única exceção (ADR-044):** `apps/checkup` chama a Anthropic API nos **Route Handlers do próprio app** (server-side; `claude-haiku-4-5`), enviando só dados estruturados de triagem (escala/escore/faixa) — jamais conteúdo clínico ou PII. Não criar outras exceções.
- **REST transacional → `api-gateway` (.NET 10).**
- **Cookies/sessão/BFF → `web`** (`app/api/*`): `auth_token` (médico) e `paciente_token` (paciente), httpOnly.
- **Serviços internos** se autenticam com `Authorization: Bearer ${INTERNAL_API_TOKEN}`.
- **Isolamento clínico ⇄ checkup:** `apps/checkup` não importa nada dos serviços clínicos e vice-versa. Compartilhado: só design tokens e utilitários puros. Dados separados: checkup usa exclusivamente o schema `checkup`; **nunca FK entre schemas**, triagem jamais entra no prontuário.

---

## Convenções de código

### Geral
- **Idioma: pt-BR** em respostas, comentários e domínio (`pacientes`, `prontuarios`, `consultas`). Sem i18n.
- Escreva código que combine com o arquivo vizinho (nomes, idioma, densidade de comentário).
- Sem Prettier configurado — siga o estilo existente; lint via ESLint (web/checkup) e ruff (Python).

### TypeScript (web/checkup)
- `strict: true`, target ES2022, `moduleResolution: bundler`, `jsx: react-jsx`.
- shadcn/ui estilo `new-york`, baseColor `neutral`, RSC ligado. Componentes em `@/components/ui`.
- React Compiler **ligado** (exige React 19) e `cacheComponents`/PPR **ligado** em ambos os apps: acesso dinâmico (`headers()`, cookies) precisa estar dentro de `<Suspense>` ou quebra a renderização estática.
- Web tem PWA (`public/manifest.json` scope `/p` + `public/sw.js`); checkup **não** (anônimo, sem tracking client-side).

### .NET 10 (gateway)
- **Minimal APIs** (não controllers): `MapGroup("/api/v1/...").WithTags(...)` + `MapGet/MapPost/...`. Validação inline no handler retornando `Results.*`.
- EF Core 10 + Npgsql + `EFCore.NamingConventions` (snake_case). JSONB via `.HasColumnType("jsonb")`.
- `TreatWarningsAsErrors=true` (NoWarn pontual: CA1014, CA2007, CS8604 — **não remover** CS8604, é necessário p/ params null de `ExecuteSqlRaw`).
- JWT: `MapInboundClaims=false`, claims curtos (`sub`, `role`, `email`, `tv`); `tv` = token_version (revogação de sessão). Policies: `paciente`, `internal`, `owner`, `admin_geral`, `medico`.
- Para SQL cru com parâmetros possivelmente nulos, use o helper `ExecuteRawAsync` (`DbExtensions.cs`) — `ExecuteSqlRawAsync` estoura com `DBNull.Value`.
- Detalhe: skill `dotnet-gateway`.

### Python (serviços `*-py`)
- async/await pervasivo, pydantic v2 + pydantic-settings (`get_settings()` com `lru_cache`), asyncpg (pool).
- `structlog` com processador `redact_pii` **antes** do `JSONRenderer`. ❌ Nunca `show_locals=True` no ExceptionRenderer (vaza conteúdo clínico).
- Client LLM unificado: factory `haiku()/sonnet()/with_schema()` em `app/.../llm.py`, switchável por `LLM_PROVIDER` (imports lazy do SDK).
- Embeddings/RAG: **sempre** Bedrock in-region (`cohere.embed-multilingual-v3`, sa-east-1), independente do `LLM_PROVIDER`.
- Detalhe: skill `python-ai-services`.

---

## Testes

- **Python:** `pytest` em cada serviço (gate no CI; env mockado, sem DB real). Lint `ruff`, types `mypy`.
- **.NET:** `dotnet build` Release + `dotnet test` (xUnit + **Testcontainers** sobe `pgvector:pg16` real, aplica migrations, seeda 2 médicos/pacientes e prova isolamento de tenant/IDOR). **Precisa de Docker** rodando.
- **Checkup:** `vitest run` (casos das escalas clínicas — obrigatório antes de mexer na UI do teste).
- **Web:** sem testes unitários; o gate é `pnpm build` (type-check strict).
- **Integração (CI):** Postgres real + migrations + gateway + orchestrator + smoke (sem LLM).

Rode os testes da área que você tocou antes de considerar a tarefa pronta.

---

## Segurança / defesas estruturais implementadas (não regrida)

- **RLS de tenant (ADR-042):** ~17 tabelas com Row-Level Security. Gateway conecta como `cerebro_gateway` (NOBYPASSRLS; tenant via `TenantSessionMiddleware` setando GUC `app.current_medico`/`app.current_paciente`/`app.tenant_bypass`). Workers Python como `cerebro_workers` (BYPASSRLS). **Endpoint/query novo mantém o filtro explícito de tenant E conta com a RLS por baixo.** Só `role=owner` recebe bypass; `admin` (financeiro) não vê tabelas clínicas.
- **Trava server-side dos prompts de salvaguarda (ADR-035):** prompts de crise/auditoria são bloqueados contra alteração via editor (`PromptValidation.cs`).
- **Entrega garantida do alerta de crise (ADR-041):** retry com backoff + escalonamento até o médico confirmar.
- **Cifragem em repouso (ADR-018):** `mensagens.conteudo` cifrada no INSERT (orchestrator-py) e decifrada no SELECT (gateway). Não crie caminho que contorne isso.
- **Segredos:** `ANTHROPIC_API_KEY`, `JWT_SECRET`, etc. só por env e Azure Key Vault no runtime atual. SSM pertence ao deployment AWS anterior. ❌ Nunca em código, imagem Docker ou log.
- CSP: web em Report-Only; checkup enforcing em prod. HSTS + X-Frame-Options DENY em ambos.

---

## CI/CD

- **CI (`.github/workflows/ci.yml`):** Trivy (gate CRITICAL) · Python ruff + pytest (3 serviços) · .NET build + xUnit/Testcontainers · integração Postgres real + smoke · build web · checkup vitest + build.
- **Deploy frontend:** Git Integration da Vercel promove os projetos `apps/web` e `apps/checkup`; não há workflow AWS ativo.
- **Deploy backend:** Azure Container Apps/ACR conforme `infra/azure/`; mudanças de infraestrutura são promovidas deliberadamente, não por um pipeline AWS legado.
- **CI valida web e checkup em PR:** build strict do web; Vitest + build strict do checkup.

---

## Git / PR / commits

- Trabalhe em branch (não commite direto em `main`). Commite/push só quando pedido.
- Domínio e mensagens em pt-BR. Mudança relevante de arquitetura → registre um **ADR** em `docs/adrs/` (nomenclatura `ADR-NNN`, status Accepted/Paused/Superseded).
- Antes de afirmar que algo "falta": **verifique o código** — a migração V2→V3 está concluída e em produção (BFF 30+ rotas, RLS, 3 serviços Python, CI/CD completo). Não recrie o que já existe.

---

## Onde olhar primeiro

| Preciso de… | Vá para |
|---|---|
| Arquitetura / mapa de rotas | `docs/CONTEXT.md` · skill `cerebro-architecture` |
| O que falta / dívida técnica | `docs/DEBT.md` |
| Guardrails clínicos / crise / LGPD | skill `clinical-safety` · `apps/checkup/docs/CRISIS-PROTOCOL.md` |
| Convenções do gateway .NET | skill `dotnet-gateway` |
| Serviços Python / LLM | skill `python-ai-services` |
| Frontend / BFF / portal | skill `nextjs-bff` |
| Decisões fechadas | `docs/adrs/` (ex.: 044 LLM, 042 RLS, 018 cifragem, 071 .NET) |
| Operação (restore, drills, cutover) | `docs/runbooks/` |
