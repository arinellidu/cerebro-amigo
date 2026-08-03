-- =============================================================================
-- 0049: corrige inbound_messages para o ON CONFLICT do orchestrator V3
--
-- Sintoma: POST /internal/portal/conversation/message → 500
--   asyncpg InvalidColumnReferenceError: "there is no unique or exclusion
--   constraint matching the ON CONFLICT specification"
--   → TODA conversa do paciente falhava (fallback "Não consegui processar agora")
--     e, pior, a detecção de crise NÃO rodava na mensagem (gap silencioso).
--
-- Causas (duas, mesmo erro mascarava a segunda):
--   (1) O índice único criado por 0048 é PARCIAL:
--         ... (idempotency_key) WHERE idempotency_key IS NOT NULL
--       O orchestrator faz `ON CONFLICT (idempotency_key)` SEM o WHERE. Postgres
--       não infere índice único parcial sem repetir o predicado → erro. Troca por
--       índice único NÃO-parcial. NULLs seguem permitidos (NULLS DISTINCT default),
--       então linhas legadas V2 com idempotency_key NULL coexistem.
--   (2) `payload` (coluna legada V2) é NOT NULL sem default e o INSERT V3 não a
--       preenche → estouraria NOT NULL logo após corrigir (1). 0048 pretendia
--       torná-la nullable ("preserva como nullable para rollback") mas não removeu
--       o NOT NULL. Removido aqui.
--
-- Idempotente. Tabela vazia em prod no momento do fix → zero risco de dado.
-- Não toca tabela de auditoria (clinical-safety regra 5, append-only). Restaura o
-- caminho de detecção de crise (regra 2) que estava morto pelo 500.
-- =============================================================================

-- (1) índice único parcial -> não-parcial (inferível pelo ON CONFLICT do orchestrator)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE tablename = 'inbound_messages'
          AND indexname = 'inbound_messages_idempotency_key_key'
          AND indexdef LIKE '%WHERE%'
    ) THEN
        DROP INDEX inbound_messages_idempotency_key_key;
    END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS inbound_messages_idempotency_key_key
    ON inbound_messages (idempotency_key);

-- (2) coluna legada V2 que o fluxo V3 não preenche
ALTER TABLE inbound_messages
    ALTER COLUMN payload DROP NOT NULL;
