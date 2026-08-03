-- Migration 0030: monetização do médico (ADR-033).
-- Fluxo B: o MÉDICO cobra o PACIENTE pela consulta particular no portal, via
-- Asaas (Pix/boleto/cartão). O dinheiro liquida na SUBCONTA do médico (white-label)
-- e a plataforma fica com um split (taxa). NFS-e é emitida pela subconta do médico.
-- A IA não toca em cobrança — é transacional puro (gateway .NET + Asaas).
-- Aplicar: psql $POSTGRES_DSN_URL -f infra/migrations/0030_monetizacao.sql

-- Valor da consulta particular (base p/ cobrança). Opcional.
ALTER TABLE consultas ADD COLUMN IF NOT EXISTS valor NUMERIC(10,2);

-- Vínculo do médico com a subconta Asaas (white-label / marketplace).
-- Guardamos só identificadores (subconta + wallet p/ split) — NUNCA a API key
-- da subconta (cobramos pela conta-mãe + split no walletId).
CREATE TABLE IF NOT EXISTS medico_asaas_config (
    medico_id          UUID PRIMARY KEY REFERENCES medicos(id) ON DELETE CASCADE,
    asaas_subconta_id  TEXT,
    asaas_wallet_id    TEXT,                  -- destino do split (líquido do médico)
    split_percentual   NUMERIC(5,2) NOT NULL DEFAULT 0,  -- taxa da plataforma (%)
    onboarding_status  TEXT NOT NULL DEFAULT 'pendente', -- pendente|ativo
    criado_em          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Cobranças do médico ao paciente (Fluxo B).
CREATE TABLE IF NOT EXISTS cobrancas (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    medico_id          UUID NOT NULL REFERENCES medicos(id),
    paciente_id        UUID NOT NULL REFERENCES clientes(id),
    consulta_id        UUID REFERENCES consultas(id) ON DELETE SET NULL,

    descricao          TEXT NOT NULL,
    valor              NUMERIC(10,2) NOT NULL CHECK (valor > 0),
    metodo             TEXT NOT NULL DEFAULT 'pix',   -- pix|boleto|cartao
    status             TEXT NOT NULL DEFAULT 'pendente', -- pendente|pago|vencido|cancelado|estornado

    -- Espelho do Asaas (a cobrança LEGAL vive no Asaas).
    asaas_cobranca_id  TEXT,
    asaas_invoice_url  TEXT,            -- link de pagamento (fatura)
    pix_copia_cola     TEXT,           -- payload Pix copia-e-cola
    pix_qr_base64      TEXT,           -- QR em base64 (encodedImage)

    vencimento         DATE,
    pago_em            TIMESTAMPTZ,

    -- NFS-e (emitida pela subconta do médico via Asaas).
    nfse_status        TEXT NOT NULL DEFAULT 'nao_emitida', -- nao_emitida|solicitada|emitida
    nfse_url           TEXT,

    criado_em          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cobrancas_medico_idx   ON cobrancas(medico_id, status, criado_em DESC);
CREATE INDEX IF NOT EXISTS cobrancas_paciente_idx ON cobrancas(paciente_id, status, criado_em DESC);
CREATE UNIQUE INDEX IF NOT EXISTS cobrancas_asaas_idx ON cobrancas(asaas_cobranca_id) WHERE asaas_cobranca_id IS NOT NULL;
