# ADR-014: Candidatos incrementais em find_pending ("pacientes sujos")

**Status:** Proposed
**Data:** 2026-05-31
**Decisores:** Patrick Arinelli, Adonai Arinelli
**Categoria:** Performance / Arquitetura analítica
**Relaciona:** ADR-009 (separação batch/interativo), ADR-003 (agentes analíticos)
**Pré-condição:** ADR-009 PR 6 (higiene de batch) e PR 5 (agents-py batch puro)

## Contexto

### O problema

Hoje todos os agentes analíticos usam `find_pending()` que escaneia candidatos
**sem filtragem incremental**. O caso mais custoso é `risco_silencioso`:

```python
# risco_silencioso.py:245 — scan de TODOS os pacientes, sem filtro
SELECT cliente_id AS paciente_id, medico_responsavel_id AS medico_id
FROM pacientes
```

Com `dedup_window_hours = 168` (7 dias) e cadência de 24h (ADR-009), o fluxo é:

```
Dia 1: scan 100 pacientes → analisa 100 (todos novos)
Dia 2: scan 100 pacientes → base.py descarta 100 via dedup check (168h não passou)
Dia 3: idem
...
Dia 7: scan 100 pacientes → base.py descarta 100 novamente
```

**6 de 7 disparos semanais** fazem um scan completo e 100 queries de dedup — sem
produzir nenhum insight. Com 1.000 pacientes, isso é 6.000 queries/semana apenas
para descobrir que não há trabalho.

O mesmo padrão, em menor grau, afeta `adesao`:
```sql
-- adesao.py:244 — candidates com prescrição ativa OU mensagem nos últimos 60 dias
-- Dedup window: 24h → 1× por dia é eficiente, mas _calcular_metricas
-- faz N queries/paciente mesmo quando nenhum dado mudou desde ontem.
```

`padroes` tem pré-filtro (`COUNT(sintomas) >= 8`) então é menos afetado.
`resumo_pre_consulta` e `diario` são guiados por `consultas.inicia_em` — já
são eficientemente incrementais por natureza.

### Invariante de segurança relevante

`risco_silencioso` detecta **ausência** de atividade. Um filtro ingênuo de
"pacientes com atividade recente" excluiria exatamente os pacientes em risco.
Qualquer solução de candidatos incrementais **deve incluir explicitamente**
pacientes silenciosos como candidatos.

## Decisão proposta

Duas fases independentes, priorizadas:

---

### Fase 1 — Dedup no SQL (sem mudança de schema)

**Impacto: alto. Custo de implementação: baixo. Sem risco clínico.**

Mover o check de dedup de Python (`base.py:_check_dedup`) para dentro do
`_listar_candidatos()` de cada agente, como subquery no SQL. O `base.py`
mantém o check atual como segurança extra (double-check), mas os candidatos
já chegam filtrados.

**Para `risco_silencioso`:**

```sql
-- risco_silencioso.py:_listar_candidatos — substituir o SELECT atual por:
SELECT p.cliente_id AS paciente_id, p.medico_responsavel_id AS medico_id
FROM pacientes p
WHERE NOT EXISTS (
    SELECT 1
    FROM agente_execucoes ae
    WHERE ae.paciente_id = p.cliente_id
      AND ae.agente = 'risco_silencioso'
      AND ae.sucesso = TRUE
      AND ae.iniciado_em > NOW() - INTERVAL '168 hours'
)
```

Isso retorna apenas pacientes que ainda não foram analisados nesta semana.
Para pacientes silenciosos: eles aparecem na query pois não têm `agente_execucoes`
recentes — correto, são candidatos legítimos.

**Para `adesao`:**

```sql
-- Adicionar ao WHERE existente:
AND NOT EXISTS (
    SELECT 1 FROM agente_execucoes ae
    WHERE ae.paciente_id = p.cliente_id
      AND ae.agente = 'adesao'
      AND ae.sucesso = TRUE
      AND ae.iniciado_em > NOW() - INTERVAL '24 hours'
)
```

**Resultado:** `risco_silencioso` passa de 7× (6 vazios) para 1× scan efetivo/semana.
`adesao` passa de 288×/dia (5 min interval) para 1× scan/dia (com ADR-009 cadências).
`base.py` mantém o check Python como camada extra — sem risco de duplicata.

**Índice necessário** (já provavelmente existente, verificar):
```sql
CREATE INDEX IF NOT EXISTS idx_agente_execucoes_dedup
  ON agente_execucoes (paciente_id, agente, sucesso, iniciado_em DESC)
  WHERE sucesso = TRUE;
```

**Não viola:** append-only em `agente_execucoes` (só leitura aqui). Dedup window
inalterada (`ClassVar[int]`). Insights e `protocolos_crise_acionados` inalterados.

---

### Fase 2 — Tabela de atividade incremental (com schema change)

**Impacto: máximo. Custo: médio. Requer migration e testes.**

Criar uma tabela `pacientes_ultima_atividade` mantida por triggers Postgres:

```sql
-- Migration (append a 0001_init.sql ou nova migration):
CREATE TABLE pacientes_ultima_atividade (
    paciente_id UUID PRIMARY KEY REFERENCES clientes(id),
    ultima_clinica_em  TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- qualquer evento clínico
    ultima_engajamento_em TIMESTAMPTZ,                       -- checkin/diario/mensagem
    ultima_medicacao_em   TIMESTAMPTZ,                       -- tomada_medicacao
    atualizado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trigger genérico (instanciar para cada tabela de evento):
CREATE OR REPLACE FUNCTION _atualizar_ultima_atividade()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO pacientes_ultima_atividade (paciente_id, ultima_clinica_em)
    VALUES (NEW.paciente_id, NOW())
    ON CONFLICT (paciente_id) DO UPDATE
    SET ultima_clinica_em = EXCLUDED.ultima_clinica_em,
        atualizado_em = NOW();
    RETURN NEW;
END;
$$;

-- Aplicar em: sintomas, tomadas_medicacao, checkins, diario_entradas
CREATE TRIGGER trg_sintomas_atividade
AFTER INSERT ON sintomas
FOR EACH ROW EXECUTE FUNCTION _atualizar_ultima_atividade();
-- (repetir para as outras tabelas)
```

`_listar_candidatos` de `adesao` passa a ser:

```sql
SELECT p.cliente_id, p.medico_responsavel_id
FROM pacientes p
JOIN pacientes_ultima_atividade pua ON pua.paciente_id = p.cliente_id
WHERE pua.ultima_medicacao_em > NOW() - INTERVAL '30 days'
  AND NOT EXISTS (dedup check da Fase 1)
```

**Caso especial `risco_silencioso`:** o filtro DEVE ser invertido — incluir
pacientes cujo `ultima_engajamento_em` é antiga (pacientes silenciosos são
os candidatos). Lógica:

```sql
-- risco_silencioso: candidatos = pacientes sem atividade recente OU sem
-- análise recente (catch de pacientes novos com pouco histórico)
WHERE (
    pua.ultima_clinica_em < NOW() - INTERVAL '14 days'   -- potencialmente silencioso
    OR pua.ultima_clinica_em IS NULL                       -- paciente novo sem atividade
)
AND NOT EXISTS (dedup check da Fase 1)
```

**Cuidado:** o threshold de 14 dias precisa ser menor que `risco_silencioso_threshold_dias_absoluto`
(default 14) para não perder casos no limite. Configurável.

**Trade-off principal:** triggers adicionam ~microsegundos a cada INSERT nas
tabelas de evento clínico. Aceitável. O risco é um trigger mal escrito
causar falha em massa de writes — testar extensivamente com INSERT ao mesmo
tempo que `agente_execucoes` é lido.

---

## Alternativas rejeitadas

### Aumentar cadência de risco_silencioso para 168h (semanal)

Eliminaria scans vazios, mas introduziria detecção com atraso de até 7 dias.
Para um agente que detecta crise silenciosa emergente, lag de 7 dias é
clinicamente inaceitável. Rejeitado.

### Redis/Memcached para marcar "dirty patients"

Adiciona dependência de infraestrutura. Postgres via `agente_execucoes` (Fase 1)
ou triggers nativos (Fase 2) resolvem o problema sem nova infra.

## Consequências

- **Fase 1:** `agente_execucoes` passa a ter um índice extra (custo de write
  marginal). O check de dedup Python em `base.py` vira camada de defesa dupla,
  não a única camada.
- **Fase 2:** schema com triggers implica que novos agentes precisam conhecer
  `pacientes_ultima_atividade` ao escrever `_listar_candidatos`. Documentar em
  `python-ai-services` skill.
- Ambas as fases: nenhum dado clínico muda, nenhuma tabela de auditoria afetada,
  `dedup_window_hours` inalterada, `SHADOW_MODE` gate inalterado.

## Gatilho de implementação

- **Fase 1:** candidatos quando `COUNT(pacientes) > 200` e `risco_silencioso`
  virar gargalo mensurável no `docker stats` (CPU/DB). Implementação: ~30 linhas
  em 2 arquivos.
- **Fase 2:** quando Fase 1 não for suficiente (scale > 5.000 pacientes), ou
  quando `adesao` se tornar gargalo separado pela diversidade de prescrições.
