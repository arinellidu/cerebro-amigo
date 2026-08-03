# ADR-025: Agenda — disponibilidade, conflito, lembretes e self-booking

**Status:** Accepted
**Data:** 2026-06-04
**Decisores:** Equipe de engenharia + psiquiatra responsável clínico
**Categoria:** Produto / Segurança clínica

## Contexto

A agenda básica (CRUD de `consultas` + view de dia) já existia. Faltavam quatro
capacidades para uma agenda real: (1) calcular horários livres a partir do
expediente do médico e impedir sobreposição; (2) navegar por semana/mês; (3)
lembrar o paciente da consulta; (4) o paciente agendar sozinho. Tudo isso é
**comunicação administrativa** (agendar/lembrar/confirmar) — fora do escopo
clínico da IA.

## Decisão

1. **Disponibilidade + conflito (gateway .NET).** `consultas.duracao_min`
   (migration 0018). Os slots saem de `medicos.horario_trabalho` (JSONB) com shape
   rico `{dias,inicio,fim,duracao_min,almoco}` — backward-compatível com `{inicio,
   fim}`. `GET /api/v1/consultas/disponibilidade?data=` gera os slots no fuso do
   médico (`medicos.timezone`) menos os ocupados. `POST`/`PATCH` rejeitam
   sobreposição com **409** (`TemConflitoAsync`, `make_interval`). Lógica exposta
   como `CalcularDisponibilidadeAsync`/`TemConflitoAsync` (reusada pelo portal).
2. **Views semana/mês (web).** Toggle Dia|Semana|Mês em `/dashboard/agenda`;
   `semana-view`/`mes-view` com `date-fns`. Range já suportado por `?de&ate`.
3. **Lembretes (notifier-py).** Job `despachar_lembretes_consultas` (24h e 1h
   antes) → push + fallback e-mail; dedup em `consulta_lembretes` (migration 0019,
   unique `consulta_id+tipo`). Texto **estático/versionado** (`consulta_copy.py`),
   só data/hora interpolada — **sem LLM**. Flag `consulta_lembretes_enabled`.
   `/dashboard/lembretes` mostra status (resolve o 404 do sidebar).
4. **Self-booking (portal `/p/agenda`).** `PortalAgendaEndpoints` (policy
   `paciente`): listar/agendar/cancelar as próprias consultas. O agendamento
   reusa a disponibilidade do **médico responsável** e nasce `status='agendada'`
   (pendente). Auditoria em `acessos_paciente`.

### clinical-safety

- **Regra #1 intacta:** nenhuma IA envolvida. Disponibilidade, conflito e lembrete
  são determinísticos; o texto do lembrete é constante (sem `crisis_copy`, sem LLM).
- **Regra #3 (médico no loop):** consulta criada pelo paciente entra **pendente**;
  o médico confirma no dashboard. O paciente nunca cria `confirmada`.
- **Tenant:** médico via JOIN `pacientes.medico_responsavel_id`; paciente via
  `GetPacienteId` + `medico_responsavel_id`. O paciente só agenda com o próprio
  médico e só vê/cancela as próprias consultas.
- **LGPD:** lembrete sem dado clínico (só "você tem consulta dia X às Y"); logs do
  notifier sem PII (ids/contagem).

## Consequências

- Reuso forte: `ConsultasEndpoints` (disponibilidade/conflito), `dispatcher`/
  `push_client`/`email_fallback` (notifier), `gateway`/`gateway-paciente` (web).
- `horario_trabalho` vira a fonte de verdade do expediente — configurável em
  `/dashboard/configuracoes` (dias, duração do slot, almoço).
- Migrations novas: `0018` (duracao_min), `0019` (consulta_lembretes).
- Futuro (fora deste ADR): recheck periódico de no-show, recorrência, reagendar
  pelo paciente (hoje é cancelar + reagendar).
