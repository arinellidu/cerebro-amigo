# ADR-033: Monetização do médico (Asaas), dashboard ROI, recall de inativos e blindagem médico-legal

**Status:** Aceito (branch `feat/monetizacao-roi`, via PR — não no main)
**Data:** 2026-06-05
**Decisores:** Equipe de engenharia + dono do produto
**Categoria:** Produto / Negócio / Comercial
**Relacionados:** ADR-024 (MEMED), ADR-021 (escopo administrativo da IA), ADR-018 (cifragem)

## Contexto

Análise comercial: o que faz o psiquiatra **comprar e renovar** o SaaS são quatro
gatilhos — tempo de volta, dinheiro no bolso, blindagem médico-legal e prova de
valor. As 5 ideias do doc de visão eram fortes mas faltava a camada que o médico
paga. Esta ADR cobre os 3 primeiros itens priorizados (o item 1, Ambient Scribe,
fica para a sequência por depender do AWS Transcribe Medical).

## Decisão

### Pagamento — Asaas, duas contas (não Stripe)

Cobrança do paciente no portal em BRL exige Pix + boleto + **NFS-e** + recorrência —
nativos no Asaas; o Stripe Connect não emite NFS-e BR. Por isso **Asaas**, separando
por CONTA (não por gateway):

- **Fluxo A — Plataforma cobra o médico (assinatura SaaS):** conta-mãe (CNPJ da
  plataforma); a plataforma emite NFS-e ao médico. (Implementação futura.)
- **Fluxo B — Médico cobra o paciente (consulta particular):** cobrança criada pela
  **conta-mãe com SPLIT** para a `walletId` da **subconta** do médico (white-label).
  O líquido liquida na subconta do médico; a plataforma retém a taxa
  (`split_percentual`); a NFS-e é emitida pela subconta do médico. Guardamos só os
  identificadores (subconta + wallet) — **nunca** a API key por médico (uma key no
  env: a conta-mãe). `AsaasClient` registrado **sem** resilience (retry em
  `POST /payments` = cobrança duplicada).

Esta entrega implementa o **Fluxo B (sandbox)**: criar cobrança Pix, espelhar em
`cobrancas`, exibir copia-e-cola/QR ao paciente no portal, e confirmar pagamento via
**webhook** (idempotente por `asaas_cobranca_id`). Sem `ASAAS_API_KEY`, os endpoints
respondem 503 (gateway sobe normal).

### Dashboard de monetização + ROI

`/dashboard/financeiro` (cockpit do médico): recebido no mês, a receber, vencido,
ticket médio, conversão e **pacientes inativos** (recuperação de receita). Tudo
escopado por tenant (JOIN `pacientes`).

### Recall de inativos (recuperação de receita)

Job determinístico `recall_inativos` (agents-py): paciente que JÁ consultou mas não
retorna há `RECALL_INATIVO_DIAS` (default 90) e sem retorno agendado → notifica o
médico (administrativo, não clínico). Respeita `automacao_pausada` + `SHADOW_MODE`;
dedup por `RECALL_DEDUP_DIAS`.

### Blindagem médico-legal

`GET /api/v1/blindagem/resumo` + card no dashboard: **agregação read-only** do que a
plataforma já faz pela proteção do médico (protocolos de crise registrados,
monitoramento de exames, renovação controlada, base de interações, eventos
auditados imutáveis). Não é feature nova — é **embalagem de confiança** que vende.

## clinical-safety

- Cobrança é **transacional puro** (gateway + Asaas) — a IA não toca em dinheiro.
- Recall é comunicação **administrativa** ao médico (ADR-021), não conduta clínica,
  não contata o paciente; respeita o circuit-breaker de crise (`automacao_pausada`).
- Blindagem é leitura agregada das tabelas de auditoria (append-only) — não as altera.
- Tenant em toda query (JOIN `pacientes.medico_responsavel_id` ou `medico_id`).

## Consequências

- Migration **0030** (`cobrancas`, `consultas.valor`, `medico_asaas_config`).
- Gateway: `AsaasClient`, `CobrancasEndpoints` (criar/listar/resumo/webhook),
  `BlindagemEndpoints`. agents-py: job `recall_inativos`.
- Web: `/dashboard/financeiro`, `BlindagemCard`, `/p/pagamentos` + BFF; nav Financeiro.
- **Pendente (você provê):** conta Asaas + `ASAAS_API_KEY` (sandbox) +
  `ASAAS_WEBHOOK_TOKEN`; aplicar migration 0030; configurar webhook no painel Asaas
  apontando para `/api/v1/asaas/webhook`. Onboarding de subconta por médico (Fluxo B
  completo) + Fluxo A (assinatura + NFS-e ao médico) + Ambient Scribe = próximos.
- **Não deployado** (branch + PR).
