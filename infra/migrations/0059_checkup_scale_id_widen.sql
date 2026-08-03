-- Migration 0059: alarga o CHECK de scale_id no schema checkup p/ o set completo do motor ADR-048
--
-- POR QUÊ:
-- A 0039 fixou scale_id IN ('phq9','gad7','asrs18') em DUAS tabelas:
--   - checkup.funnel_events (linha 16, coluna NULLABLE — eventos do lado médico não carregam escala)
--   - checkup.test_results  (linha 27, NOT NULL)
-- Mas o motor de escalas do checkup (ADR-048) já está com 8 escalas LIVE e validadas
-- (phq9, gad7, asrs18, audit, mdq, fagerstrom, msi_bpd, assist). O quiz (QuizFlow/AssistFlow)
-- e o consentimento (ResultadoClient) emitem scale_id para QUALQUER uma das 8 nas rotas
-- /api/events e /api/result. As 5 novas (audit, mdq, fagerstrom, msi_bpd, assist) violam o
-- CHECK antigo, o Postgres rejeita o INSERT, e como as duas rotas engolem o erro
-- (console.error + return ok:true), os funnel_events E os test_results consentidos dessas
-- escalas são SILENCIOSAMENTE DESCARTADOS em produção hoje.
--
-- Esta migration alarga AMBOS os CHECK para a lista autoritativa completa do ADR-048,
-- mantendo NULL permitido em funnel_events (evento médico sem escala).
--
-- Schema `checkup` (isolado do clínico, SEM tenant) — nenhuma instrução RLS.
-- Idempotente e re-executável: derruba qualquer CHECK que referencie scale_id (incluindo o
-- inline auto-nomeado da 0039) e recria um CHECK NOMEADO. Derrubar TODOS evita que o CHECK
-- antigo, mais estreito, permaneça e faça AND com o novo (continuaria rejeitando as escalas novas).

DO $$
DECLARE
    r RECORD;
BEGIN
    -- funnel_events: derruba todo CHECK que mencione scale_id (o inline da 0039 e re-runs anteriores)
    FOR r IN
        SELECT con.conname
        FROM pg_constraint con
        JOIN pg_class cls ON cls.oid = con.conrelid
        JOIN pg_namespace nsp ON nsp.oid = cls.relnamespace
        WHERE nsp.nspname = 'checkup'
          AND cls.relname = 'funnel_events'
          AND con.contype = 'c'
          AND pg_get_constraintdef(con.oid) ILIKE '%scale_id%'
    LOOP
        EXECUTE format('ALTER TABLE checkup.funnel_events DROP CONSTRAINT %I', r.conname);
    END LOOP;

    -- test_results: idem
    FOR r IN
        SELECT con.conname
        FROM pg_constraint con
        JOIN pg_class cls ON cls.oid = con.conrelid
        JOIN pg_namespace nsp ON nsp.oid = cls.relnamespace
        WHERE nsp.nspname = 'checkup'
          AND cls.relname = 'test_results'
          AND con.contype = 'c'
          AND pg_get_constraintdef(con.oid) ILIKE '%scale_id%'
    LOOP
        EXECUTE format('ALTER TABLE checkup.test_results DROP CONSTRAINT %I', r.conname);
    END LOOP;
END
$$;

-- funnel_events.scale_id: NULL permitido (eventos do lado médico não carregam escala).
ALTER TABLE checkup.funnel_events
    ADD CONSTRAINT funnel_events_scale_id_check
    CHECK (scale_id IS NULL OR scale_id IN (
        'phq9', 'gad7', 'asrs18', 'audit', 'mdq', 'fagerstrom', 'msi_bpd', 'assist'
    ));

-- test_results.scale_id: NOT NULL já é garantido pela coluna; o CHECK só restringe o domínio.
ALTER TABLE checkup.test_results
    ADD CONSTRAINT test_results_scale_id_check
    CHECK (scale_id IN (
        'phq9', 'gad7', 'asrs18', 'audit', 'mdq', 'fagerstrom', 'msi_bpd', 'assist'
    ));

COMMENT ON CONSTRAINT funnel_events_scale_id_check ON checkup.funnel_events IS
    'scale_id no set completo do motor ADR-048 (8 escalas) ou NULL (evento do lado médico sem escala).';
COMMENT ON CONSTRAINT test_results_scale_id_check ON checkup.test_results IS
    'scale_id no set completo do motor ADR-048 (8 escalas).';
