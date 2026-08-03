-- =============================================================================
-- 0003: adiciona automacao_pausada em pacientes (defesa em camadas — ADR-005)
-- O orchestrator-py pausa a automação ao acionar protocolo de crise.
-- Idempotente: ADD COLUMN IF NOT EXISTS.
-- =============================================================================

ALTER TABLE pacientes
  ADD COLUMN IF NOT EXISTS automacao_pausada BOOL NOT NULL DEFAULT FALSE;
