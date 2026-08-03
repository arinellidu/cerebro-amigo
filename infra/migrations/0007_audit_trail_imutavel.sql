-- =============================================================================
-- 0007 — Imutabilidade do audit trail (defesa em profundidade no banco)
-- =============================================================================
--
-- Regra clínica inegociável (CLAUDE.md / CONTEXT.md / ADR-005 / ADR-006):
-- as trilhas de auditoria são append-only. Até aqui isso dependia só de
-- disciplina no código de aplicação. Esta migration move a garantia para o
-- BANCO: nenhum bug, migration futura distraída ou acesso direto consegue
-- apagar ou adulterar uma trilha.
--
-- Política por tabela:
--   protocolos_crise_acionados  -> totalmente imutável (só INSERT).
--   notificacoes_medico         -> DELETE proibido; UPDATE só em lida/lida_em
--                                  (marcar lida/não-lida é estado legítimo).
--   agente_execucoes            -> DELETE proibido; UPDATE só nas colunas de
--                                  ciclo de vida do job; identidade e metadata
--                                  são imutáveis.
--
-- Implementação: triggers BEFORE que comparam to_jsonb(OLD/NEW) MENOS as
-- chaves mutáveis. Remover uma chave inexistente de jsonb é no-op, então a
-- política é robusta a colunas adicionadas por migrations futuras.
--
-- Verificação local (Postgres efêmero, sem tocar produção):
--   ver infra/migrations/tests/test_audit_imutavel.sh
-- =============================================================================

-- ─── protocolos_crise_acionados: append-only total ──────────────────────────
CREATE OR REPLACE FUNCTION audit_protocolos_crise_imutavel()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION
        'protocolos_crise_acionados e append-only: % proibido (audit trail imutavel, ADR-005/006)',
        TG_OP
        USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS protocolos_crise_imutavel ON protocolos_crise_acionados;
CREATE TRIGGER protocolos_crise_imutavel
    BEFORE UPDATE OR DELETE ON protocolos_crise_acionados
    FOR EACH ROW EXECUTE FUNCTION audit_protocolos_crise_imutavel();


-- ─── notificacoes_medico: DELETE proibido; UPDATE só lida/lida_em ────────────
CREATE OR REPLACE FUNCTION audit_notificacoes_medico_guard()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION
            'notificacoes_medico e append-only: DELETE proibido (audit trail)'
            USING ERRCODE = 'check_violation';
    END IF;

    -- UPDATE: apenas os flags de leitura podem mudar; o conteudo e imutavel.
    IF (to_jsonb(NEW) - 'lida' - 'lida_em')
       IS DISTINCT FROM
       (to_jsonb(OLD) - 'lida' - 'lida_em') THEN
        RAISE EXCEPTION
            'notificacoes_medico: apenas lida/lida_em sao mutaveis; conteudo e append-only'
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS notificacoes_medico_guard ON notificacoes_medico;
CREATE TRIGGER notificacoes_medico_guard
    BEFORE UPDATE OR DELETE ON notificacoes_medico
    FOR EACH ROW EXECUTE FUNCTION audit_notificacoes_medico_guard();


-- ─── agente_execucoes: DELETE proibido; UPDATE só no ciclo de vida do job ────
CREATE OR REPLACE FUNCTION audit_agente_execucoes_guard()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION
            'agente_execucoes e append-only: DELETE proibido (audit trail)'
            USING ERRCODE = 'check_violation';
    END IF;

    -- Colunas mutaveis = resultado da execucao (preenchidas em _finalize_execution).
    -- Tudo o mais (id, paciente_id, agente, iniciado_em, metadata) e imutavel.
    IF (to_jsonb(NEW)
            - 'concluido_em' - 'sucesso' - 'erro' - 'insight_id'
            - 'tokens_in' - 'tokens_out' - 'custo_usd' - 'modelo')
       IS DISTINCT FROM
       (to_jsonb(OLD)
            - 'concluido_em' - 'sucesso' - 'erro' - 'insight_id'
            - 'tokens_in' - 'tokens_out' - 'custo_usd' - 'modelo') THEN
        RAISE EXCEPTION
            'agente_execucoes: apenas colunas de resultado da execucao sao mutaveis; identidade e metadata sao imutaveis'
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS agente_execucoes_guard ON agente_execucoes;
CREATE TRIGGER agente_execucoes_guard
    BEFORE UPDATE OR DELETE ON agente_execucoes
    FOR EACH ROW EXECUTE FUNCTION audit_agente_execucoes_guard();
