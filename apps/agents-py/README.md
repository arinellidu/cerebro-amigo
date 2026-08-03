# Cérebro Amigo · agents-py

Container dos agentes analíticos em Python (FastAPI + APScheduler + LangSmith).
Substitui `apps/agents/` (Go) na arquitetura final. Cada agente é um job que
varre a DB periodicamente, executa LLM + análise sobre o contexto do paciente,
e grava resultados em `insights` (com trilha em `agente_execucoes`).

## Agentes implementados

| Agente | Status | Cadência default | Janela analisada |
|---|---|---|---|
| `resumo_pre_consulta` | ✅ | a cada 5 min (gera somente quando há consulta na janela 30–120 min) | últimos 14 dias |
| `adesao` | ✅ | a cada 5 min (gera somente quando thresholds disparam) | últimos 30 dias |
| `risco_silencioso` | ✅ | a cada 5 min (gera somente quando há ausência atípica) | últimos 180 dias (histórico) |
| `padroes` | ✅ | a cada 5 min (1x/dia/paciente via dedup) | últimos 30 dias |
| `diario` | ✅ | a cada 5 min (gera somente pré-consulta com ≥ 2 entradas) | últimos 14 dias |

## Como adicionar um agente novo

1. Criar `app/agents/<nome>.py` herdando de `BaseAgent`.
2. Implementar `name`, `find_pending()` e `execute()`.
3. Registrar em `app/agents/__init__.py:AGENT_REGISTRY`.
4. Adicionar configurações específicas em `app/core/config.py` (janelas,
   thresholds, etc) se necessário.
5. Adicionar testes em `tests/`.

A base cuida automaticamente de:
* `agente_execucoes` (trilha com tokens, custo, modelo, erro)
* `insights` (insert com agente, severidade, metadata, valido_ate)
* Dedup window por paciente
* LangSmith tracing (via callbacks do langchain)

## Estrutura

```
app/
├── main.py               # FastAPI + lifespan + endpoints manuais
├── scheduler.py          # APScheduler + dispatchers
├── core/
│   ├── config.py         # Settings tipadas (compartilhada)
│   ├── db.py             # Pool asyncpg
│   ├── llm.py            # Factories haiku/sonnet
│   └── observability.py  # LangSmith + redação PII
└── agents/
    ├── __init__.py       # AGENT_REGISTRY
    ├── base.py           # BaseAgent: trilha, dedup, persistência
    └── resumidor.py      # Resumo pré-consulta (primeiro agente)
```

## Modos

* `AGENTS_MODE=scheduled` (default) — APScheduler dispara ticks periódicos.
* `AGENTS_MODE=manual` — sobe apenas FastAPI; nenhum tick automático.
  Útil em ambientes onde o scheduling é externo (Azure Container Apps Jobs).

## Endpoints manuais

Todos exigem `Authorization: Bearer ${INTERNAL_API_TOKEN}`.

```
GET  /internal/agents
POST /internal/agents/{name}/run                    # tick manual
POST /internal/agents/{name}/run-for-patient        # força por paciente
```

## Smoke test local

```bash
TOKEN=$(docker compose exec -T agents-py sh -c 'echo $INTERNAL_API_TOKEN' | tr -d '\r\n')

# Lista agentes
curl -s http://localhost:8082/internal/agents -H "Authorization: Bearer $TOKEN"

# Força ciclo do resumidor
curl -sS -X POST http://localhost:8082/internal/agents/resumo_pre_consulta/run \
  -H "Authorization: Bearer $TOKEN"

# Força execução pra um paciente específico (precisa consulta agendada futura)
curl -sS -X POST http://localhost:8082/internal/agents/resumo_pre_consulta/run-for-patient \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"paciente_id": "00000000-0000-0000-0000-000000000099"}'

# Confere insight gerado
docker compose exec -T postgres psql -U postgres -d cerebro -c "
SELECT i.titulo, i.severidade, e.tokens_in, e.tokens_out, e.custo_usd, e.modelo
FROM insights i
JOIN agente_execucoes e ON e.insight_id = i.id
WHERE i.agente = 'resumo_pre_consulta'
ORDER BY i.criado_em DESC LIMIT 5;"
```

## LGPD

Mesma estratégia do orchestrator-py: `LANGSMITH_HIDE_*` é **true por
default** (DEBT T0-4) — traces sobem só com metadata — e a redação de PII
por callback segue como defesa em profundidade. Resumos persistidos em
`insights` ficam na sua DB — não saem para terceiros.

## Thresholds clínicos

Os agentes que aplicam triggers baseados em thresholds (`adesao` e os
próximos a vir) usam settings com valores **provisórios** para
desenvolvimento. Antes de produção, esses valores precisam ser revisados
e aprovados pela psiquiatra responsável (ver ADR-006 em `docs/adrs/`).

Valores atuais do `adesao` (em `app/core/config.py`):

| Setting | Default | Significado |
|---|---|---|
| `adesao_janela_dias` | 30 | Período analisado |
| `adesao_threshold_taxa_media` | 0.70 | Taxa < 70% → severidade média |
| `adesao_threshold_taxa_alta` | 0.50 | Taxa < 50% → severidade alta |
| `adesao_threshold_consecutivas_media` | 3 | 3+ doses perdidas em sequência → média |
| `adesao_threshold_consecutivas_alta` | 5 | 5+ doses perdidas em sequência → alta |
| `adesao_threshold_queda_trend_pp` | 15.0 | Queda > 15pp entre metades → trigger |
| `adesao_threshold_inatividade_dias` | 7 | 7+ dias sem nada → trigger comportamental |
| `adesao_threshold_queda_engajamento_pct` | 0.50 | Queda > 50% em interações → trigger |
| `adesao_tolerancia_pendente_horas` | 6 | Margem antes de classificar 'pendente' como perdida |

Combinação de 2+ triggers `_critica`/`_alta` escala automaticamente para
severidade `critica`.

### Risco silencioso

| Setting | Default | Significado |
|---|---|---|
| `risco_silencioso_threshold_dias_absoluto` | 14 | Sem atividade por 14+ dias → trigger absoluto |
| `risco_silencioso_threshold_p95_multiplicador` | 1.5 | Dias atuais > p95 histórico × 1.5 → trigger atípico |
| `risco_silencioso_minimo_amostras_historico` | 5 | Mínimo de intervalos prévios para calcular p95 |
| `risco_silencioso_janela_historico_dias` | 180 | Quantos dias atrás considerar para histórico |
| `risco_silencioso_humor_threshold_baixo` | 3 | Humor ≤ 3/10 conta como sinal negativo |
| `risco_silencioso_ansiedade_threshold_alto` | 8 | Ansiedade ≥ 8/10 conta como sinal negativo |
| `risco_silencioso_janela_crise_recente_dias` | 30 | Crise nos últimos 30d conta como sinal |
| `risco_silencioso_janela_crise_critica_dias` | 14 | Crise nos últimos 14d escala direto para crítica |

Escalada graduada:
- Ausência sem sinais negativos → `media`
- Ausência + 1 sinal negativo (distinto) → `alta`
- Ausência + 2+ sinais negativos distintos → `critica`
- Ausência + crise nos últimos 14 dias → `critica` direto

### Padrões

| Setting | Default | Significado |
|---|---|---|
| `padroes_janela_dias` | 30 | Período de sintomas analisado |
| `padroes_minimo_registros` | 8 | Mínimo de pontos para regressão |
| `padroes_slope_min_pontos_semana` | 0.5 | Slope mínimo (pontos/semana, escala 0-10) |
| `padroes_slope_max_p_value` | 0.10 | p-valor máximo do slope |
| `padroes_step_change_min_diff` | 1.5 | Diferença mínima entre médias (1ª vs 2ª metade) |
| `padroes_step_change_max_p_value` | 0.10 | p-valor máximo (Welch t-test) |
| `padroes_stddev_threshold_media` | 2.0 | Stddev ≥ 2.0 → volatilidade média |
| `padroes_stddev_threshold_alta` | 2.8 | Stddev ≥ 2.8 → volatilidade alta |

Severidade global:
- Tendência negativa em humor + ansiedade crescente → `alta`
- 3+ triggers negativos distintos → `alta`
- Volatilidade alta em humor + tendência humor negativa → `critica`

### Diário

| Setting | Default | Significado |
|---|---|---|
| `diario_janela_dias` | 14 | Janela analisada antes da consulta |
| `diario_minimo_entradas` | 2 | Mínimo de entradas compartilhadas para gerar |
| `diario_lead_min_min` | 30 | Janela pré-consulta — limite inferior |
| `diario_lead_min_max` | 120 | Janela pré-consulta — limite superior |

Por padrão severidade é `info`. Sobe a `alta`/`critica` apenas se o LLM
detectar expressão explícita de risco no conteúdo escrito pelo paciente
(ideação, planejamento, desesperança aguda).
