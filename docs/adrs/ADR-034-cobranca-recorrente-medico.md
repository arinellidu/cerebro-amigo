# ADR-034 — Cobrança recorrente da plataforma ao médico (Fluxo A) via Asaas

**Status:** aceito · 2026-06-06
**Contexto relacionado:** [[ADR-033]] (monetização / Asaas)

## Contexto

O Cérebro Amigo precisa cobrar o **médico** pela assinatura do SaaS. Até aqui só
existia registro **manual** de pagamento (`/admin/financeiro` → `pagamentos_manuais`):
o dono anotava o que recebia por fora. Não havia cobrança automática.

O ADR-033 implementou o **Fluxo B** (médico cobra paciente, com split pela conta-mãe
+ subconta do médico). Decisão de negócio **2026-06-06**: a relação financeira
médico↔paciente **fica com o médico** — a plataforma não intermedia. O Fluxo B é
**estacionado** (UI escondida; backend/tabelas mantidos, dormentes, reversível).

## Decisão

**Fluxo A:** a plataforma cobra o médico via **Asaas `/subscriptions`** (recorrência
mensal), com `billingType=UNDEFINED` (o médico escolhe **pix/boleto/cartão** na página
do Asaas). **Sem split e sem subconta** — é a plataforma cobrando o próprio cliente; o
dinheiro cai direto na conta-mãe. Gateway = `api-gateway` (.NET), transacional puro
(sem LLM), conforme `cerebro-architecture`.

- **Customer Asaas = médico** (nome + CPF + email). Criado uma vez, `asaas_customer_id`
  guardado em `assinaturas`.
- **Subscription = assinatura** (`value=valor_mensal`, `cycle=MONTHLY`,
  `externalReference=assinatura_id`, 1ª cobrança no fim do trial ou hoje).
  `asaas_subscription_id` guardado em `assinaturas`.
- **Webhook** (`POST /api/v1/asaas/webhook`, unificado): pagamento de assinatura
  (`payment.subscription`) → registra em `pagamentos_manuais` (`metodo='asaas'`,
  idempotente por `asaas_payment_id`) e marca `assinaturas.status` = `ativa` (pago) /
  `suspensa` (vencido). Continua tratando cobranças do Fluxo B legado.
- **Migration 0031:** `assinaturas.asaas_customer_id`, `assinaturas.asaas_subscription_id`,
  `pagamentos_manuais.asaas_payment_id` (+ índice único).
- **UI:** `/admin/financeiro` ganha "Ativar cobrança Asaas" / "Cancelar" por médico;
  devolve o link de pagamento pra enviar ao médico. Mantém o registro manual.

## Consequências

- Receita do médico recorrente e automática, sem peso regulatório de intermediação
  (não há split → a plataforma não é "marketplace" perante o médico↔paciente).
- Mesmas envs do ADR-033 (`ASAAS_API_KEY`/`ASAAS_ENV`/`ASAAS_WEBHOOK_TOKEN`), mas agora
  a conta-mãe é a própria plataforma cobrando direto. Sem `ASAAS_API_KEY` o gateway
  sobe normal e a ativação responde 503.
- **Pré-requisito de prod:** o webhook do Asaas precisa alcançar o gateway por **URL
  pública HTTPS** (a Vercel é só o front; o webhook bate direto no EC2).
- Fluxo B fica no código, desligado da navegação. Reativar = religar a UI.

## Fora de escopo

NFS-e da plataforma ao médico; dunning/retentativa além de `suspensa`; onboarding de
subconta/split (descartado com o Fluxo B).
