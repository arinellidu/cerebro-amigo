-- =============================================================================
-- 0013: rastreio de entrega de notificações ao médico fora do app.
--
-- notificacoes_medico é imutável (0007: só lida/lida_em mutáveis). O rastreio de
-- entrega por canal (email/push) vive em tabela SEPARADA para não violar a
-- imutabilidade. O índice único impede entrega duplicada por canal.
-- =============================================================================

CREATE TABLE notificacao_entregas (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    notificacao_id  UUID NOT NULL REFERENCES notificacoes_medico(id),
    canal           TEXT NOT NULL,   -- email | push
    status          TEXT NOT NULL,   -- enviado | falhou
    detalhe         TEXT,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX notificacao_entregas_unica_idx
    ON notificacao_entregas(notificacao_id, canal) WHERE status = 'enviado';
CREATE INDEX notificacao_entregas_notif_idx ON notificacao_entregas(notificacao_id);
