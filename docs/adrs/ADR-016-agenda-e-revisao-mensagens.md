# ADR-016: Agenda de consultas + console de revisão de mensagens (read-only)

**Status:** Accepted
**Data:** 2026-06-01
**Decisores:** Patrick Arinelli, Adonai Arinelli
**Categoria:** Produto / Segurança clínica
**Relaciona:** ADR-007 (gateway .NET), regra clínica "médico no loop"

## Contexto

A migração V3 precisava destravar duas telas do dashboard médico que estavam
mock: **agenda** (`/dashboard/agenda` + briefing pré-consulta) e **mensagens**
(`/dashboard/mensagens`). A tabela `consultas` já existia no schema; `conversas`
e `mensagens` também, mas nenhuma tinha endpoint no gateway.

Duas decisões precisavam ser fixadas:

1. Como expor a agenda (CRUD de `consultas`) respeitando multi-tenant.
2. O que a tela de "mensagens" do médico faz — em especial, **se existe um canal
   médico → paciente direto**.

## Decisão

### Agenda — CRUD de `consultas` no gateway (.NET)

`ConsultasEndpoints` expõe sob `/api/v1/consultas` (policy médico):

- `GET /` (intervalo `de`..`ate`, default hoje..+7d)
- `GET /{id}` — resolve consulta → paciente (usado pelo briefing)
- `POST /` — agendar
- `PATCH /{id}` — status / horário / modalidade / notas (COALESCE; null = inalterado)

**Tenant é a primeira cláusula, sempre via JOIN `pacientes.medico_responsavel_id`**
(não via `consultas.medico_id`, que é nullable). O briefing pré-consulta
(`/dashboard/consultas/{id}/briefing`) deixa de ser mock: resolve o paciente pela
consulta e monta humor + adesão + síntese a partir dos endpoints já existentes
(`/{id}/humor`, `/{id}/adesao`, `/{id}/resumo-pre-consulta`).

### Mensagens — console de revisão SOMENTE LEITURA

**Não existe canal médico → paciente direto no app.** A tela de mensagens é um
**console de revisão**: o médico lê a conversa do paciente com o assistente
(`papel` ∈ {`user`, `assistant`}), nada mais.

`MensagensEndpoints` (`/api/v1/mensagens`, policy médico):

- `GET /conversas` — inbox (1 item por paciente, última mensagem)
- `GET /paciente/{id}` — thread cronológica

O composer foi substituído por um aviso explícito. Respostas ao paciente
continuam saindo **apenas** pela automação/portal, com auditoria.

## Justificativa

- **Médico no loop, sem atalho:** abrir um canal de texto livre médico → paciente
  dentro do app criaria um caminho que entrega mensagem ao paciente **fora** da
  auditoria (`audit_response`) e do protocolo de crise. A regra clínica proíbe
  esse atalho. Revisão read-only não viola nada e entrega valor real (o médico
  acompanha o que o paciente relatou).
- **LGPD:** o conteúdo clínico exibido é do paciente **daquele** médico (controle
  de acesso por tenant). Não é log de aplicação — é o médico exercendo o cuidado.
  As rotas BFF fazem passthrough e **não logam** o conteúdo.
- **Sem migration:** `consultas`, `conversas` e `mensagens` já existiam.

## Consequências

- Agenda e briefing passam a operar com dado real assim que o gateway sobe na EC2
  (ver Fase 7 — infra prod).
- Um eventual canal médico → paciente exigirá **novo ADR** definindo entrega,
  auditoria e escalonamento — não está autorizado por este.
- `CheckinWidget` do dashboard segue mock: falta endpoint agregado de check-ins
  no lado do médico (próximo incremento).
