-- =============================================================================
-- 0057 — Portal do paciente pode LER suas próprias `medicacoes_em_uso`
-- =============================================================================
-- A 0047 deu RLS só doctor-facing (app.current_medico). O portal do paciente usa
-- app.current_paciente (TenantSessionMiddleware), então a aba "Medicações" do
-- portal via 0 linhas (fail-closed) — o paciente não via o que o médico registrou
-- que ele toma. Isto adiciona uma policy READ-ONLY para o paciente ver as PRÓPRIAS
-- linhas, espelhando o padrão de `prescricoes`/`sintomas` (0037: cláusula
-- `paciente_id = app.current_paciente`).
--
-- Escopo (clinical-safety #4 — LGPD/tenant): SOMENTE SELECT, SOMENTE as linhas do
-- próprio paciente (paciente_id = app.current_paciente). A policy de escrita segue
-- exclusiva do médico dono (tenant_iso FOR ALL, 0047) — o paciente NÃO pode
-- inserir/editar/remover. Multi-policy permissiva: SELECT é permitido se a policy
-- do médico OU esta do paciente casar (OR), cada papel vê só o seu.
-- Idempotente.
-- =============================================================================

DROP POLICY IF EXISTS paciente_read ON medicacoes_em_uso;
CREATE POLICY paciente_read ON medicacoes_em_uso FOR SELECT
    USING (
        current_setting('app.tenant_bypass', true) = 'on'
        OR paciente_id = NULLIF(current_setting('app.current_paciente', true), '')::uuid
    );
