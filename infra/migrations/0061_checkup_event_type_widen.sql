-- Migration 0061: alarga o CHECK de event_type em checkup.funnel_events
--
-- POR QUÊ:
-- A 0039 fixou event_type IN ('test_started','crisis_routed','test_completed',
-- 'report_generated','qr_scanned','doctor_signup_started') e NENHUMA migration
-- posterior alargou esse CHECK (a 0059 alargou só scale_id). Mas a rota
-- /api/events já aceita 'email_report_sent' no Zod desde o envio de PDF por
-- e-mail — o Postgres rejeita o INSERT e, como a rota engole o erro
-- (console.error + ok:true), esses eventos são SILENCIOSAMENTE DESCARTADOS em
-- produção hoje (mesma classe de bug da 0059).
--
-- Esta migration alarga o CHECK para a lista autoritativa completa, incluindo:
--   - email_report_sent      (já emitido pelo ResultadoClient; hoje descartado)
--   - instagram_follow_click (novo — CTA "siga no Instagram" na tela de resultado)
--
-- Schema `checkup` (isolado do clínico, SEM tenant) — nenhuma instrução RLS.
-- Idempotente e re-executável: derruba qualquer CHECK que referencie event_type
-- (incluindo o inline auto-nomeado da 0039) e recria um CHECK NOMEADO. Derrubar
-- TODOS evita que o CHECK antigo, mais estreito, permaneça e faça AND com o novo.

DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT con.conname
        FROM pg_constraint con
        JOIN pg_class cls ON cls.oid = con.conrelid
        JOIN pg_namespace nsp ON nsp.oid = cls.relnamespace
        WHERE nsp.nspname = 'checkup'
          AND cls.relname = 'funnel_events'
          AND con.contype = 'c'
          AND pg_get_constraintdef(con.oid) ILIKE '%event_type%'
    LOOP
        EXECUTE format('ALTER TABLE checkup.funnel_events DROP CONSTRAINT %I', r.conname);
    END LOOP;
END
$$;

ALTER TABLE checkup.funnel_events
    ADD CONSTRAINT funnel_events_event_type_check
    CHECK (event_type IN (
        'test_started', 'crisis_routed', 'test_completed',
        'report_generated', 'email_report_sent',
        'qr_scanned', 'doctor_signup_started',
        'instagram_follow_click'
    ));

COMMENT ON CONSTRAINT funnel_events_event_type_check ON checkup.funnel_events IS
    'Lista autoritativa de eventos de funil — espelha EVENT_TYPES em apps/checkup/src/app/api/events/route.ts.';
