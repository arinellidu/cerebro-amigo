-- =============================================================================
-- 0005: alinhar schema ao código dos agentes (agents-py)
--
-- Dois mismatches que quebram TODOS os agentes em runtime:
--
--  1. agente_execucoes — base.py:_finalize_execution grava insight_id, tokens_in,
--     tokens_out, custo_usd e modelo, mas o schema (0001/0002) não tem essas
--     colunas → UndefinedColumnError no finalize de toda execução.
--     agente_execucoes é trilha de AUDITORIA (append-only): só ADICIONAMOS
--     colunas, nunca apagamos/editamos linhas.
--
--  2. sintomas — padroes.py e resumidor.py fazem SELECT de sono_qualidade,
--     apetite e irritabilidade, ausentes no schema (0001) → UndefinedColumnError
--     antes mesmo da chamada ao LLM.
--
-- Aditivo e idempotente: ADD COLUMN IF NOT EXISTS. Não dropa nada.
-- =============================================================================

-- ─── 1. agente_execucoes: colunas de resultado/uso ──────────────────────────
ALTER TABLE agente_execucoes
  ADD COLUMN IF NOT EXISTS insight_id  UUID REFERENCES insights(id),
  ADD COLUMN IF NOT EXISTS tokens_in   INT,
  ADD COLUMN IF NOT EXISTS tokens_out  INT,
  ADD COLUMN IF NOT EXISTS custo_usd   NUMERIC(10, 4),
  ADD COLUMN IF NOT EXISTS modelo      TEXT;

COMMENT ON COLUMN agente_execucoes.insight_id IS 'FK para o insight gerado (NULL se execução falhou antes de gerar).';
COMMENT ON COLUMN agente_execucoes.custo_usd  IS 'Custo estimado da chamada LLM em USD.';

-- ─── 2. sintomas: eixos adicionais lidos por padroes/resumidor ──────────────
-- Mesma escala 1-10 de humor/ansiedade/energia.
ALTER TABLE sintomas
  ADD COLUMN IF NOT EXISTS sono_qualidade  INT,
  ADD COLUMN IF NOT EXISTS apetite         INT,
  ADD COLUMN IF NOT EXISTS irritabilidade  INT;

COMMENT ON COLUMN sintomas.sono_qualidade IS 'Qualidade do sono 1-10 (distinto de sono_horas).';
COMMENT ON COLUMN sintomas.apetite        IS 'Apetite 1-10.';
COMMENT ON COLUMN sintomas.irritabilidade IS 'Irritabilidade 1-10.';
