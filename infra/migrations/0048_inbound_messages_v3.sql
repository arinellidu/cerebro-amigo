-- =============================================================================
-- 0048: reestrutura inbound_messages para o schema V3
--
-- A tabela V2 tinha: id, canal, payload, processado, recebido_em
-- O orchestrator-py V3 espera: idempotency_key (UNIQUE), cliente_id, canal,
-- status, criada_em, completada_em  — usados para dedup e rastreio SSE.
--
-- Estratégia: adiciona colunas novas + índice único; preserva colunas V2
-- (payload/processado) como nullable para rollback sem perda de dados.
-- Idempotente.
-- =============================================================================

ALTER TABLE inbound_messages
    ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
    ADD COLUMN IF NOT EXISTS cliente_id      UUID REFERENCES clientes(id),
    ADD COLUMN IF NOT EXISTS status          TEXT NOT NULL DEFAULT 'completed',
    ADD COLUMN IF NOT EXISTS criada_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS completada_em   TIMESTAMPTZ;

-- UNIQUE em idempotency_key (alvo do ON CONFLICT no orchestrator)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE tablename = 'inbound_messages'
          AND indexname  = 'inbound_messages_idempotency_key_key'
    ) THEN
        CREATE UNIQUE INDEX inbound_messages_idempotency_key_key
            ON inbound_messages (idempotency_key)
            WHERE idempotency_key IS NOT NULL;
    END IF;
END
$$;

-- RLS: leituras do orchestrator (cerebro_workers, BYPASSRLS) não precisam de
-- policy, mas garantir GRANT para caso de auditoria via gateway no futuro.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cerebro_gateway') THEN
        GRANT SELECT ON inbound_messages TO cerebro_gateway;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cerebro_workers') THEN
        GRANT SELECT, INSERT, UPDATE ON inbound_messages TO cerebro_workers;
    END IF;
END
$$;
