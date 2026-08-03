-- =============================================================================
-- 0047: medicações EM USO (reconciliação medicamentosa) — ADR-062
--
-- Registro do que o paciente JÁ toma, de QUALQUER prescritor (outro médico, OTC,
-- automedicação). NÃO é receita: prescrição legal segue só pelo MEMED (ADR-024/056,
-- assinatura ICP-Brasil). Aqui é REGISTRO clínico que o médico anota — a IA não
-- preenche nem sugere (clinical-safety #1). Fecha um buraco real: a checagem de
-- interações A5 (ADR-032/057) hoje só vê prescrições da plataforma; com isto passa a
-- ver também o que o paciente toma por fora.
--
-- Aditivo + idempotente. RLS por tenant (ADR-042, mesmo padrão da 0037).
-- =============================================================================

CREATE TABLE IF NOT EXISTS medicacoes_em_uso (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    paciente_id   UUID NOT NULL REFERENCES clientes(id),
    medico_id     UUID REFERENCES medicos(id),   -- médico que registrou
    medicamento   TEXT NOT NULL,                  -- nome (do catálogo OU texto livre)
    generico      TEXT,                           -- token canônico, se veio do dicionário A5
    classe        TEXT,                           -- classe terapêutica (do dicionário), p/ exibir
    posologia     TEXT,                           -- texto livre (ex.: "50mg 1x/dia") — médico digita
    fonte         TEXT,                           -- ex.: "outro psiquiatra", "clínico", "automedicação"
    observacoes   TEXT,
    ativa         BOOL NOT NULL DEFAULT TRUE,
    criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS medicacoes_em_uso_paciente_idx
    ON medicacoes_em_uso (paciente_id) WHERE ativa;

-- RLS: só o médico dono (via pacientes) ou bypass admin. Sem acesso do portal-paciente
-- (reconciliação é doctor-facing). Sem GUC → zero linhas (fail-closed).
ALTER TABLE medicacoes_em_uso ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_iso ON medicacoes_em_uso;
CREATE POLICY tenant_iso ON medicacoes_em_uso FOR ALL
    USING (
        current_setting('app.tenant_bypass', true) = 'on'
        OR EXISTS (
            SELECT 1 FROM pacientes p
            WHERE p.cliente_id = medicacoes_em_uso.paciente_id
              AND p.medico_responsavel_id = NULLIF(current_setting('app.current_medico', true), '')::uuid
        )
    )
    WITH CHECK (
        current_setting('app.tenant_bypass', true) = 'on'
        OR EXISTS (
            SELECT 1 FROM pacientes p
            WHERE p.cliente_id = medicacoes_em_uso.paciente_id
              AND p.medico_responsavel_id = NULLIF(current_setting('app.current_medico', true), '')::uuid
        )
    );

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cerebro_gateway') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON medicacoes_em_uso TO cerebro_gateway;
    END IF;
END
$$;

-- ── Semeia o catálogo `medicamentos` (hoje vazio) a partir do dicionário A5 curado
-- (~50 fármacos psiquiátricos, seed da 0029). Projeta SÓ fatos objetivos: nome genérico
-- + classe terapêutica. `dosagens`/`formas`/`indicacoes_resumo`/`registro_anvisa` ficam
-- vazios → pendentes de revisão clínica (Adonai), pois clinical-safety #1 proíbe a IA
-- inventar dado clínico. Idempotente (não duplica por nome_generico).
INSERT INTO medicamentos (nome_generico, classe_terapeutica, dosagens, formas_farmaceuticas, em_destaque, ativo)
SELECT d.generico, d.classe, '{}', '{}', TRUE, TRUE
FROM medicamento_dicionario d
WHERE d.ativo = TRUE
  AND NOT EXISTS (
      SELECT 1 FROM medicamentos m WHERE lower(m.nome_generico) = lower(d.generico)
  );
