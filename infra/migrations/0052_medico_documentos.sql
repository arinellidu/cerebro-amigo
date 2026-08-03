-- =============================================================================
-- 0052: Portal do Psiquiatra — cofre de documentos do médico + foto de perfil
--        (ADR-066)
--
-- Cofre BIDIRECIONAL de documentos entre médico e plataforma:
--   - direcao='enviado'         → médico ENVIA p/ a plataforma (contrato assinado,
--                                  comprovante, diploma, RG/CPF) — entra 'pendente'
--                                  de revisão.
--   - direcao='disponibilizado' → plataforma DISPONIBILIZA p/ o médico (contrato,
--                                  NFS-e, recibo) — admin sobe via tenant_bypass.
--
-- Binário NUNCA passa pelo gateway: upload/download por S3 presigned (mesmo padrão
-- de mensagens_audio, ADR-064/migration 0050), bucket privado S3_BUCKET_MEDICO_DOCS.
-- Sem lifecycle de expiração (docs legais/fiscais — retenção longa, ≠ áudio 60d).
--
-- LGPD: tabela guarda só METADADO (tipo, título, s3_key, status). Conteúdo do doc
-- vive cifrado-em-repouso no S3 (SSE). Sem PII clínica de paciente aqui.
--
-- Aditivo + idempotente. RLS por tenant (ADR-042) — tabela medico-owned direta
-- (medico_id), policy mais simples que a 0047 (sem join por pacientes).
-- =============================================================================

CREATE TABLE IF NOT EXISTS medico_documentos (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    medico_id     UUID NOT NULL REFERENCES medicos(id),
    direcao       TEXT NOT NULL,                  -- 'enviado' | 'disponibilizado'
    tipo          TEXT NOT NULL,                  -- 'contrato','comprovante','diploma','rg_cpf','nfse','recibo','outro'
    titulo        TEXT NOT NULL,
    s3_key        TEXT NOT NULL,
    content_type  TEXT,
    tamanho_bytes BIGINT,
    -- enviado: 'pendente'→'aprovado'/'rejeitado' (revisão admin)
    -- disponibilizado: 'disponivel'
    status        TEXT NOT NULL DEFAULT 'pendente',
    enviado_por   TEXT NOT NULL DEFAULT 'medico', -- 'medico' | 'admin'
    observacoes   TEXT,                           -- nota do revisor (ex.: motivo da rejeição)
    criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS medico_documentos_medico_idx
    ON medico_documentos (medico_id, criado_em DESC);

-- RLS: o médico vê/gerencia só os SEUS documentos (ambas direções); admin opera
-- via app.tenant_bypass='on' (mesmo mecanismo de owner/admin). Sem GUC → 0 linhas
-- (fail-closed). Portal-paciente não toca esta tabela (doctor-facing).
ALTER TABLE medico_documentos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_iso ON medico_documentos;
CREATE POLICY tenant_iso ON medico_documentos FOR ALL
    USING (
        current_setting('app.tenant_bypass', true) = 'on'
        OR medico_id = NULLIF(current_setting('app.current_medico', true), '')::uuid
    )
    WITH CHECK (
        current_setting('app.tenant_bypass', true) = 'on'
        OR medico_id = NULLIF(current_setting('app.current_medico', true), '')::uuid
    );

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cerebro_gateway') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON medico_documentos TO cerebro_gateway;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cerebro_workers') THEN
        GRANT ALL ON medico_documentos TO cerebro_workers;
    END IF;
END
$$;

-- ── Foto de perfil do médico (avatar) — S3 presigned no mesmo bucket de docs.
-- Coluna guarda só a key; o binário vive no S3 (SSE). Aparece na sidebar.
-- Nome SEM underscore antes de "key" (foto_s3key) DE PROPÓSITO: a convenção
-- snake_case do EF (UseSnakeCaseNamingConvention) NÃO insere "_" depois de dígito,
-- então a propriedade FotoS3Key vira `foto_s3key` (Foto|S3Key). É o nome que o EF
-- referencia na query do /me; usar foto_s3_key quebra com
-- "column a.foto_s3key does not exist". (Verificado empiricamente, 2026-06-18.)
ALTER TABLE medicos ADD COLUMN IF NOT EXISTS foto_s3key TEXT;
