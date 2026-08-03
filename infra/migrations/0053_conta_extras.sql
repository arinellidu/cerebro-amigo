-- =============================================================================
-- 0053: Portal do Psiquiatra — extras de conta (ADR-066, Fase 4)
--
--  - medico_invite_tokens.proposito: reaproveita a tabela de tokens (já usada
--    pelo /ativar-conta) também para RESET de senha. 'ativacao' (default, mantém
--    comportamento atual) | 'reset' (esqueci/redefinir senha).
--  - medicos.exclusao_solicitada_em: marca pedido de exclusão LGPD (soft, sem
--    apagar nada — admin processa; trilhas imutáveis preservadas, Regra 5).
--
-- Aditivo + idempotente. (foto_s3_key já entrou na 0052.)
-- =============================================================================

ALTER TABLE medico_invite_tokens
    ADD COLUMN IF NOT EXISTS proposito TEXT NOT NULL DEFAULT 'ativacao';

ALTER TABLE medicos
    ADD COLUMN IF NOT EXISTS exclusao_solicitada_em TIMESTAMPTZ;
