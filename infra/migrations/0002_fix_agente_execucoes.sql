-- =============================================================================
-- 0002: align agente_execucoes com o código agents-py
-- Adiciona colunas que o código usa mas que não estavam no schema inicial.
-- Idempotente: usa ADD COLUMN IF NOT EXISTS.
-- =============================================================================

ALTER TABLE agente_execucoes
  ADD COLUMN IF NOT EXISTS iniciado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS concluido_em  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sucesso       BOOL,
  ADD COLUMN IF NOT EXISTS erro          TEXT,
  ADD COLUMN IF NOT EXISTS metadata      JSONB;

-- Remove colunas antigas que o código não usa (safe — nunca foram populadas)
ALTER TABLE agente_execucoes
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS resultado,
  DROP COLUMN IF EXISTS criado_em;

-- Recria índice com coluna correta
DROP INDEX IF EXISTS agente_execucoes_paciente_idx;
CREATE INDEX IF NOT EXISTS agente_execucoes_paciente_idx
    ON agente_execucoes(paciente_id, iniciado_em);
CREATE INDEX IF NOT EXISTS agente_execucoes_agente_sucesso_idx
    ON agente_execucoes(agente, sucesso, iniciado_em);
