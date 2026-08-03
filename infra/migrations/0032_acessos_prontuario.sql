-- Migration 0032: trilha de acesso a dados sensíveis (LGPD art. 37, ADR-038).
-- Registro append-only de "quem-viu-qual-paciente": cada leitura de dado clínico
-- de paciente pelo médico (timeline, humor, adesão, resumo, exames) grava uma
-- linha. Só METADADOS — nunca conteúdo clínico. Mesma imutabilidade do 0007.
-- Aplicar: psql $POSTGRES_DSN_URL -f infra/migrations/0032_acessos_prontuario.sql

CREATE TABLE IF NOT EXISTS acessos_prontuario (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    medico_id    UUID NOT NULL REFERENCES medicos(id),
    paciente_id  UUID NOT NULL REFERENCES clientes(id),
    recurso      TEXT NOT NULL,   -- timeline | humor | adesao | resumo_pre_consulta | exames
    motivo       TEXT,            -- opcional (ex.: justificativa de acesso)
    criado_em    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS acessos_prontuario_medico_idx
    ON acessos_prontuario(medico_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS acessos_prontuario_paciente_idx
    ON acessos_prontuario(paciente_id, criado_em DESC);

-- Append-only: UPDATE/DELETE proibidos (igual à trilha de auditoria do 0007).
CREATE OR REPLACE FUNCTION acessos_prontuario_imutavel()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION
        'acessos_prontuario e append-only: % proibido (LGPD art.37, ADR-038)',
        TG_OP
        USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS acessos_prontuario_imutavel ON acessos_prontuario;
CREATE TRIGGER acessos_prontuario_imutavel
    BEFORE UPDATE OR DELETE ON acessos_prontuario
    FOR EACH ROW EXECUTE FUNCTION acessos_prontuario_imutavel();
