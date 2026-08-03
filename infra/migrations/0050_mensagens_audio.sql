-- ADR-064: mensagens de áudio do paciente para o médico.
-- Retenção 60 dias (S3 lifecycle + expira_em). Consentimento explícito obrigatório.

-- Consentimento do paciente para enviar áudio
ALTER TABLE pacientes
    ADD COLUMN IF NOT EXISTS consentimento_audio BOOLEAN NOT NULL DEFAULT FALSE;

-- Tabela de mensagens de áudio
CREATE TABLE mensagens_audio (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    paciente_id  UUID        NOT NULL REFERENCES clientes(id),
    medico_id    UUID        NOT NULL REFERENCES medicos(id),
    s3_key       TEXT        NOT NULL,
    duracao_s    INTEGER,                        -- duração em segundos (preenchida no upload)
    ouvido_em    TIMESTAMPTZ,                    -- NULL = não ouvido ainda
    criada_em    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expira_em    TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '60 days'
);

CREATE INDEX idx_mensagens_audio_medico    ON mensagens_audio(medico_id, ouvido_em NULLS FIRST, criada_em DESC);
CREATE INDEX idx_mensagens_audio_paciente  ON mensagens_audio(paciente_id, criada_em DESC);

-- RLS: mesmo padrão de notificacoes_medico (medico_id direto, sem dimensão paciente)
ALTER TABLE mensagens_audio ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_iso ON mensagens_audio;
CREATE POLICY tenant_iso ON mensagens_audio FOR ALL
    USING (
        current_setting('app.tenant_bypass', true) = 'on'
        OR medico_id = NULLIF(current_setting('app.current_medico', true), '')::uuid
    )
    WITH CHECK (
        current_setting('app.tenant_bypass', true) = 'on'
        OR medico_id = NULLIF(current_setting('app.current_medico', true), '')::uuid
    );

GRANT SELECT, INSERT, UPDATE ON mensagens_audio TO cerebro_gateway;
GRANT ALL ON mensagens_audio TO cerebro_workers;
