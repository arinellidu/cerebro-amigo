# ADR-020: Motor de conduta de automação por paciente

**Status:** Accepted
**Data:** 2026-06-03
**Decisores:** Equipe de engenharia + psiquiatra responsável clínico
**Categoria:** Segurança clínica / Produto

## Contexto

O produto trabalha *entre consultas*: lembra medicação, dispara check-ins e
questionários. Até aqui essa automação era **100% global**: medicação a partir
de `prescricoes.horarios`, questionários num horário fixo (PHQ-9 2ª, GAD-7 5ª,
09:00 UTC). O médico não tinha como pilotar o acompanhamento por paciente — não
existia ponto de configuração.

Além disso, os geradores do `agents-py` (`gerador_checkins_medicacao`,
`gerador_questionarios`) **não respeitavam `pacientes.automacao_pausada`**: um
paciente em protocolo de crise continuaria recebendo lembretes e questionários,
furando o circuit-breaker de crise (ADR-019, clinical-safety #2).

## Decisão

### 1. Tabela de conduta por paciente (override sobre o global)

`condutas_automacao` (migration 0011): `(paciente_id, medico_id, tipo, config
JSONB, ativa, ...)` com índice único por `(paciente_id, tipo) WHERE ativa`.
Tipos: `checkin_humor`, `lembrete_medicacao`, `questionario`,
`alerta_nao_adesao`. Mudanças auditadas em `condutas_eventos` (append-only).

O médico autora a regra; o `agents-py` lê o override e, **na ausência de
conduta, mantém o default global**. CRUD no gateway (`CondutasEndpoints`),
escopado por tenant; UI no prontuário (aba "Conduta").

### 2. Consumo no agents-py com gates de segurança

Os geradores existentes agora:
- **Filtram `automacao_pausada = FALSE`** (corrige o furo do circuit-breaker).
- Leem o override via `BaseJob._carregar_condutas(tipo)`:
  - `lembrete_medicacao`: `ativo:false` desliga; `expira_horas` ajusta a janela.
  - `questionario`: `ativo:false` desliga; `<codigo>_weekday` e `hora_utc`
    reagendam, com fallback no `SCHEDULE` global.

### 3. clinical-safety

- Conduta é **regra operacional**, autorada pelo médico — a IA não decide nada
  clínico (regra #1).
- Toda automação proativa respeita `automacao_pausada` e, para **ações novas**,
  o gate `SHADOW_MODE` (logam o que fariam antes de agir em produção).

## Escopo entregue vs. reservado (não-silencioso)

- **Consumidos agora:** `lembrete_medicacao`, `questionario`.
- **Reservados:** `checkin_humor` e `alerta_nao_adesao` têm tabela + UI, mas o
  **consumo** (geradores que empurram check-in de humor ao paciente / alertam o
  médico por não-adesão) é diferido. Motivo: são ações proativas novas que
  exigem o gate `SHADOW_MODE` no `agents-py` (hoje inexistente) e validação
  clínica antes de ir ao ar. Implementar como follow-up: (a) flag de shadow no
  `agents-py`, (b) `BaseJob`s dos dois geradores atrás do gate.

## Alternativas consideradas

### A — Manter tudo global
Rejeitada: o médico não consegue acompanhar paciente a paciente, que é a
proposta do produto entre consultas.

### B — Guardar config em `pacientes.config_lembretes` (TEXT JSON existente)
Rejeitada: sem auditoria de mudança, sem consulta por tipo, sem unicidade por
tipo. Tabela dedicada + `condutas_eventos` dá rastreio e integridade.

### C — Conduta substitui o agendamento global
Rejeitada por ora: override incremental tem menos risco de quebrar a automação
viva e não exige migração dos dados existentes. Reavaliar se a demanda por
controle total por paciente crescer.

## Consequências aceitas

1. Dois tipos ativos hoje; dois reservados (documentado acima).
2. Geradores passam a pular pacientes pausados — comportamento mais seguro e
   correto (era um bug).
3. Config em JSONB é flexível mas sem schema forte; a validação do shape vive no
   gerador (defaults defensivos) e na UI.

## Referências

- `infra/migrations/0011_conduta_automacao.sql`
- `apps/api-gateway/Endpoints/CondutasEndpoints.cs`
- `apps/web/components/conduta/conduta-editor.tsx`
- `apps/agents-py/app/jobs/{base,gerador_checkins_medicacao,gerador_questionarios}.py`
- ADR-019 — retomada de automação pós-crise.
- ADR-017 — imutabilidade do audit trail.
- skill `clinical-safety` — SHADOW_MODE e gates de automação.
