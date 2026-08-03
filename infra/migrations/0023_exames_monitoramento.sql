-- Migration 0023: monitoramento de exames laboratoriais e segurança farmacológica
-- (S2, ADR-029). Scheduler DETERMINÍSTICO a partir das prescrições ativas: o
-- protocolo (qual exame, cadência, faixa de referência) vive em código versionado
-- no agents-py — NUNCA em LLM. A faixa é copiada para a linha do exame no momento
-- do agendamento (dado factual, auditável); a decisão clínica é sempre do médico.
-- Aplicar: psql $POSTGRES_DSN_URL -f infra/migrations/0023_exames_monitoramento.sql

CREATE TABLE IF NOT EXISTS exames_agenda (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    paciente_id      UUID NOT NULL REFERENCES clientes(id),
    medico_id        UUID REFERENCES medicos(id),
    prescricao_id    UUID REFERENCES prescricoes(id) ON DELETE SET NULL,

    tipo_exame       TEXT NOT NULL,  -- litemia|hemograma|funcao_hepatica|perfil_metabolico|peso|ecg_qt
    motivo           TEXT NOT NULL,  -- medicamento/classe que disparou (ex.: 'lítio')
    protocolo_versao TEXT NOT NULL,  -- versão do catálogo de protocolo (auditoria)

    devido_em        DATE NOT NULL,  -- quando o exame deveria ser feito
    periodicidade_dias INT,          -- base p/ reagendar o próximo ciclo

    -- Faixa de referência factual (copiada do protocolo no agendamento).
    ref_label        TEXT,           -- ex.: 'Nível sérico de lítio'
    ref_unidade      TEXT,           -- ex.: 'mEq/L'
    ref_min          NUMERIC,
    ref_max          NUMERIC,

    -- Resultado (registrado pelo médico).
    status           TEXT NOT NULL DEFAULT 'agendado',  -- agendado|realizado|cancelado
    resultado_valor  NUMERIC,
    resultado_em     DATE,
    fora_faixa       BOOLEAN,        -- valor < ref_min OU > ref_max (comparação factual)
    registrado_por   UUID REFERENCES medicos(id),
    notas            TEXT,

    -- Dedup do alerta de atraso ao médico.
    alerta_atraso_em TIMESTAMPTZ,

    criado_em        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS exames_agenda_paciente_idx ON exames_agenda(paciente_id, devido_em);
CREATE INDEX IF NOT EXISTS exames_agenda_devido_idx
    ON exames_agenda(devido_em) WHERE status = 'agendado';

-- Dedup do agendamento: no máximo 1 exame pendente por (paciente, tipo, prescrição).
-- O gerador sempre seta prescricao_id, então NULLs não geram duplicação.
CREATE UNIQUE INDEX IF NOT EXISTS exames_agenda_pendente_unico_idx
    ON exames_agenda(paciente_id, tipo_exame, prescricao_id)
    WHERE status = 'agendado';
