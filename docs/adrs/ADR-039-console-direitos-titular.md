# ADR-039 — Console de direitos do titular (LGPD)

**Status:** aceito · 2026-06-06
**Contexto relacionado:** [[ADR-019]] (retomada de automação — circuit-breaker de crise), [[ADR-038]] (trilha de acesso), clinical-safety regras 4 e 5

## Contexto

LGPD garante ao titular direitos de acesso, portabilidade, eliminação, correção e
oposição ao tratamento automatizado (art. 18). Não havia ferramenta para o DPO
registrar e acompanhar essas solicitações — ficariam em e-mail/planilha, sem
trilha. A auditoria do `/admin` (2026-06-06) propôs um console de direitos.

A ideia original sugeria reutilizar `pacientes.automacao_pausada` para a
"oposição ao tratamento por IA". **Rejeitado:** esse booleano é o
**circuit-breaker de crise** (ADR-005/019) — `GET /api/v1/crise/ativas` lista
pacientes com ele `TRUE`, e a retomada é um **ato clínico do médico** (ADR-019).
Usá-lo para opt-out de LGPD faria o paciente aparecer como "crise ativa" para o
médico, e um resume administrativo bypassaria o fluxo clínico de retomada.

## Decisão

Console de **registro e acompanhamento** (não-executor), migration 0033:

- Tabela **`solicitacoes_titular`**: `identificacao` (e-mail/nome do titular),
  `paciente_id?`, `tipo` (acesso | portabilidade | eliminacao | oposicao_ia |
  correcao), `status` (aberta | atendida | recusada), `notas`, `criado_por`,
  `atendido_por`, timestamps. **DELETE bloqueado** por trigger (registro de
  conformidade); UPDATE de status permitido (workflow aberta → atendida/recusada).
- Endpoints (`admin_geral`): `GET/POST /api/v1/admin/solicitacoes`,
  `PATCH /api/v1/admin/solicitacoes/{id}`. Tela `/admin/lgpd`.

O console **registra e acompanha** — não executa a operação. Export, eliminação
e a oposição efetiva são feitos à parte, deliberadamente.

## Consequências

- Não toca o circuit-breaker de crise — evita o conflito acima.
- Não há operação irreversível neste passo (nenhuma anonimização/eliminação
  automática). O registro é evidência de conformidade e é append-no-delete.
- Sem conteúdo clínico — só metadados da solicitação (regra 4).
- **Próximos passos sugeridos (fora deste ADR):** opt-out de IA real com coluna
  dedicada `ia_vedada` (separada de `automacao_pausada`, com os jobs checando-a);
  export de portabilidade estruturado (sem LLM); eliminação/anonimização
  preservando trilhas imutáveis (irreversível — com dupla confirmação). Cada um
  exige decisão clínica/jurídica e ADR próprio.
