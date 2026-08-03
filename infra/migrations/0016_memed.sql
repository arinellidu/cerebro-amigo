-- =============================================================================
-- 0016: integração MEMED (prescrição digital).
--
-- O MEMED exige CRM separado em número + UF (board_number + board_state) e o
-- CPF do médico (assinatura). O campo `crm` legado é texto livre; adicionamos
-- crm_uf e cpf explícitos. `memed_usuario_id` guarda o id do prescritor no MEMED
-- para reobter o token (não-estático) sem recriar.
--
-- `receitas_memed` liga a receita emitida no MEMED ao paciente (timeline/auditoria
-- + espelho). A receita LEGAL vive no MEMED; `prescricoes` recebe um espelho dos
-- medicamentos só para o motor de lembretes/adesão. A IA não toca em nada disto.
-- =============================================================================

ALTER TABLE medicos
  ADD COLUMN IF NOT EXISTS crm_uf           TEXT,
  ADD COLUMN IF NOT EXISTS cpf              TEXT,
  ADD COLUMN IF NOT EXISTS memed_usuario_id TEXT;

CREATE TABLE receitas_memed (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    paciente_id          UUID NOT NULL REFERENCES clientes(id),
    medico_id            UUID NOT NULL REFERENCES medicos(id),
    memed_prescricao_id  TEXT NOT NULL,
    criada_em            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX receitas_memed_prescricao_idx ON receitas_memed(memed_prescricao_id);
CREATE INDEX receitas_memed_paciente_idx ON receitas_memed(paciente_id, criada_em DESC);
