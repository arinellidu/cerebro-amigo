# ADR-038 — Trilha de acesso a dados sensíveis (LGPD art. 37)

**Status:** aceito · 2026-06-06
**Contexto relacionado:** [[ADR-007]] (audit trail imutável → migration 0007), clinical-safety regras 4 e 5

## Contexto

Plataforma de saúde mental (dado pessoal sensível, LGPD categoria especial). O
art. 37 da LGPD exige que o controlador mantenha **registro das operações de
tratamento** de dados pessoais. Até aqui não existia nenhum log de acesso a
prontuário — não dava para responder "quem acessou os dados deste paciente?",
pergunta que é a primeira cobrada num incidente de segurança ou num pedido do
titular. A auditoria do `/admin` (2026-06-06) apontou a ausência como lacuna de
conformidade direta.

## Decisão

Nova tabela **append-only `acessos_prontuario`** (migration 0032, com trigger de
imutabilidade no padrão do 0007 — UPDATE/DELETE proibidos): `medico_id`,
`paciente_id` (cliente), `recurso`, `motivo?`, `criado_em`.

**Write path (gateway .NET):** cada leitura de dado clínico de paciente pelo
médico grava uma linha, via helper best-effort `RegistrarAcessoProntuarioAsync`:
- `PacientesPsiqEndpoints`: `timeline`, `humor`, `adesao`, `resumo_pre_consulta`
  (logado dentro de `PacienteEhDoMedico` quando o acesso é concedido);
- `ExamesEndpoints`: `exames`.
O log é **best-effort**: uma falha de gravação nunca quebra a leitura clínica
(disponibilidade do dado > completude do registro).

**Leitura (admin):** `GET /api/v1/admin/acessos` (`admin_geral`) + tela
`/admin/acessos`: KPIs (acessos 30d, **acessos cruzados**), busca por
médico/paciente, e flag de **acesso cruzado** (`medico_responsavel_id` do
paciente ≠ médico que acessou) — detector simples de bypass/anomalia.

## Consequências

- **Minimização (regra 4):** a trilha guarda só metadados — recurso acessado,
  nunca conteúdo clínico. A tela admin mostra médico + paciente + recurso +
  quando (o controlador/DPO precisa identificar o titular para o art. 37); não
  expõe nenhum dado clínico.
- **Imutabilidade (regra 5):** mesma garantia das outras trilhas (0007).
- **Cobertura:** instrumentados os principais reads doctor-facing de dado
  clínico. POSTs/escritas e o portal do paciente (acesso do próprio titular)
  ficam fora deste passo — podem ser adicionados depois com o mesmo helper.
- Best-effort = pode haver gaps de log sob falha de banco; aceitável para não
  degradar disponibilidade clínica. Monitorar via logs de aplicação no futuro.
