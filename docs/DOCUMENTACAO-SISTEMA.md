# Documentação técnica — Cérebro Amigo V3

**Última revisão:** maio de 2026  
Referência humana completa. Para sessões de IA use também [`CONTEXT.md`](./CONTEXT.md) (mais denso).

---

## 1. O que é o sistema

**Cérebro Amigo** é um SaaS de psiquiatria focado em **continuidade de cuidado entre consultas**. Não é chatbot genérico: estrutura check-ins de medicação, registro de humor, protocolos de segurança e análise clínica automatizada, com separação rigorosa entre **coleta automatizada** e **decisão humana**.

| Aspecto | Descrição |
|---|---|
| **Modelo comercial** | Multi-tenant: cada psiquiatra é um tenant; dados isolados por `medico_responsavel_id` |
| **Público médico** | Dashboard web `/dashboard/*`: pacientes, prescrições, timeline, insights, notificações, agenda |
| **Público paciente** | PWA `/p/*`: humor, diário, medicações, check-ins por push, conversa com IA |
| **Canal conversacional** | PWA (Web Push + SSE). WhatsApp não está ativo no V3 |
| **Privacidade** | Dado de saúde mental = LGPD categoria especial. Residência de dados: `sa-east-1` |

---

## 2. Princípios inegociáveis

Estas regras precedem qualquer pedido de feature ou otimização.

1. **A IA não pratica medicina.** Nunca gere diagnóstico, ajuste de dose ou orientação clínica — nem como "sugestão para o médico aprovar". A IA automatiza, organiza, resume *fatos relatados*. A decisão é sempre do médico.

2. **Protocolo de crise é fixo e pré-aprovado.** Ao detectar ideação suicida ou autoagressão:
   - Usar texto literal de `apps/orchestrator-py/app/conversation/crisis_copy.py` (ADR-005)
   - Registrar em `protocolos_crise_acionados` (append-only)
   - Notificar médico via `notificacoes_medico`
   - Pausar automação: `UPDATE pacientes SET automacao_pausada = TRUE`
   - **Nunca** gerar o texto de crise com o LLM. Nunca encurtar ou "humanizar".

3. **Médico no loop.** Toda resposta ao paciente passa por `audit_response` e pode escalar para `escalate_to_human`. Não crie caminho que entregue texto da IA ao paciente sem essa etapa.

4. **LGPD — dado de saúde mental.** Minimização de dados, controle de acesso por tenant, PII redatada em traces (`PII_REDACTION_ENABLED=true` no LangSmith). Nunca logar conteúdo clínico cru.

5. **Trilhas de auditoria são imutáveis.** As tabelas `protocolos_crise_acionados`, `notificacoes_medico` e `agente_execucoes` são append-only. Nenhuma migration ou código deve fazer DELETE ou UPDATE de massa nelas.

---

## 3. Stack tecnológica

### 3.1 Infraestrutura

| Componente | Tecnologia | Observação |
|---|---|---|
| **Cloud** | AWS, `sa-east-1` | Residência de dados no Brasil. Decisão fechada. |
| **Banco** | PostgreSQL (RDS) | pgvector + pgcrypto. Externo aos containers. |
| **EC2** | Docker Compose | Todos os serviços em containers. |
| **CI/CD** | GitHub Actions → SSH EC2 | Push em `master` → deploy automático. |
| **Azure** | **REMOVIDO** | Key Vault, OpenAI, Document Intelligence e Blob saíram do V3. Não reintroduzir. |

### 3.2 Serviços (monorepo `apps/`)

| Serviço | Tecnologia | Responsabilidade |
|---|---|---|
| **web** | Next.js 16, React 19, TypeScript, Tailwind 4, shadcn/ui | Landing, dashboard médico, portal paciente, BFF |
| **api-gateway** | ASP.NET Core / .NET 10, EF Core 10, Npgsql, JwtBearer | REST, JWT, e-mail (Resend), proxy SSE |
| **orchestrator-py** | Python 3.12, FastAPI, LangGraph, asyncpg | IA conversacional, protocolo de crise |
| **agents-py** | Python 3.12, FastAPI, APScheduler, scipy, asyncpg | 5 agentes analíticos agendados |
| **notifier-py** | Python 3.12, FastAPI, pywebpush, asyncpg | Web Push de check-ins |

### 3.3 LLM (Claude via AWS Bedrock)

- **Provedor:** AWS Bedrock In-Region (`sa-east-1`)
- **Auth:** IAM role da EC2 com `bedrock:InvokeModel`. Sem `ANTHROPIC_API_KEY`.
- **Nunca** chamar LLM do gateway .NET ou do Next.js. Apenas Python.

| Modelo | Variável | Uso |
|---|---|---|
| Claude Haiku | `BEDROCK_MODEL_HAIKU` | Detecção de crise, classificação, auditoria conversacional |
| Claude Sonnet | `BEDROCK_MODEL_SONNET` | Extração de sintomas, resposta ao paciente, agentes analíticos |
| Claude Opus 4.7 | `BEDROCK_MODEL_OPUS` | Análise de padrões densa (opcional) |

### 3.4 Dependências-chave do api-gateway

```
Microsoft.AspNetCore.OpenApi 10.0.0
Microsoft.EntityFrameworkCore 10.0.1
Npgsql.EntityFrameworkCore.PostgreSQL 10.0.0
EFCore.NamingConventions 10.0.1          ← snake_case automático
Microsoft.AspNetCore.Authentication.JwtBearer 10.0.0
Microsoft.Extensions.Http.Resilience 10.0.0
```

---

## 4. Topologia e fluxo de integração

```
Paciente PWA /p/*          Médico /dashboard/*
        └──────────────┬──────────────┘
                       ▼
              web (Next.js :3000)
              BFF: app/api/* — cookies httpOnly
              auth_token (médico) · paciente_token (paciente)
                       ▼
              api-gateway (.NET 10 :5050→:5000)
              JWT · EF Core · Resend · proxy SSE
                       │  Bearer ${INTERNAL_API_TOKEN}
       ┌───────────────┼───────────────┬──────────────┐
       ▼               ▼               ▼              ▼
orchestrator-py    agents-py      notifier-py    PostgreSQL RDS
  :8081              :8082           :8083          sa-east-1
  LangGraph          APScheduler     Web Push       pgvector+pgcrypto
  SSE conversa       5 agentes       check-ins
       └──────────────┴───────────────┘
                       ▼
            AWS Bedrock In-Region sa-east-1
            Haiku · Sonnet · Opus 4.7 (IAM role)
```

### Regras de fronteira (não violar)

| Responsabilidade | Serviço |
|---|---|
| Chamar LLM | **Apenas Python** (orchestrator-py, agents-py) via Bedrock |
| REST transacional, JWT, e-mail, proxy SSE | **api-gateway** (.NET 10) |
| Cookies, sessão, agregação de dados, render | **web / BFF** (`app/api/*`) |
| Push de check-in | **notifier-py** |
| Jobs analíticos agendados | **agents-py** |
| Banco Postgres | **Nunca direto do front**. Gateway ou serviços Python. |

### Auth serviço-a-serviço

```
Header: Authorization: Bearer ${INTERNAL_API_TOKEN}
Direção: api-gateway → orchestrator-py, agents-py, notifier-py
```

---

## 5. Banco de dados

### 5.1 Grupos de tabelas

| Grupo | Tabelas |
|---|---|
| Tenancy | `clientes`, `usuarios`, `medicos`, `pacientes` |
| Conversação | `conversas`, `mensagens`, `conhecimento` (pgvector), `inbound_messages` |
| Clínico | `prescricoes`, `prescricao_eventos`, `tomadas_medicacao`, `sintomas`, `eventos`, `consultas`, `questionarios`, `questionarios_respostas` |
| Crise / auditoria | `protocolos_crise_acionados`, `notificacoes_medico`, `agente_execucoes` |
| Portal paciente | `pacientes_credenciais`, `magic_links`, `diario_entradas`, `acessos_paciente` |
| Check-ins / push | `checkins`, `push_subscriptions`, `notificacoes_enviadas` |
| IA analítica | `insights` |
| Catálogo | `agentes`, `medicamentos` |

Migrations: `infra/migrations/` — **`0001_init.sql` é a fonte da verdade**.

### 5.2 Modelo de entidade (leia antes de escrever queries)

- **`clientes`** — Pessoa-paciente. PK `id` (UUID). Campos: `nome`, `email`, `wa_id`, `contexto` (JSONB). Não é "cliente comercial" — é a identidade base do usuário do portal.

- **`usuarios`** — Login do médico. PK `id`. Campos: `email`, `senha_hash`, `nome`, `role`. Sem `cliente_id`.

- **`medicos`** — Perfil clínico do médico. PK `id`. FK `usuario_id → usuarios`. **Sem `cliente_id`.** 1:1 com `usuarios`.

- **`pacientes`** — Vínculo clínico médico↔paciente. **PK = `cliente_id REFERENCES clientes(id)`** (1:1 com `clientes`). Campos: `medico_responsavel_id`, `cpf`, `data_nascimento`, `consentimento_lgpd_em`, `config_lembretes`, `automacao_pausada`.

- **Tabelas clínicas** (`prescricoes`, `tomadas_medicacao`, `sintomas`, `eventos`, `consultas`, `questionarios_respostas`, `checkins`, `diario_entradas`, `magic_links`, `acessos_paciente`, `pacientes_credenciais`, `prescricao_eventos`, `protocolos_crise_acionados`, `agente_execucoes`, `insights` por paciente): coluna **`paciente_id UUID REFERENCES clientes(id)`**. O nome é `paciente_id` mas a FK aponta para `clientes.id` — não para a tabela `pacientes`.

- **`conversas`** — FK chama `cliente_id REFERENCES clientes(id)`.

- **`notificacoes_medico`**, **`insights`** — Têm `medico_id REFERENCES medicos(id)` direto.

### 5.3 Multi-tenant — padrão obrigatório

**Tenant = `pacientes.medico_responsavel_id`**. Para escopar dado clínico por médico:

```sql
-- Tabelas clínicas (prescricoes, sintomas, eventos, checkins, diario_entradas, etc.)
SELECT t.*
FROM <tabela> t
JOIN pacientes p ON p.cliente_id = t.paciente_id
WHERE p.medico_responsavel_id = :medicoId;

-- notificacoes_medico e insights (FK medico_id direta)
SELECT * FROM notificacoes_medico WHERE medico_id = :medicoId;
SELECT * FROM insights WHERE medico_id = :medicoId;
```

> **Armadilha frequente:** `WHERE paciente_id = :x` sem JOIN em `pacientes` filtra por paciente individual mas **não garante** que o médico autenticado tem acesso. O filtro de tenant é sempre via `medico_responsavel_id`.

### 5.4 Tabelas append-only (nunca apagar)

| Tabela | Quem escreve | Quem lê |
|---|---|---|
| `protocolos_crise_acionados` | orchestrator-py | api-gateway (timeline) |
| `notificacoes_medico` | orchestrator-py, agents-py | api-gateway (lida/nao-lida é o único UPDATE permitido) |
| `agente_execucoes` | agents-py | api-gateway, admins |

### 5.5 Migrations aplicadas

| Arquivo | Conteúdo |
|---|---|
| `0001_init.sql` | DDL completo — todas as tabelas, índices, seed de questionários |
| `0002_fix_agente_execucoes.sql` | Alinha `agente_execucoes` ao código agents-py (drop status/resultado/criado_em, add iniciado_em/concluido_em/sucesso/erro/metadata) |
| `0003_add_automacao_pausada.sql` | Adiciona `pacientes.automacao_pausada BOOL` — exigida pelo protocolo de crise (ADR-005) |

---

## 6. Fluxo de trabalho (dia a dia)

### 6.1 Conversa do paciente (SSE)

```
PWA /p/conversa
  → POST /api/paciente/conversation (BFF, cookie paciente_token)
    → POST /api/portal/conversation/message (api-gateway, JWT)
      → POST /internal/portal/conversation/message (orchestrator-py, INTERNAL_API_TOKEN)
        ← SSE stream: eventos {tipo, conteudo}
      ← SSE proxy (api-gateway → BFF → PWA)
```

Grafo LangGraph:

```
load_context → detect_crisis (Haiku)
  → [crise] crisis_protocol → registra protocolos_crise_acionados
                             → notifica médico → pausa automação → END
  → [normal] classify_medication (Haiku) → update_intake
           → extract_symptoms (Sonnet) → generate_response (Sonnet, SSE)
           → audit_response (Haiku) → finalize | reescrever | escalate_to_human
```

Checkpointing: `AsyncPostgresSaver` LangGraph em tabelas `checkpoints*`.

### 6.2 Agentes analíticos (jobs)

```
APScheduler (agents-py, AGENTS_MODE=scheduled)
  → a cada SCHEDULER_INTERVAL_SECONDS (padrão: 5 min)
    → para cada paciente ativo:
        adesao.run() → INSERT insights + agente_execucoes
        risco_silencioso.run() → idem
        padroes.run() (1×/dia) → idem
        resumo_pre_consulta.run() (janela 30-120 min pré-consulta) → idem
        diario.run() (pré-consulta, ≥ 2 entradas) → idem
  → notifier-py (NOTIFIER_MODE=scheduled)
      → varre checkins pendentes → Web Push (VAPID)
```

`SHADOW_MODE=true` → calcula e loga sem efeitos externos (dev/staging).

### 6.3 Autenticação e sessão

| Público | Token | Cookie | Duração |
|---|---|---|---|
| Médico | JWT Bearer (`role=admin`) | `auth_token` (httpOnly) | 8h |
| Paciente | JWT Bearer (`role=paciente`) | `paciente_token` (httpOnly) | 7d |

JWT: Issuer `cerebro-amigo`, audiences `dashboard` (médico) e `portal-paciente` (paciente). Claim `paciente_id` no token paciente; `sub` = `usuario_id` no token médico.

Acesso paciente: magic link por e-mail (Resend) → primeira senha → login normal. Brute-force: `falhas_seguidas + bloqueado_ate` em `pacientes_credenciais`.

### 6.4 Deploy

```
git push origin master
  → GitHub Actions (.github/workflows/deploy.yml)
    → SSH EC2
      → git pull origin master
      → docker compose up -d --build
```

Migrations devem ser aplicadas manualmente antes do deploy quando há `infra/migrations/` novos:

```bash
psql $POSTGRES_DSN -f infra/migrations/0003_add_automacao_pausada.sql
```

---

## 7. Portas e health checks

| Serviço | Porta host | Porta container | Health endpoints |
|---|---|---|---|
| web | 3000 | 3000 | — |
| api-gateway | 5050 | 5000 | `GET /health` · `GET /ready` (checa Postgres) |
| orchestrator-py | 8081 | 8081 | `GET /health` · `GET /ready` |
| agents-py | 8082 | 8082 | `GET /health` · `GET /ready` |
| notifier-py | 8083 | 8083 | `GET /health` · `GET /ready` |
| PostgreSQL | externo (RDS) | — | Via `POSTGRES_DSN` |

Postgres **não** entra no docker-compose — é externo (RDS em produção, instância local em dev).

---

## 8. Variáveis de ambiente

```bash
# Banco
POSTGRES_DSN                  # postgresql://user:pass@host:5432/db

# Auth
JWT_SECRET                    # médico e paciente
INTERNAL_API_TOKEN            # serviço-a-serviço (.NET ↔ Python)

# E-mail (Resend)
RESEND_API_KEY
EMAIL_FROM                    # ex: noreply@cerebroamigo.com

# Web Push (VAPID)
VAPID_PRIVATE_KEY
VAPID_PUBLIC_KEY
NEXT_PUBLIC_VAPID_PUBLIC_KEY  # exposta ao browser

# URLs (dev local → Docker usa nomes de container)
API_GATEWAY_URL               # http://localhost:5050 | http://api-gateway:5000
ORCHESTRATOR_PY_URL           # http://localhost:8081 | http://orchestrator-py:8081
AGENTS_PY_URL                 # http://localhost:8082 | http://agents-py:8082
NOTIFIER_PY_URL               # http://localhost:8083 | http://notifier-py:8083

# Bedrock — sem ANTHROPIC_API_KEY; auth por IAM role
AWS_REGION=sa-east-1
BEDROCK_REGION=sa-east-1
BEDROCK_MODEL_HAIKU           # ex: anthropic.claude-haiku-4-5-20251001-v1:0
BEDROCK_MODEL_SONNET          # ex: anthropic.claude-sonnet-4-6-v1:0
BEDROCK_MODEL_OPUS            # ex: anthropic.claude-opus-4-7-v1:0
AWS_PROFILE                   # dev local; prod usa IAM role da EC2

# Observabilidade
LANGSMITH_API_KEY
LANGSMITH_PROJECT
LANGSMITH_TRACING_V2=true
PII_REDACTION_ENABLED=true

# Modos operacionais
SHADOW_MODE                   # orchestrator-py: processa sem efeitos externos
AGENTS_MODE                   # scheduled | manual
NOTIFIER_MODE                 # scheduled | manual
SCHEDULER_INTERVAL_SECONDS    # padrão: 300

# Debug (nunca true em produção)
EXPOSE_ERROR_DETAILS          # api-gateway: detalhes de exceção na resposta
```

**Não existem mais:** `ANTHROPIC_API_KEY`, `MODEL_HAIKU/SONNET` (Anthropic direto), qualquer `AZURE_*`.

---

## 9. Mapa de rotas

### 9.1 Web → BFF → Gateway

| Rota web | BFF (`app/api/`) | Endpoint gateway |
|---|---|---|
| `/login` | `POST /api/auth/login` | `POST /api/v1/auth/login` |
| `/dashboard/pacientes` | `GET /api/dashboard/pacientes` | `GET /api/v1/pacientes` |
| `/dashboard/prontuarios/[id]` | `GET /api/dashboard/pacientes/[id]/*` | `GET /api/v1/pacientes/{id}/timeline\|humor\|adesao` |
| `/dashboard/evolucao` | idem | `GET /api/v1/insights/*` |
| `/dashboard/checkins` | `GET /api/dashboard/checkins` | `GET /api/v1/pacientes/{id}/checkins` |
| `/dashboard/agentes` | `GET/PUT /api/agentes` | `GET/PUT /api/v1/agentes/*` |
| `/dashboard/agenda` *(A FAZER)* | `GET/POST /api/agenda` | `GET/POST /api/v1/consultas/*` |
| `/p/entrar` | `POST /api/paciente/login` · `POST /api/paciente/magic-validar` | `POST /api/v1/auth/paciente/*` |
| `/p/conversa` | `POST /api/paciente/conversation` (SSE proxy) | `POST /api/portal/conversation/message` |
| `/p/diario` | `GET/POST /api/paciente/diario` | `GET/POST /api/v1/portal/paciente/diario/*` |
| `/p/humor` | `POST /api/paciente/humor` | `POST /api/v1/portal/paciente/humor` |
| `/p/checkin/[id]` | `POST /api/paciente/checkins/[id]/responder` | `POST /api/v1/portal/paciente/checkins/{id}/responder` |

### 9.2 Endpoints internos Python (não expostos ao browser)

| Serviço | Endpoint | Trigger |
|---|---|---|
| orchestrator-py | `POST /internal/portal/conversation/message` | Proxy SSE do gateway |
| agents-py | `POST /internal/agents/{name}/run` | Sob demanda (resumo pré-consulta) |
| notifier-py | `POST /internal/checkins/dispatch` | Agendado interno |

---

## 10. Funcionalidades implementadas

### Dashboard médico (`/dashboard/*`)

- CRUD de pacientes com magic link de cadastro por e-mail
- Ficha do paciente: resumo, prescrições, histórico de tomadas, timeline de humor
- Prescrições: criação, edição, desativação; catálogo de medicamentos psiquiátricos
- Gráficos de humor e adesão à medicação por período
- Insights analíticos priorizados por severidade (crítico → info)
- Notificações clínicas: marcar lida / não lida
- Resumo pré-consulta on-demand (chama agents-py via gateway)
- Editor de prompts dos agentes (`/dashboard/agentes`)

### Portal paciente (`/p/*`)

- Home com resumo de medicações do dia
- Registro de humor (1-10)
- Diário de entradas (com opção de compartilhar com médico)
- Confirmação de tomadas de medicação
- Perfil e troca de senha
- Check-ins estruturados por push (`/p/checkin/[id]`)
- Conversa SSE (backend pronto; UI de chat pendente)

### IA conversacional

- Grafo LangGraph completo com detect_crisis, classify_medication, extract_symptoms, generate_response, audit_response
- Protocolo de crise com texto literal pré-aprovado
- Checkpointing de conversa no Postgres

### Agentes analíticos (5)

| Agente | Produto | Cadência |
|---|---|---|
| `resumo_pre_consulta` | Sumário estruturado pré-consulta | Janela 30-120 min antes da consulta |
| `adesao` | Taxa de medicação e tendência de engajamento | Cada tick, com thresholds de alerta |
| `risco_silencioso` | Ausência atípica + sinais negativos | Cada tick |
| `padroes` | Tendências estatísticas de sintomas (scipy) | 1×/dia por paciente |
| `diario` | Síntese de entradas compartilhadas com médico | Pré-consulta, mínimo 2 entradas |

---

## 11. Avaliação das responsabilidades futuras

Esta seção descreve o trabalho não iniciado, com estimativa de complexidade e dependências. Organizado por prioridade e impacto clínico.

### 11.1 BFF real + remoção de dados mock `[ALTA PRIORIDADE]`

**Status:** Todo `/dashboard/*` consome dados mock de arquivos `.ts` em `lib/mock-*.ts`. O api-gateway está funcional e o seed de demonstração está aplicado no RDS.

**O que fazer:**
- Implementar todas as rotas BFF em `apps/web/app/api/` que hoje retornam dados estáticos
- Conectar `proxyFetch` / `fetchApi` ao `API_GATEWAY_URL`
- Remover todos os `import` de `lib/mock-*` das server components e page components
- Garantir tratamento de erro (401 → redirect `/login`, 503 → estado de erro amigável)

**Dependências:** api-gateway já expõe todos os endpoints necessários. Nenhuma migration adicional.

**Complexidade:** Média. Trabalho sistemático mas sem decisão arquitetural nova.

---

### 11.2 Portal paciente `/p/*` completo `[ALTA PRIORIDADE]`

**Status:** Rotas existem, autenticação funciona, BFF de humor/diário/checkins está esboçado. UI de conversa SSE não existe.

**O que fazer:**

1. **UI de conversa SSE** (`/p/conversa`) — componente de chat que consome o stream do BFF. Exige tratamento de eventos SSE, bolhas de mensagem, indicador de "digitando", scroll automático.

2. **Web Push completo** — Service Worker já existe (`public/sw.js`). Falta: UI de opt-in de notificação, flow de permissão de push no browser, teste de entrega end-to-end.

3. **Check-in flow** — Notificação push chega com `checkin_id` → abre `/p/checkin/[id]` com formulário contextual (humor, medicação, questionário PHQ-9/GAD-7). Falta a UI completa do check-in e a lógica de expiração.

4. **PWA installability** — `manifest.json` e metatags para iOS/Android. iOS requer app na tela inicial para receber push.

**Complexidade:** Alta. A conversa SSE tem estado assíncrono complexo (reconexão, buffer, parcial). Push em iOS tem restrições específicas.

---

### 11.3 Agenda `/dashboard/agenda` `[MÉDIA PRIORIDADE]`

**Status:** Tabela `consultas` existe no schema com todos os campos necessários. Nenhum endpoint de agenda existe no gateway. Nenhuma UI.

**O que fazer:**
- Endpoints REST: `GET/POST /api/v1/consultas`, `PUT/DELETE /api/v1/consultas/{id}` no api-gateway
- BFF: `GET/POST /api/agenda/*`
- UI: calendário (semana/mês), modal de agendamento, confirmação por e-mail (Resend), status (agendada → confirmada → realizada → cancelada)
- Notificação ao médico 24h antes (novo agente ou Lambda)

**Dependências:** Definir se lembretes de consulta são enviados por notifier-py (Web Push) ou Resend (e-mail). Consultas também alimentarão `resumo_pre_consulta` (já usa `consultas` via query).

**Complexidade:** Média-alta. O calendário tem UX complexa.

---

### 11.4 Job de criação de check-ins de medicação `[MÉDIA PRIORIDADE]`

**Status crítico:** `notifier-py` **só dispara** check-ins já existentes na tabela `checkins`. Nenhum serviço *cria* os check-ins automaticamente. Isso significa que check-ins de medicação precisam ser inseridos manualmente ou via seed — não escala.

**O que fazer:**
- Novo job em `agents-py` ou `notifier-py`: para cada prescrição ativa com `horarios[]` definidos, criar check-in em `checkins` para o próximo horário ainda não coberto
- Lógica de idempotência: não duplicar check-ins para o mesmo `prescricao_id` + `agendado_para`
- Lógica de expiração: check-ins não respondidos em X horas marcam `expirado_em`

**Dependências:** Não depende de nenhuma migration (schema já suporta). Depende de decisão de cadência (criar D-1 às meia-noite? H-2 antes do horário?).

**Complexidade:** Média. A lógica de janela temporal e idempotência exige atenção.

---

### 11.5 PHQ-9 / GAD-7 via check-in agendado `[MÉDIA PRIORIDADE]`

**Status:** Tabelas `questionarios` e `questionarios_respostas` existem e têm dados seed (PHQ-9 e GAD-7). `checkins` suporta `tipo = 'questionario_phq9' | 'questionario_gad7'`. Nenhum fluxo end-to-end implementado.

**O que fazer:**
- Job que cria check-in de questionário mensalmente por paciente (ou sob demanda do médico)
- UI do check-in com as 9 ou 7 perguntas, escala Likert
- Cálculo de score total + interpretação no BFF ou gateway
- Registro em `questionarios_respostas` + geração de insight via agente `padroes`

**Complexidade:** Média.

---

### 11.6 IAM role na EC2 com `bedrock:InvokeModel` `[ALTA — bloqueante para produção com IA]`

**Status:** Config Python assume IAM role em produção (`AWS_PROFILE` só em dev local). Se a role não estiver criada e associada à EC2, todos os agentes e orchestrator falham ao chamar Bedrock.

**O que fazer:**
- Criar IAM role `cerebro-amigo-ec2` com policy `bedrock:InvokeModel` em `sa-east-1` para os modelos Haiku/Sonnet/Opus
- Associar role à instância EC2 via Instance Profile
- Remover `AWS_PROFILE` do `.env` de produção
- Testar: `aws sts get-caller-identity` dentro do container Python deve retornar a role

**Complexidade:** Baixa (AWS Console ou CLI). Altamente bloqueante para IA em produção.

---

### 11.7 Editor de prompts dos agentes `[BAIXA PRIORIDADE]`

**Status:** Tabela `agentes` existe com `system_prompt`, `modelo_default`, `ativo`. Rota `/dashboard/agentes` existe na web. Endpoints no api-gateway (GET/PUT) existem. UI de edição está pendente.

**O que fazer:**
- Tela com lista dos 5 agentes, campo de texto para `system_prompt`, seletor de modelo, toggle `ativo`
- Preview/diff do prompt anterior
- Versionamento simples: salvar histórico de prompts editados em nova tabela `agentes_historico`

**Complexidade:** Baixa.

---

### 11.8 RAG (Retrieval-Augmented Generation) `[LONGO PRAZO]`

**Status:** Tabela `conhecimento` existe com `embedding vector(1536)` e pgvector habilitado. Nenhum pipeline de indexação ou busca implementado.

**Potencial:** Indexar histórico clínico do paciente (sintomas, consultas, prescrições) para contexto rico nas respostas do orchestrator. Também possibilita busca semântica em entradas do diário.

**Dependências:** Definir modelo de embedding (Bedrock tem Amazon Titan Embeddings). Definir janela de contexto e estratégia de chunking. Exige avaliação de custo x benefício clínico.

**Complexidade:** Alta. Cuidado especial com LGPD — embedding de dado clínico é dado derivado sensível.

---

### 11.9 Multi-médico por clínica `[LONGO PRAZO]`

**Status:** Schema suporta múltiplos médicos (cada um com `usuario_id` próprio). Endpoint seed só cria o primeiro. Não há UI de convite ou gestão de equipe.

**O que fazer:**
- Endpoint de convite de médico (e-mail Resend + magic link)
- Conceito de "clínica" como agrupador de médicos (nova tabela `clinicas` + FK em `medicos`)
- Regras de acesso: médico vê só seus pacientes; admin da clínica vê todos
- Faturamento: multi-médico pode implicar em planos diferentes

**Complexidade:** Alta. Mudança arquitetural no modelo de tenancy.

---

### 11.10 WhatsApp Cloud API `[FUTURO INDEFINIDO]`

**Status:** Completamente removido do orchestrator V3. Tabela `inbound_messages` existe para mensagens brutas de webhook. Canal primário atual é o PWA.

**Consideração:** Reintroduzir WhatsApp exige tratamento de webhook Meta, validação de assinatura, filas de processamento, e alinhamento regulatório (conversas de saúde pelo WhatsApp têm implicações LGPD adicionais).

**Complexidade:** Alta. Decisão de produto antes de qualquer implementação.

---

## 12. Operação local

```bash
# 1. Clonar e instalar dependências web
cd apps/web && pnpm install

# 2. Configurar variáveis
cp .env.example .env
# editar .env com Postgres, JWT_SECRET, INTERNAL_API_TOKEN, RESEND_*, VAPID_*, Bedrock

# 3. Aplicar migrations (banco deve estar acessível)
psql $POSTGRES_DSN -f infra/migrations/0001_init.sql
psql $POSTGRES_DSN -f infra/migrations/0002_fix_agente_execucoes.sql
psql $POSTGRES_DSN -f infra/migrations/0003_add_automacao_pausada.sql

# 4. Subir containers
docker compose up -d --build

# 5. Seed de demonstração
bash infra/seed/run_demo.sh
# ou manualmente:
# POST http://localhost:5050/api/v1/seed/primeiro-medico (body: email/senha/nome/crm)
# psql $POSTGRES_DSN -f infra/seed/demo.sql

# 6. Acesso
# Médico:   http://localhost:3000/login   (demo@cerebroamigo.com / Demo@2026!)
# Paciente: http://localhost:3000/p/entrar
```

---

## 13. Checklist de go-live

1. IAM role EC2 com `bedrock:InvokeModel` criada e associada
2. Revisão médica/jurídica do texto de crise (`crisis_copy.py`)
3. Dados legais: CNPJ, DPO, endereço em `/privacidade` e e-mails transacionais
4. HTTPS na frente do EC2 (Cloudflare/nginx + certificado)
5. Domínio Resend com SPF/DKIM configurado
6. VAPID keys geradas em produção (regelar invalida todas as subscriptions)
7. Ensaio ponta a ponta do protocolo de crise (ideação → notificação → pausa)
8. Teste de push PWA (iOS: app precisa estar na tela inicial)
9. `PII_REDACTION_ENABLED=true` e `SHADOW_MODE` removido do `.env` de produção
10. Backup automático do RDS configurado

---

## 14. ADRs (decisões arquiteturais)

| # | Decisão | Status |
|---|---|---|
| [001](adrs/ADR-001-backend-transacional-net.md) | Backend transacional em .NET (não Go) | Accepted |
| [002](adrs/ADR-002-ia-conversacional-python-langgraph.md) | IA conversacional Python + LangGraph | Accepted |
| [003](adrs/ADR-003-agentes-analiticos-python-vanilla.md) | Agentes analíticos Python sem LangGraph | Accepted |
| [004](adrs/ADR-004-lgpd-traces-langsmith.md) | LGPD em traces LangSmith + redação de PII | Accepted |
| [005](adrs/ADR-005-versionamento-texto-crise.md) | Texto de crise versionado em código, não no banco | Accepted |
| [006](adrs/ADR-006-fail-safe-classificador-crise.md) | Fail-safe conservador no classificador de crise | Accepted |
| [007](adrs/ADR-007-gateway-net-nao-go.md) | Gateway .NET 10, não Go — razões V3 | Accepted |
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
| [043](adrs/ADR-043-ha-spof-plano.md) | Alta disponibilidade e fim do SPOF — plano | Proposed |
| [044](adrs/ADR-044-llm-anthropic-api-direta.md) | LLM via Anthropic API direta (vigente); Bedrock suspenso | Accepted |
| [045](adrs/ADR-045-checkup-decouple-asg-alb.md) | Desacoplar o Check-up para infra própria (ALB + ASG) | Accepted |
| [046](adrs/ADR-046-signup-externo-medico-atribuicao-checkup.md) | Signup externo de médico + atribuição do Check-up | Accepted |
| [047](adrs/ADR-047-cloudfront-checkup.md) | CloudFront na frente do checkup.cerebroamigo.com.br | Proposed |
| [048](adrs/ADR-048-expansao-escalas-checkup.md) | Expansão das escalas do Check-up (AUDIT, MDQ, Fagerström, MSI-BPD) | Accepted |
| [049](adrs/ADR-049-assist-ux-proprio.md) | ASSIST com UX próprio no Check-up Mental | Accepted |
| [050](adrs/ADR-050-checkup-longitudinal-anonimo.md) | Cockpit de Aquisição + Check-up longitudinal pseudonimizado | Accepted (P1) / Proposed (P2) |
| [051](adrs/ADR-051-validacao-escalas-checkup.md) | Validação e fidelidade das escalas (PHQ-9, GAD-7, ASRS-18) | Accepted |
| [052](adrs/ADR-052-checkup-no-ec2-nao-vercel.md) | Check-up roda no EC2 (não na Vercel) | Accepted |

---

## 15. Glossário

| Termo | Significado |
|---|---|
| **BFF** | Backend-for-Frontend — Route Handlers em `app/api/*` no Next.js |
| **Gateway** | `apps/api-gateway` .NET — REST, JWT, proxy SSE |
| **orchestrator-py** | Serviço de conversação LangGraph (grafo de IA) |
| **agents-py** | Jobs analíticos (geram insights) |
| **notifier-py** | Dispara Web Push para check-ins pendentes |
| **Insight** | Artefato analítico gerado por agente; lido pelo médico no dashboard |
| **Check-in** | Pergunta estruturada enviada ao paciente via push (medicação, humor, questionário) |
| **PWA** | Portal paciente instalável — Next.js com Service Worker |
| **Tenant** | Psiquiatra (médico). Dados isolados por `medico_responsavel_id` |
| **SHADOW_MODE** | Agentes calculam mas não salvam resultados nem disparam push (dev/staging) |
| **INTERNAL_API_TOKEN** | Token Bearer para autenticação serviço-a-serviço (.NET ↔ Python) |

---

**Responsável clínico final:** o médico titular da conta. O software é ferramenta de apoio operacional — não substitui julgamento clínico, diagnóstico ou conduta médica.
