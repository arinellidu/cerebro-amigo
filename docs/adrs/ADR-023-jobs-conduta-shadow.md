# ADR-023: Jobs de conduta (checkin_humor, alerta_nao_adesao) + gate SHADOW

**Status:** Accepted
**Data:** 2026-06-03
**Decisores:** Equipe de engenharia + psiquiatra responsável clínico
**Categoria:** Segurança clínica

## Contexto

O motor de conduta (ADR-020) definiu 4 tipos; 2 foram entregues (lembrete_medicacao,
questionario) e 2 ficaram com tabela+UI mas **sem consumo** (checkin_humor,
alerta_nao_adesao). Ambos são **automação proativa nova**: um empurra check-in de
humor ao paciente, o outro avisa o médico. Por clinical-safety, automação proativa
nova não vai a produção sem um gate de validação — e o `agents-py` **não tinha
`SHADOW_MODE`** (só `agents_mode` scheduled/manual).

## Decisão

1. **Gate `SHADOW_MODE`** em `agents-py` (`Settings.shadow_mode`, default `False`).
   Os 2 jobs novos, quando shadow, **logam o que fariam sem inserir nada**. Não
   altera jobs legados nem agentes analíticos.
2. **`gerador_checkin_humor`** (BaseJob, sem LLM): cria `checkins` tipo
   `humor_diario` conforme a conduta do paciente (dias + horário). Idempotente.
3. **`alerta_nao_adesao`** (BaseJob, sem LLM): tripwire **operacional** por
   paciente — conta doses `esquecida` na janela; se ≥ limiar configurado pelo
   médico, registra `notificacoes_medico` (com dedup). **Complementa, não duplica**
   o agente analítico `adesao` (que faz análise rica periódica com LLM): aqui é o
   gatilho explícito e barato que o médico definiu.
4. Ambos **respeitam `pacientes.automacao_pausada`** (circuit-breaker de crise) e
   são registrados no `JOB_REGISTRY` (o scheduler os agenda automaticamente).

## clinical-safety

- Operacional/administrativo, **não-clínico** (contagem + agendamento + aviso); sem
  LLM, sem interpretação.
- Gate `SHADOW_MODE` + respeito a `automacao_pausada`.
- Ativar em produção: `SHADOW_MODE=false` **após validação clínica** dos parâmetros.

## Validação

Smoke runtime (Postgres pgvector efêmero): `checkin_humor` cria 1, é idempotente,
e em shadow não insere (só `shadow_skipped`); `alerta_nao_adesao` cria a
notificação e respeita o dedup. **Bug pego no smoke e corrigido:** o INSERT do
alerta usava `metadata` em `notificacoes_medico` — coluna inexistente no schema.

## Follow-up descoberto (fora deste ADR)

`notificacoes_medico` **não tem coluna `metadata`**, mas código existente
(`orchestrator-py` `escalate_to_human`, `crisis.py`, `notifier-py` dispatcher)
**insere `metadata`** — esses writes falham em runtime (escalada/crise/push não
registram). Decidir: migração `0014` adicionando `metadata JSONB` (intenção
provável, dado o número de call-sites) **ou** remover `metadata` desses inserts.
Recomendado: a migração, por ser menos invasiva e alinhada ao que o código espera.

## Referências

- `apps/agents-py/app/jobs/{gerador_checkin_humor,alerta_nao_adesao}.py`
- `apps/agents-py/app/core/config.py` (`shadow_mode`)
- ADR-020 — motor de conduta.
- skill `clinical-safety` — SHADOW_MODE.
