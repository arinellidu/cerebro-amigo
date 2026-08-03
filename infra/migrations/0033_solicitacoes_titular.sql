-- Migration 0033: registro de solicitações de direitos do titular (LGPD, ADR-039).
-- Workflow do DPO para acesso/portabilidade/eliminação/oposição/correção. NÃO
-- executa a operação — só registra e acompanha o status. DELETE bloqueado
-- (registro de conformidade); UPDATE de status é permitido.
-- Aplicar: psql $POSTGRES_DSN_URL -f infra/migrations/0033_solicitacoes_titular.sql

CREATE TABLE IF NOT EXISTS solicitacoes_titular (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    identificacao TEXT NOT NULL,                 -- email/nome informado pelo titular
    paciente_id   UUID REFERENCES clientes(id),  -- vínculo opcional (se identificado)
    tipo          TEXT NOT NULL,   -- acesso | portabilidade | eliminacao | oposicao_ia | correcao
    status        TEXT NOT NULL DEFAULT 'aberta', -- aberta | atendida | recusada
    notas         TEXT,
    criado_por    UUID REFERENCES usuarios(id),
    atendido_por  UUID REFERENCES usuarios(id),
    atendido_em   TIMESTAMPTZ,
    criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS solicitacoes_titular_status_idx
    ON solicitacoes_titular(status, criado_em DESC);

-- O registro da solicitação é evidência de conformidade: DELETE proibido.
-- (UPDATE permitido — o status evolui aberta → atendida/recusada.)
CREATE OR REPLACE FUNCTION solicitacoes_titular_no_delete()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION
        'solicitacoes_titular: DELETE proibido (registro de conformidade LGPD, ADR-039)'
        USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS solicitacoes_titular_no_delete ON solicitacoes_titular;
CREATE TRIGGER solicitacoes_titular_no_delete
    BEFORE DELETE ON solicitacoes_titular
    FOR EACH ROW EXECUTE FUNCTION solicitacoes_titular_no_delete();
