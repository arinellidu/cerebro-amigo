-- =============================================================================
-- 0011: motor de conduta de automação por paciente (override sobre o global).
--
-- O médico configura, por paciente, regras OPERACIONAIS de acompanhamento.
-- clinical-safety: isto é organizacional/administrativo — a IA não decide nada
-- clínico. Os geradores do agents-py leem estas regras; na ausência de conduta
-- ativa, mantêm o default global (medicação por prescricoes.horarios,
-- questionário fixo 2ª/5ª).
--
-- Toda automação proativa dirigida por conduta DEVE respeitar
-- pacientes.automacao_pausada (circuit-breaker de crise) e o gate SHADOW_MODE
-- antes de agir de fato.
-- =============================================================================

CREATE TABLE condutas_automacao (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    paciente_id   UUID NOT NULL REFERENCES clientes(id),
    medico_id     UUID NOT NULL REFERENCES medicos(id),
    tipo          TEXT NOT NULL CHECK (tipo IN (
                      'checkin_humor', 'lembrete_medicacao',
                      'questionario', 'alerta_nao_adesao')),
    config        JSONB NOT NULL DEFAULT '{}',
    ativa         BOOL NOT NULL DEFAULT TRUE,
    criado_por    UUID REFERENCES usuarios(id),
    criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Override único por (paciente, tipo) enquanto ativa.
CREATE UNIQUE INDEX condutas_paciente_tipo_idx
    ON condutas_automacao(paciente_id, tipo) WHERE ativa = TRUE;
CREATE INDEX condutas_medico_idx ON condutas_automacao(medico_id) WHERE ativa = TRUE;

-- Auditoria append-only de mudanças de conduta (quem mudou o quê, quando).
CREATE TABLE condutas_eventos (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conduta_id   UUID NOT NULL REFERENCES condutas_automacao(id),
    paciente_id  UUID NOT NULL REFERENCES clientes(id),
    medico_id    UUID REFERENCES medicos(id),
    acao         TEXT NOT NULL, -- configurada | desativada
    config       JSONB,
    criado_em    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX condutas_eventos_paciente_idx ON condutas_eventos(paciente_id, criado_em);
