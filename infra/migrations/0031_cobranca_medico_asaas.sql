-- Migration 0031: cobrança recorrente da PLATAFORMA ao MÉDICO (Fluxo A, ADR-034).
-- A plataforma cobra o médico pela assinatura do SaaS via Asaas /subscriptions
-- (pix/boleto/cartão, mensal), dinheiro direto na conta da plataforma — SEM split,
-- SEM subconta (≠ Fluxo B). Reaproveita `assinaturas` (plano/valor_mensal) e
-- `pagamentos_manuais` (histórico/MRR). O webhook do Asaas marca status e registra
-- cada pagamento (idempotente por asaas_payment_id).
-- Aplicar: psql $POSTGRES_DSN_URL -f infra/migrations/0031_cobranca_medico_asaas.sql

-- IDs do Asaas na assinatura do médico (customer = médico; subscription = plano).
ALTER TABLE assinaturas        ADD COLUMN IF NOT EXISTS asaas_customer_id     TEXT;
ALTER TABLE assinaturas        ADD COLUMN IF NOT EXISTS asaas_subscription_id TEXT;

-- Espelho do pagamento Asaas no histórico (idempotência do webhook).
-- NULL p/ pagamentos manuais (vários NULLs são permitidos no índice único).
ALTER TABLE pagamentos_manuais ADD COLUMN IF NOT EXISTS asaas_payment_id      TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS pagamentos_asaas_idx
    ON pagamentos_manuais(asaas_payment_id);
