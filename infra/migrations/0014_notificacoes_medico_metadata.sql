-- =============================================================================
-- 0014: adiciona metadata JSONB a notificacoes_medico.
--
-- Vários call-sites já inserem metadata — orchestrator-py crisis.py (protocolo
-- de crise) e escalate_to_human (response.py), notifier-py dispatcher — mas a
-- coluna nunca existiu no schema (0001). Esses INSERTs falhavam em runtime:
-- crise/escalada/push NÃO registravam a notificação ao médico. Esta migration
-- alinha o schema ao que o código espera.
--
-- Imutabilidade (0007): o trigger de notificacoes_medico só permite UPDATE de
-- (lida, lida_em). metadata é gravada no INSERT e nunca alterada → compatível.
-- ADD COLUMN IF NOT EXISTS = idempotente.
-- =============================================================================

ALTER TABLE notificacoes_medico
  ADD COLUMN IF NOT EXISTS metadata JSONB;
