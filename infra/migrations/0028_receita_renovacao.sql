-- Migration 0028: renovação de receita de controle especial (A4, ADR-032).
-- Receituário controlado no Brasil tem validade legal curta (~30 dias). Este é
-- um motor DETERMINÍSTICO (sem LLM): a partir das prescrições ativas com
-- `receita_validade` preenchida, gera uma fila de renovação e notifica o médico
-- ANTES do vencimento, evitando ruptura de tratamento. A reemissão legal é sempre
-- do médico (via MEMED). A IA não decide renovar nem ajusta nada.
-- Aplicar: psql $POSTGRES_DSN_URL -f infra/migrations/0028_receita_renovacao.sql

CREATE TABLE IF NOT EXISTS receita_renovacoes (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    paciente_id      UUID NOT NULL REFERENCES clientes(id),
    medico_id        UUID REFERENCES medicos(id),
    prescricao_id    UUID NOT NULL REFERENCES prescricoes(id) ON DELETE CASCADE,

    medicamento      TEXT NOT NULL,       -- espelho factual (auditoria/exibição)
    receita_tipo     TEXT,                -- tipo de receituário, se informado
    vence_em         DATE NOT NULL,       -- cópia de prescricoes.receita_validade
    protocolo_versao TEXT NOT NULL,       -- versão da regra (antecedência) p/ auditoria

    status           TEXT NOT NULL DEFAULT 'pendente',  -- pendente|renovada|dispensada
    notificado_em    TIMESTAMPTZ,         -- dedup do alerta ao médico
    resolvido_em     TIMESTAMPTZ,
    resolvido_por    UUID REFERENCES medicos(id),

    criado_em        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fila do médico: pendentes ordenadas por vencimento.
CREATE INDEX IF NOT EXISTS receita_renovacoes_medico_idx
    ON receita_renovacoes(medico_id, status, vence_em);

-- Dedup: no máximo 1 renovação pendente por (prescrição, vencimento). O gerador
-- usa ON CONFLICT DO NOTHING — se a validade da receita mudar (renovada), uma
-- nova linha com novo vence_em é criada.
CREATE UNIQUE INDEX IF NOT EXISTS receita_renovacoes_pendente_unico_idx
    ON receita_renovacoes(prescricao_id, vence_em)
    WHERE status = 'pendente';
