# CONTEXT.md — Cérebro Amigo V3

Referência densa para sessões de IA. Atualizar a cada mudança estrutural relevante.
Versão humana mais legível: `docs/DOCUMENTACAO-SISTEMA.md`.

---

## O que é

SaaS de psiquiatria multi-tenant. Dois públicos: **médico** (dashboard `/dashboard/*`)
e **paciente** (PWA `/p/*`). Opera *entre consultas*: check-ins, adesão a medicação,
protocolo de crise, insights analíticos. Dado de saúde mental = LGPD categoria especial.

O ambiente público atual é uma demonstração de portfólio, não um serviço médico
ativo. Ele contém somente dados fictícios e reproduzíveis.

---

## Current portfolio runtime

| Camada | Runtime atual |
|---|---|
| Frontend | Vercel (`apps/web` e `apps/checkup`) |
| Backend | Azure Container Apps |
| Banco | Azure Database for PostgreSQL Flexible Server |
| Região | `eastus2` (Estados Unidos) |
| Dados | Somente dados fictícios de demonstração |

Este runtime **não promete residência de dados no Brasil**. AWS representa o
deployment anterior ou arquitetura de referência e não integra o request path
público atual. A fonte curta e canônica é `docs/CURRENT-PORTFOLIO-RUNTIME.md`; a
decisão é o ADR-080. Dados clínicos reais exigem novo ADR com residência, rede
privada, HA, RPO/RTO, segurança e validação LGPD.

## Topologia pública atual

```
Vercel
├── apps/web (Next.js + BFF) ───────────────┐
└── apps/checkup (triagem isolada)          │
                                             ▼
Azure eastus2 — somente dados fictícios
├── api-gateway (.NET 10 · ingress externo)
├── orchestrator-py (Container Apps · interno) ──► Anthropic API
├── agents-py (Container Apps · interno)
├── notifier-py (Container Apps · interno)
└── Azure PostgreSQL Flexible Server
    ├── pgvector + pgcrypto
    └── RLS multi-tenant
```

> **Histórico AWS:** referências a EC2, RDS, ECR, SSM, ALB, ASG, Bedrock ou
> `sa-east-1` abaixo documentam o deployment anterior, integrações opcionais ou
> runbooks históricos. Elas não descrevem a hospedagem pública atual.

### Delivery atual

- `apps/web` e `apps/checkup`: promoção pela Git Integration da Vercel a partir
  de `main`.
- backend e banco: Azure Container Apps/ACR/PostgreSQL conforme `infra/azure/`,
  com promoção deliberada.
- GitHub Actions: somente gates de CI. Os workflows AWS órfãos de deploy e restore
  drill foram removidos na implementação operacional do ADR-080.

---

### Demo pública resiliente

`/demo` é a entrada pública para recrutadores: abre sem credenciais uma conta
médica fictícia read-only com três pacientes sintéticos e permite alternar para a
perspectiva PWA em `/demo/patient-app`. Os percursos são `Dashboard → Patient
record → AI briefing → Architecture` e `Today → Check-in → Voice journal →
Architecture`. As rotas são renderizadas integralmente na Vercel a partir de um
snapshot versionado alinhado a `infra/seed/portfolio.sql`; não criam sessão
clínica e não chamam Azure, banco ou LLM. Interações do paciente são efêmeras na
aba, e a gravação de voz é simulada sem solicitar microfone ou criar áudio.
Assim, cold start ou indisponibilidade do backend não bloqueiam a inspeção. O
dashboard autenticado `/dashboard/*` continua usando o runtime completo e não deve
ser confundido com esta amostra. Decisão: ADR-081.

---

## Regra de fronteira

| Responsabilidade | Serviço |
|---|---|
| Chamar LLM (Claude) | **Apenas Python** (orchestrator-py, agents-py) via Anthropic API direta |
| REST transacional, JWT, e-mail, proxy SSE | **api-gateway (.NET 10)** |
| Cookies, sessão, agregação, render | **web / BFF** (`app/api/*`) |
| Push de check-in | **notifier-py** |
| Jobs analíticos agendados | **agents-py** |

Nunca: LLM no gateway ou no front; CRUD Postgres direto do front; lógica clínica no BFF.

---

## Regras clínicas inegociáveis

1. IA não dá orientação clínica, diagnóstico nem ajuste de dose.
2. Protocolo de crise: texto **literal** de `crisis_copy.py` → registra `protocolos_crise_acionados` → notifica médico → pausa automação. Nunca gerar texto de crise com LLM.
3. Audit trail append-only: `protocolos_crise_acionados`, `notificacoes_medico`, `agente_execucoes`. Nenhum DELETE/UPDATE em massa.
4. PII nunca em traces: `PII_REDACTION_ENABLED=true` no LangSmith.
5. Toda resposta ao paciente passa por `audit_response`; escalável para humano via `escalate_to_human`.

---

## Portas e health

| Serviço | Porta host | Porta container | Health |
|---|---|---|---|
| web | 3000 | 3000 | — |
| api-gateway | 5050 | 5000 | `GET /health`, `GET /ready` |
| orchestrator-py | 8081 | 8081 | `GET /health`, `GET /ready` |
| agents-py | 8082 | 8082 | `GET /health`, `GET /ready` |
| notifier-py | 8083 | 8083 | `GET /health`, `GET /ready` |
| PostgreSQL | externo (RDS) | — | Via `POSTGRES_DSN` |

---

## Grafo conversacional (orchestrator-py)

```
load_context → detect_crisis (Haiku)
  → [crise] crisis_protocol (texto fixo crisis_copy.py) → END
  → classify_medication (Haiku) → update_intake
  → extract_symptoms (Sonnet) → generate_response (Sonnet, SSE)
  → audit_response (Haiku) → finalize | reescrever | escalate_to_human
```

Checkpointing: `AsyncPostgresSaver` LangGraph em tabelas `checkpoints*`.
Streaming: SSE — gateway faz proxy de `/internal/portal/conversation/message` → cliente.

---

## Agentes analíticos (agents-py)

| Agente | Função | Modelo |
|---|---|---|
| `resumo_pre_consulta` | Sumário pré-consulta | Sonnet |
| `adesao` | Taxa de medicação + engajamento | Haiku |
| `risco_silencioso` | Ausência atípica + sinais negativos | Sonnet |
| `padroes` | Tendências em sintomas (scipy) | Opus (opcional) |
| `diario` | Síntese de entradas compartilhadas | Sonnet |

`AGENTS_MODE=scheduled|manual`. `SHADOW_MODE=true` para rodar sem efeitos em dev.
Resultado em `insights` e `agente_execucoes` (append-only).

---

## Roteamento de modelo Bedrock por etapa

| Etapa | Variável |
|---|---|
| Detecção de crise, classificação, auditoria | `BEDROCK_MODEL_HAIKU` |
| Extração de sintomas, resposta ao paciente | `BEDROCK_MODEL_SONNET` |
| Análise de padrões densa | `BEDROCK_MODEL_OPUS` |

---

## Mapa de rotas web → domínio → gateway

| Rota web | Domínio | Endpoint gateway |
|---|---|---|
| `/dashboard/pacientes` | CRUD pacientes | `/api/v1/pacientes/*` |
| `/dashboard/prontuarios` | Ficha + histórico + prescrições | `/api/v1/pacientes/{id}`, `/api/v1/prescricoes/*` |
| `/dashboard/evolucao` | Timeline, humor, adesão, insights | `/api/v1/pacientes/{id}/timeline\|humor\|adesao`, `/api/v1/insights/*` |
| `/dashboard/checkins` | Check-ins de humor | `/api/v1/pacientes/{id}/checkins` |
| `/dashboard/mensagens` | Conversa médico↔paciente | `POST /api/portal/conversation/message` (SSE) |
| `/dashboard/agenda` | **Novo V3** — consultas | `/api/v1/consultas/*` (a criar) |
| `/login` | Auth médico | BFF `POST /api/auth/login` → `POST /api/v1/auth/login` |
| `/p/*` | **Portal paciente** (A FAZER) | humor, diário, medicações, conversa SSE, push |

---

## BFF (`apps/web/app/api/`)

| Rota BFF | Destino |
|---|---|
| `POST /api/auth/login`, `logout` | Gateway → JWT → cookie `auth_token` |
| `GET /api/dashboard/pacientes`, `resumo-pre-consulta` | Gateway |
| `GET/POST /api/dashboard/prescricoes/*` | Gateway |
| `POST /api/notificacoes/[id]/marcar-lida\|nao-lida` | Gateway |
| `GET /api/medicamentos` | Catálogo local `lib/catalogo-medicamentos.ts` |
| `POST /api/paciente/login`, `magic-validar`, `senha`, `logout` | Gateway → cookie `paciente_token` |
| `POST /api/paciente/conversation` | Proxy SSE → gateway → orchestrator-py |
| `GET/POST /api/paciente/diario`, `humor`, `checkins/*` | Gateway |
| `POST /api/paciente/push/subscribe` | Gateway |

Helpers: `lib/api-gateway.ts` (`proxyFetch`, `getGatewayUrl`), `lib/api.ts` (`fetchApi`).

---

## Banco de dados (domínio)

| Grupo | Tabelas |
|---|---|
| Tenancy | `clientes`, `usuarios`, `medicos`, `pacientes` |
| Conversação | `conversas`, `mensagens`, `conhecimento` (pgvector), `inbound_messages` |
| Clínico | `prescricoes`, `prescricao_eventos`, `tomadas_medicacao`, `sintomas`, `eventos`, `consultas`, `questionarios`, `questionarios_respostas` |
| Crise / audit | `protocolos_crise_acionados`, `notificacoes_medico`, `agente_execucoes` |
| Portal | `pacientes_credenciais`, `magic_links`, `diario_entradas`, `acessos_paciente` |
| Check-ins / push | `checkins`, `push_subscriptions`, `notificacoes_enviadas` |
| IA analítica | `insights` |
| Catálogo | `agentes`, `medicamentos` |

Migrations: `infra/migrations/` (DDL versionado). Fonte da verdade: `0001_init.sql`.
pgvector para RAG futuro em `conhecimento`. pgcrypto para colunas sensíveis.

### Modelo de entidade (LEIA antes de escrever qualquer query)

- **`clientes`** = a **pessoa-paciente** (PK `id`, nome, email, wa_id). Não é "cliente comercial" — é a identidade do usuário do portal.
- **`usuarios`** = login do médico (email + senha_hash). Sem `cliente_id`.
- **`medicos`** = perfil clínico do médico, FK `usuario_id → usuarios`. **Não tem `cliente_id`**. 1:1 com `usuarios`.
- **`pacientes`** = vínculo clínico médico↔paciente. **PK = `cliente_id REFERENCES clientes(id)`** (1:1 com `clientes`). Colunas: `medico_responsavel_id`, `cpf`, `data_nascimento`, `consentimento_lgpd_em`, `config_lembretes`, `automacao_pausada`.
- **Tabelas clínicas** (`prescricoes`, `tomadas_medicacao`, `sintomas`, `eventos`, `consultas`, `questionarios_respostas`, `insights` por paciente, `checkins`, `diario_entradas`, `acessos_paciente`, `magic_links`, `pacientes_credenciais`, `prescricao_eventos`, `protocolos_crise_acionados`, `agente_execucoes`): coluna **`paciente_id UUID REFERENCES clientes(id)`** — o nome é `paciente_id` mas a FK aponta para `clientes.id`. Não é a tabela `pacientes`.
- **`conversas`**: tem `cliente_id REFERENCES clientes(id)` (nome direto, sem alias).
- **`notificacoes_medico`**, **`insights`**: têm `medico_id REFERENCES medicos(id)` direto.

### Padrão multi-tenant (tenant = `medico_responsavel_id`)

Para escopar dado clínico por médico, o filtro é JOIN em `pacientes`:

```sql
-- Tabelas clínicas (prescricoes, sintomas, eventos, checkins, diario_entradas, etc.)
SELECT t.*
FROM <tabela> t
JOIN pacientes p ON p.cliente_id = t.paciente_id
WHERE p.medico_responsavel_id = :medicoId;

-- notificacoes_medico e insights (medico_id direto)
SELECT * FROM notificacoes_medico WHERE medico_id = :medicoId;
SELECT * FROM insights WHERE medico_id = :medicoId;
```

> **Armadilha**: `WHERE paciente_id = :x` sem JOIN em `pacientes` **não escopa por médico** — filtra só por paciente individual, não por tenant. O filtro de tenant é sempre via `medico_responsavel_id`.

---

## Variáveis de ambiente (V3)

```
# Banco
POSTGRES_DSN

# Auth
JWT_SECRET                    # médico e paciente
INTERNAL_API_TOKEN            # .NET ↔ Python, Bearer

# E-mail
RESEND_API_KEY · EMAIL_FROM
# notifier-py: provider-switchável (ADR-073). Vigente: resend (primário).
EMAIL_PROVIDER=resend          # resend (vigente) | ses (alternativa, bloqueada CK-4)
SES_REGION=sa-east-1           # SES v2 in-region quando EMAIL_PROVIDER=ses (auth por IAM role)
# Domínio cerebroamigo.com.br: verificado no Resend (sa-east-1), DKIM + SPF(send) no ar.
# FALTA DMARC: _dmarc TXT "v=DMARC1; p=none; rua=mailto:dmarc@cerebroamigo.com.br; fo=1" (zona Vercel).

# Web Push
VAPID_PRIVATE_KEY · VAPID_PUBLIC_KEY · NEXT_PUBLIC_VAPID_PUBLIC_KEY

# URLs (dev local → docker usa nomes de container)
API_GATEWAY_URL               # http://localhost:5050 / http://api-gateway:5000
ORCHESTRATOR_PY_URL           # http://localhost:8081
AGENTS_PY_URL                 # http://localhost:8082
NOTIFIER_PY_URL               # http://localhost:8083

# Bedrock (sem ANTHROPIC_API_KEY — auth por IAM role)
AWS_REGION=sa-east-1
BEDROCK_REGION=sa-east-1
BEDROCK_MODEL_HAIKU
BEDROCK_MODEL_SONNET
BEDROCK_MODEL_OPUS
AWS_PROFILE                   # dev local; prod usa IAM role da EC2

# Observabilidade
LANGSMITH_API_KEY · LANGSMITH_PROJECT · LANGSMITH_TRACING_V2
PII_REDACTION_ENABLED=true

# Modos
SHADOW_MODE                   # orchestrator-py: processa sem efeitos externos
AGENTS_MODE                   # scheduled | manual
NOTIFIER_MODE
SCHEDULER_INTERVAL_SECONDS
```

---

## Estado da migração V2 → V3

**Pronto:**
- Landing, `/login`, `/dashboard/*` (dados ainda mock via seed de demonstração)
- `/dashboard/agenda` — calendário semanal + botão "Briefing" por consulta ✓
- `/dashboard/consultas/[id]/briefing` — tela de briefing pré-consulta (mock) ✓
- Monorepo skeleton + docker-compose local (todos os 5 containers healthy)
- `apps/api-gateway/` — portado .NET 10, compilando, deploy na EC2
- `apps/orchestrator-py/` — portado Python + LangGraph, Bedrock configurado
- `apps/agents-py/` — portado Python + APScheduler, 5 agentes analíticos; cadências por agente (ADR-009 PR 3); suite de testes 52/52 ✓
- `apps/notifier-py/` — portado Python + pywebpush
- `infra/migrations/` — DDL completo (`0001_init`, `0002_fix_agente_execucoes`, `0003_add_automacao_pausada`), aplicado em RDS
- `infra/seed/` — seed de demonstração (3 pacientes com histórico clínico, insights, notificações)
- **ADR-009 (histórico de deploy AWS):** o antigo workflow GitHub Actions → ECR → EC2 foi removido após o ADR-080. Os Dockerfiles, compose e limites de recurso permanecem como referência local/histórica, sem automação ativa contra AWS.
- `infra/aws/setup-ecr.sh` — script de bootstrap ECR (5 repos, lifecycle policy, IAM pull policy)
- Testes unitários verdes: orchestrator-py 19/19, agents-py 52/52 ✓; conftest fixado

**A FAZER — ADR-009 (partes faltando):**
- **PR 0** (ops): medir RAM/CPU real da box (`docker stats`, `aws ec2 describe-instances`) para calibrar `mem_limit` em `docker-compose.yml`
- **PR 2**: capar pool asyncpg do agents-py (10 → 3-5 conn) + tornar tunável por env
- **PR 3**: scipy/numpy no agents-py (`padroes.py`) para `asyncio.to_thread` — impede bloqueio do event loop na triagem de crise do diário
- **PR 4 (ADR a criar)**: fechar lacuna de SHADOW_MODE em agents-py (default `true`, crise isenta). NOTA: o número 011 referido no ADR-009 já foi usado pelo enforcement de custo; renumerar ao criar.
- **PR 5 (ADR a criar)**: consolidar triagem de crise do diário (`services/crisis.py`, `/internal/diario/*`) no orchestrator-py; agents-py vira batch puro
- **PR 7 (ops, histórico AWS):** criação de ECR e primeiro deploy; supersedido para o portfólio pelo ADR-080.
- **PR 8**: multi-stage Dockerfiles Python (remover `build-essential` do runtime)
- **ADR-014**: implementar Fase 1 (dedup-no-SQL em `_listar_candidatos` do risco_silencioso)

**A FAZER (backlog produto):**
1. BFF real (`app/api/*`) + remover dados mock do `/dashboard/*`
2. Portal paciente `/p/*` (PWA, push, conversa SSE)
3. Editor de prompts dos agentes (UI do médico para `agentes.system_prompt`)
4. IAM role na EC2 com `bedrock:InvokeModel` em sa-east-1 (confirmar se criada)
5. Quota Bedrock sa-east-1 (caso de suporte aberto — ver `docs/aws-bedrock-quota-support-case.md`)

---

## ADRs

| # | Decisão | Status |
|---|---|---|
| [001](adrs/ADR-001-backend-transacional-net.md) | Backend transacional em .NET (não Go) | Accepted |
| [002](adrs/ADR-002-ia-conversacional-python-langgraph.md) | IA conversacional Python + LangGraph | Accepted |
| [003](adrs/ADR-003-agentes-analiticos-python-vanilla.md) | Agentes analíticos Python sem LangGraph | Accepted |
| [004](adrs/ADR-004-lgpd-traces-langsmith.md) | LGPD em traces LangSmith + redação de PII | Accepted |
| [005](adrs/ADR-005-versionamento-texto-crise.md) | Versionamento e revisão do texto de crise | Accepted |
| [006](adrs/ADR-006-fail-safe-classificador-crise.md) | Fail-safe do classificador de crise | Accepted |
| [007](adrs/ADR-007-gateway-net-nao-go.md) | Gateway transacional em .NET 10, não Go | Accepted |
| [008](adrs/ADR-008-llm-bedrock-nao-anthropic-api.md) | LLM via Bedrock In-Region, não ANTHROPIC_API_KEY | Superseded by ADR-015 |
| [009](adrs/ADR-009-separacao-plano-interativo-batch.md) | Separação plano interativo (crise) / batch + builds no CI | Accepted |
| [010](adrs/ADR-010-crise-no-diario.md) | Triagem de crise no Diário (áudio e texto) | Accepted |
| [011](adrs/ADR-011-enforcement-custo-llm.md) | Enforcement do teto de custo diário de LLM | Accepted |
| [014](adrs/ADR-014-dirty-patients-find-pending.md) | Candidatos incrementais em find_pending ("pacientes sujos") | Proposed |
| [015](adrs/ADR-015-llm-provider-switchavel.md) | Camada LLM provider-switchável (Anthropic API ⇄ Bedrock) | Accepted |
| [016](adrs/ADR-016-agenda-e-revisao-mensagens.md) | Agenda de consultas + console de revisão de mensagens | Accepted |
| [017](adrs/ADR-017-imutabilidade-audit-trail-no-banco.md) | Imutabilidade do audit trail garantida no banco | Accepted |
| [018](adrs/ADR-018-cifragem-em-repouso.md) | Cifragem em repouso de dados clínicos | Accepted |
| [019](adrs/ADR-019-retomada-automacao-pos-crise.md) | Retomada de automação pós-crise (ato do médico, auditado) | Accepted |
| [020](adrs/ADR-020-motor-conduta-automacao.md) | Motor de conduta de automação por paciente | Accepted |
| [021](adrs/ADR-021-escopo-administrativo-ia-comunicacao.md) | Escopo administrativo da IA de comunicação | Accepted |
| [022](adrs/ADR-022-notificacao-externa-crise-medico.md) | Notificação externa de crise ao médico (e-mail) | Accepted |
| [023](adrs/ADR-023-jobs-conduta-shadow.md) | Jobs de conduta + gate SHADOW | Accepted |
| [024](adrs/ADR-024-integracao-memed.md) | Integração MEMED (prescrição digital) | Accepted |
| [025](adrs/ADR-025-agenda-scheduling.md) | Agenda — disponibilidade, conflito, lembretes e self-booking | Accepted |
| [026](adrs/ADR-026-teleconsulta-video-p2p.md) | Teleconsulta por vídeo — WebRTC P2P self-hosted | Accepted |
| [027](adrs/ADR-027-measurement-based-care.md) | Measurement-Based Care — captura, desfecho e agente | Accepted |
| [028](adrs/ADR-028-rag-pgvector.md) | RAG com pgvector — busca semântica doctor-facing | Accepted |
| [029](adrs/ADR-029-monitoramento-exames.md) | Monitoramento de exames laboratoriais e segurança farmacológica | Accepted |
| [030](adrs/ADR-030-rede-social-medicos.md) | Rede Social Cérebro Amigo (médicos verificados) | Proposed |
| [031](adrs/ADR-031-rede-extensoes-signup-foto-presenca.md) | Extensões da rede social — signup externo, foto, aprovação, presença | Proposed |
| [032](adrs/ADR-032-renovacao-receita-e-interacoes.md) | Renovação de receita controlada (A4) + rede de segurança de interações (A5) | Accepted |
| [033](adrs/ADR-033-monetizacao-roi-blindagem.md) | Monetização do médico (Asaas), dashboard ROI, recall, blindagem | Accepted |
| [034](adrs/ADR-034-cobranca-recorrente-medico.md) | Cobrança recorrente da plataforma ao médico (Fluxo A) via Asaas | Accepted |
| [035](adrs/ADR-035-trava-server-side-prompt-crise.md) | Trava server-side dos prompts de salvaguarda clínica | Accepted |
| [036](adrs/ADR-036-cockpit-receita.md) | Cockpit de receita do admin (Fluxo A) | Accepted |
| [037](adrs/ADR-037-sala-supervisao-crise.md) | Sala de supervisão de crise (admin, read-only) | Accepted |
| [038](adrs/ADR-038-trilha-acesso-dados-sensiveis.md) | Trilha de acesso a dados sensíveis (LGPD art. 37) | Accepted |
| [039](adrs/ADR-039-console-direitos-titular.md) | Console de direitos do titular (LGPD) | Accepted |
| [040](adrs/ADR-040-escriba-teleconsulta.md) | Escriba clínico (Ambient Scribe) na teleconsulta | Accepted |
| [041](adrs/ADR-041-entrega-garantida-alerta-crise.md) | Entrega garantida e escalonamento do alerta de crise | Accepted |
| [042](adrs/ADR-042-rls-isolamento-tenant.md) | Isolamento de tenant — least-privilege + RLS | Accepted |
| [043](adrs/ADR-043-ha-spof-plano.md) | HA e fim do SPOF — plano (+ Adendo 2026-06-21: RDS Single-AZ piloto) | Em andamento |
| [044](adrs/ADR-044-llm-anthropic-api-direta.md) | LLM via Anthropic API direta (vigente); Bedrock suspenso | Accepted |
| [045](adrs/ADR-045-checkup-decouple-asg-alb.md) | Desacoplar o Check-up para infra própria (ALB + ASG) | Accepted |
| [046](adrs/ADR-046-signup-externo-medico-atribuicao-checkup.md) | Signup externo de médico + atribuição do Check-up | Accepted |
| [047](adrs/ADR-047-cloudfront-checkup.md) | CloudFront na frente do checkup.cerebroamigo.com.br | Proposed |
| [048](adrs/ADR-048-expansao-escalas-checkup.md) | Expansão das escalas do Check-up (AUDIT, MDQ, Fagerström, MSI-BPD) | Accepted |
| [049](adrs/ADR-049-assist-ux-proprio.md) | ASSIST com UX próprio no Check-up Mental | Accepted |
| [050](adrs/ADR-050-checkup-longitudinal-anonimo.md) | Cockpit de Aquisição + Check-up longitudinal pseudonimizado | Accepted (P1) / Proposed (P2) |
| [051](adrs/ADR-051-validacao-escalas-checkup.md) | Validação e fidelidade das escalas (PHQ-9, GAD-7, ASRS-18) | Accepted |
| [052](adrs/ADR-052-checkup-no-ec2-nao-vercel.md) | Check-up roda no EC2 (não na Vercel) | Accepted |
| [067](adrs/ADR-067-gateway-scala-strangler.md) | Migração do gateway .NET→Scala via strangler | ❌ Superseded by 071 |
| [071](adrs/ADR-071-manter-dotnet-remover-scala.md) | Manter gateway em .NET 10 e decomissionar o Scala | Accepted |
| [072](adrs/ADR-072-deploy-gateway-stop-then-start.md) | Deploy: stop-then-start do gateway (downtime curto × footprint) | Accepted |
| [073](adrs/ADR-073-email-provider-abstraction.md) | E-mail do notifier-py por `EMAIL_PROVIDER` (Resend primário, SES atrás da flag) | Accepted |

> **Gateway transacional = .NET 10** (decisão final, ADR-071). A migração p/ Scala (ADR-067) foi abandonada e o serviço Scala removido do box. (053–070 não listados nesta tabela — ver `docs/adrs/`.)
