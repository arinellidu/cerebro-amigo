-- =============================================================================
-- 0035 — Entrega garantida do alerta de crise ao médico (ADR-041, Fase 1)
-- =============================================================================
--
-- Problema (ver ADR-041): ao acionar o protocolo de crise, o aviso ao médico
-- dependia de UM e-mail, com gate de opt-in default-FALSE e sem confirmação.
-- Resend fora, opt-in desligado ou médico distraído = paciente em crise sem
-- cobertura real, em SILÊNCIO. Isso fere a regra clínica "médico no loop".
--
-- Esta tabela é a trilha forense de ENTREGA + CONFIRMAÇÃO do alerta: cada
-- tentativa de cada canal e o ack do médico viram uma linha. O estado
-- (entregue? confirmado? em qual estágio da escada?) é DERIVADO por query —
-- não há UPDATE. O watchdog (notifier-py) escala enquanto não houver
-- evento 'confirmado' para o protocolo.
--
-- NÃO contém detalhe clínico (LGPD): `detalhe` carrega só código/status de
-- canal (ex.: "http_502", "sem_email"). Nunca o conteúdo da conversa.
--
-- Append-only por defesa em profundidade (mesmo padrão do 0007): a trilha de
-- um evento de segurança não pode ser adulterada nem apagada.
-- =============================================================================

CREATE TABLE crise_alerta_eventos (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- O protocolo de crise é a fonte da verdade do evento.
    protocolo_id  UUID NOT NULL REFERENCES protocolos_crise_acionados(id),
    -- Médico-alvo, derivado de pacientes.medico_responsavel_id (tenant).
    medico_id     UUID REFERENCES medicos(id),
    -- Canal do alerta. in_app já é gravado no protocolo; os demais são proativos.
    canal         TEXT NOT NULL,   -- in_app | email | push | sms | whatsapp | retaguarda | ops
    -- Ciclo de vida do alerta naquele canal.
    evento        TEXT NOT NULL,   -- enfileirado | enviado | falhou | confirmado
    -- Estágio da escada de escalonamento (0 = imediato; cresce sem ack).
    estagio       SMALLINT NOT NULL DEFAULT 0,
    -- Diagnóstico de canal — SEM PII clínica.
    detalhe       TEXT,
    criada_em     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Varredura do watchdog: eventos por protocolo em ordem cronológica.
CREATE INDEX crise_alerta_eventos_protocolo_idx
    ON crise_alerta_eventos(protocolo_id, criada_em);

-- Atalho para "este protocolo já foi confirmado?".
CREATE INDEX crise_alerta_eventos_confirmado_idx
    ON crise_alerta_eventos(protocolo_id) WHERE evento = 'confirmado';

-- ─── Append-only: bloqueia UPDATE/DELETE (defesa em profundidade) ────────────
CREATE OR REPLACE FUNCTION crise_alerta_eventos_imutavel()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION
        'crise_alerta_eventos e append-only: % proibido (trilha de seguranca, ADR-041)',
        TG_OP
        USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS crise_alerta_eventos_imutavel ON crise_alerta_eventos;
CREATE TRIGGER crise_alerta_eventos_imutavel
    BEFORE UPDATE OR DELETE ON crise_alerta_eventos
    FOR EACH ROW EXECUTE FUNCTION crise_alerta_eventos_imutavel();
