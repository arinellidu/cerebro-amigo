-- =============================================================================
-- 0010 — Estrutura de admin master: assinaturas manuais + upgrade de role
-- =============================================================================
--
-- 1. `role='owner'` para o dono da plataforma (admin master #1).
--    O seed criou o primeiro usuario com role='admin'. Promovemos para 'owner'
--    qualquer usuario com role='admin' que tenha um registro em medicos
--    (i.e. o proprio dono que se cadastrou via seed).
--    Apos isso, novos admins gerais criados pelo owner terao role='admin'.
--
-- 2. Tabelas de billing manual (pre-integração Stripe):
--    assinaturas   — plano/valor por medico (MRR base de calculo)
--    pagamentos_manuais — registro de cada pagamento confirmado manualmente
--
-- Idempotente: IF NOT EXISTS / ON CONFLICT DO NOTHING onde aplicavel.
-- =============================================================================

-- Promove primeiro admin (com medico) para owner
UPDATE usuarios
   SET role = 'owner'
 WHERE role = 'admin'
   AND id IN (SELECT usuario_id FROM medicos)
   AND id = (
       -- o mais antigo (primeiro a se registrar)
       SELECT u2.id
         FROM usuarios u2
         JOIN medicos m2 ON m2.usuario_id = u2.id
        WHERE u2.role = 'admin'
        ORDER BY m2.id ASC
        LIMIT 1
   );

-- Assinaturas: plano por medico (manual, pre-Stripe)
CREATE TABLE IF NOT EXISTS assinaturas (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    medico_id       UUID NOT NULL REFERENCES medicos(id),
    plano           TEXT NOT NULL DEFAULT 'trial',  -- trial | starter | pro | enterprise
    valor_mensal    NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    moeda           TEXT NOT NULL DEFAULT 'BRL',
    status          TEXT NOT NULL DEFAULT 'trial',  -- trial | ativa | suspensa | cancelada
    trial_ate       TIMESTAMPTZ,
    inicio_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    cancelado_em    TIMESTAMPTZ,
    notas           TEXT,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (medico_id)  -- um plano ativo por medico
);
CREATE INDEX IF NOT EXISTS assinaturas_medico_idx ON assinaturas(medico_id);
CREATE INDEX IF NOT EXISTS assinaturas_status_idx ON assinaturas(status);

-- Pagamentos manuais (confirmados pelo owner ate integracao Stripe)
CREATE TABLE IF NOT EXISTS pagamentos_manuais (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assinatura_id   UUID NOT NULL REFERENCES assinaturas(id),
    valor           NUMERIC(10, 2) NOT NULL,
    moeda           TEXT NOT NULL DEFAULT 'BRL',
    referencia      TEXT,         -- ex.: "2026-06" (mes de referencia)
    status          TEXT NOT NULL DEFAULT 'confirmado',  -- pendente | confirmado | estornado
    metodo          TEXT,         -- pix | transferencia | cartao | outro
    pago_em         TIMESTAMPTZ,
    notas           TEXT,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS pagamentos_assinatura_idx ON pagamentos_manuais(assinatura_id);
CREATE INDEX IF NOT EXISTS pagamentos_pago_em_idx ON pagamentos_manuais(pago_em);

COMMENT ON TABLE assinaturas IS 'Planos de assinatura por medico. Pre-Stripe: gerenciado manualmente pelo admin.';
COMMENT ON TABLE pagamentos_manuais IS 'Pagamentos confirmados manualmente. Sera substituido por webhooks Stripe.';
