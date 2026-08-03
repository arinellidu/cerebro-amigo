# ADR-036 — Cockpit de receita do admin (Fluxo A)

**Status:** aceito · 2026-06-06
**Contexto relacionado:** [[ADR-033]] (monetização), [[ADR-034]] (cobrança recorrente do médico)

## Contexto

A Visão Geral do `/admin` mostrava MRR e receita como números soltos, sem
narrativa de negócio: não dava para ver quem está prestes a deixar de pagar
(inadimplência), a receita ao longo do tempo, nem onde a conversão trial→pago
está vazando. A auditoria do `/admin` (2026-06-06) apontou isso como o gap nº1
do cockpit do dono.

A cobrança da plataforma ao médico (Fluxo A) já registra tudo no banco:
`assinaturas` (status/valor) e `pagamentos_manuais` (histórico, inclusive os
pagamentos vindos do webhook Asaas). O webhook marca `assinaturas.status =
'suspensa'` em `PAYMENT_OVERDUE` — ou seja, a inadimplência já é capturada,
só faltava a tela. (`cobrancas`/Fluxo B é médico↔paciente, estacionado — fora.)

## Decisão

Novo endpoint **`GET /api/v1/admin/cockpit`** (gateway .NET, `admin_geral`) que
agrega, em uma chamada, sobre Fluxo A:

- **MRR atual** = `SUM(valor_mensal)` das assinaturas `ativa`, + breakdown por plano.
- **Receita realizada por mês** (12m) de `pagamentos_manuais` confirmados, com a
  fronteira de mês no fuso de Brasília (`AT TIME ZONE 'America/Sao_Paulo'`).
- **Inadimplência / MRR em risco** = assinaturas `suspensa` (pagamento vencido).
- **Trials** ativos + os que vencem em ≤7 dias.
- **Funil** (aproximado): convidados → ativaram (`medico_invite_tokens`) → em
  trial → converteram (assinatura ativa com ≥1 pagamento confirmado).
- **Cobráveis sem Asaas**: assinaturas trial/ativa com CPF + `valor_mensal>0` e
  `asaas_subscription_id IS NULL` (atacam o "0/3 cobráveis" da operação).

UI em **`/admin/receita`** (link na sidebar + Cmd+K): KPIs, barras de receita,
funil e três filas acionáveis que linkam para o Financeiro.

## Consequências

- **NÃO** há decomposição real de MRR (Novo/Expansão/Contração/Churn): isso
  exigiria histórico de snapshots de MRR, que não existe (tabela `assinaturas` é
  estado-atual, `UNIQUE (medico_id)`). Mostramos receita realizada (fato) +
  snapshot de MRR — honesto. Decomposição fica para um passo futuro (tabela de
  snapshot mensal + job).
- Sem migration nova: tudo deriva de tabelas existentes. Sem dado clínico (só
  financeiro/identificação de médico) — fora do escopo clinical-safety.
- Funil é aproximado e rotulado como tal na UI (nem todo médico passou por
  `medico_invite_tokens`; seeds/onboarding direto não geram convite).
