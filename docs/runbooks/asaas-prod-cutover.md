# Runbook — cutover do Asaas sandbox → produção (Fluxo A, ADR-034/ADR-055)

> **Cérebro Amigo** · cobrança recorrente da PLATAFORMA ao MÉDICO (Fluxo A, sem split).
> Liga a receita real → pré-requisito de captar médicos pagantes + do paywall (ADR-055).

## Estado (o que já está pronto)

- **Código prod-ready, zero mudança.** `AsaasClient.ResolveConfig()` troca a base URL por env:
  `ASAAS_ENV=prod` → `https://api.asaas.com/v3`; senão `https://sandbox.asaas.com/api/v3`
  (`apps/api-gateway/Services/AsaasClient.cs:37-48`). Override opcional `ASAAS_API_BASE`.
- Webhook implementado e **fail-closed**: sem `ASAAS_WEBHOOK_TOKEN` → 503 (Asaas reenvia);
  valida header `asaas-access-token` (`CobrancasEndpoints.cs:187-265`). Mapeia
  `PAYMENT_RECEIVED`/`PAYMENT_CONFIRMED`→`assinaturas.status='ativa'` (+ grava `pagamentos_manuais`,
  idempotente por `asaas_payment_id`), `PAYMENT_OVERDUE`→`suspensa`.
- Ativação de cobrança do médico: `POST /api/v1/admin/assinaturas/{id}/cobranca-asaas`
  (`AdminEndpoints.cs`) → cria customer + subscription (MONTHLY, `billingType=UNDEFINED`) → grava
  `asaas_subscription_id` → devolve `invoiceUrl`.
- Sandbox já configurado (key/token via SSM 2026-06-06).

## Fase 0 — Conta Asaas produção (KYC) — **externo, Patrick (painel Asaas)**

KYC = aprovação cadastral da conta de **produção** (`app.asaas.com` — sandbox e prod são
contas/keys **separadas**). Sem código; é painel + análise do compliance Asaas.

1. **Conta de produção:** entrar em `app.asaas.com`. PJ = cadastrar com **CNPJ**.
2. **Dados cadastrais:** CNPJ, atividade principal, endereço, faturamento estimado, **dados dos sócios**.
3. **Documentos** (painel → "Minha conta" → **Situação cadastral e documentos**, ou link de onboarding):
   - **PJ:** Contrato Social / Estatuto, cartão CNPJ, documento dos sócios (RG/CNH + CPF),
     comprovante de endereço. O compliance pode solicitar mais.
4. **Conta bancária** de recebimento — **mesma titularidade do CNPJ** (para saque).
5. **Análise (compliance Asaas):** status fica `AWAITING_APPROVAL` → conta 100% aprovada quando
   `general=APPROVED`. Se acharem dado comercial inconsistente → corrigir → nova análise.
6. **Aprovado** → a conta recebe/saca dinheiro. Pegar a **API key de PRODUÇÃO** em
   **Integrações → API** (distinta da sandbox).

> A API key de prod pode aparecer antes da aprovação total, mas **só cobra/recebe dinheiro com
> KYC aprovado** (`general=APPROVED`). Para cobrar médico de verdade = precisa aprovado.

Referências (Asaas): [Situação cadastral e documentos](https://central.ajuda.asaas.com/hc/pt-br/sections/31406392824219-Situa%C3%A7%C3%A3o-cadastral-e-documentos) ·
[Onboarding/envio de documentos](https://docs.asaas.com/docs/onboarding-e-envio-de-documentos-via-link) ·
[Consultar situação cadastral (API)](https://docs.asaas.com/reference/consultar-situacao-cadastral-da-conta).

## Fase 1 — Envs no SSM + recriar containers — **Patrick (segredo)**

Setar (SSM SecureString; injetadas no `.env` do box no deploy):
- `ASAAS_API_KEY` = chave de **produção**
- `ASAAS_ENV` = `prod`  ← **crítico**: sem isso, mesmo com a key prod, o gateway bate no sandbox → 401
- `ASAAS_WEBHOOK_TOKEN` = token forte novo (`openssl rand -hex 32`) — **mesmo valor** no painel (Fase 2)

```bash
# laptop (adonaiarinelli) — exemplo; ajuste os nomes de parâmetro aos atuais do projeto
aws ssm put-parameter --region sa-east-1 --type SecureString --overwrite \
  --name <param-asaas-api-key>      --value '<PROD_KEY>'
aws ssm put-parameter --region sa-east-1 --type String --overwrite \
  --name <param-asaas-env>          --value 'prod'
aws ssm put-parameter --region sa-east-1 --type SecureString --overwrite \
  --name <param-asaas-webhook-token> --value '<TOKEN_HEX>'
# depois: redeploy/recriar containers do gateway p/ recarregar o .env
```

## Fase 2 — Registrar webhook no painel Asaas — **externo, Patrick**

- **URL:** `https://api.cerebroamigo.com.br/api/v1/asaas/webhook` (pública via Caddy/ALB)
- **Token de autenticação** (header `asaas-access-token`): **igual** ao `ASAAS_WEBHOOK_TOKEN` da Fase 1
- **Eventos:** `PAYMENT_RECEIVED`, `PAYMENT_CONFIRMED`, `PAYMENT_OVERDUE`,
  `PAYMENT_REFUNDED`, `PAYMENT_DELETED`. Os 2 últimos agora **encerram a assinatura do
  médico (Fluxo A → `status='cancelada'`)** — fix do launch-QA (PR #70); antes eram só
  Fluxo B. Limitação conhecida: `SUBSCRIPTION_DELETED` (payload sem `payment`) NÃO é
  capturado; cancelamento administrativo via `PATCH /admin/assinaturas/{id}` já chama
  `CancelarAssinaturaAsync` no Asaas, então o caso comum está coberto.
- Versão da fila: síncrona/sequencial (padrão). Confirme o "enviar" e teste o envio do painel.

## Fase 2.5 — Limpar estado de SANDBOX (antes de cobrar em prod)

O sandbox deixa `asaas_subscription_id` / `asaas_customer_id` (e às vezes `status='ativa'`/
`'trial'`) nas `assinaturas` — **falso-ativos**: apontam p/ objetos do sandbox que **não
existem na prod**. Estrago: (1) paywall falso-libera; (2) `cobranca-asaas` retorna **409
`ja_ativa`** (guard em `AdminEndpoints` quando `asaas_subscription_id` preenchido) → "erro
com a Asaas" sem logar; (3) se só o `customer_id` é stale, a subscription falha (customer
não existe na prod). Limpar SÓ as linhas com id de sandbox (Pix-manual sem id não é tocado;
nenhum id de prod existe ainda):

```sql
-- conferir antes
SELECT status, count(*), count(asaas_subscription_id) com_sub, count(asaas_customer_id) com_cust
FROM assinaturas GROUP BY status;
-- resetar
UPDATE assinaturas
SET asaas_subscription_id = NULL, asaas_customer_id = NULL,
    status = 'pendente', prazo_pagamento_ate = NOW() + INTERVAL '5 days', atualizado_em = NOW()
WHERE asaas_subscription_id IS NOT NULL OR asaas_customer_id IS NOT NULL;
```

NÃO apagar `pagamentos_manuais` (registro de teste, inofensivo; deletar é mais arriscado).
Rodar via `docker exec <container-py> python` (asyncpg) ou SSM — não há psql no box.

## Fase 3 — Tornar 1 médico cobrável + ativar cobrança

Pré-requisitos do médico (senão a ativação retorna 400):
- `medicos.cpf` válido
- `assinaturas.valor_mensal > 0` + `plano` real (não `pendente`/0 do auto-signup)

Ação (admin): `POST /api/v1/admin/assinaturas/{assinaturaId}/cobranca-asaas`
→ cria customer + subscription no Asaas → grava `asaas_subscription_id` → retorna `invoiceUrl`.
Enviar o `invoiceUrl` ao médico (ou ele vê em "Minha assinatura" / Fase C do ADR-055 = botão "Pagar agora").

## Fase 4 — Smoke E2E (com valor baixo)

1. Ativar cobrança de um médico de teste com `valor_mensal` baixo (ex.: R$ 5).
2. Pagar a 1ª cobrança pelo `invoiceUrl` (Pix recomendado — confirma na hora).
3. Asaas dispara `PAYMENT_RECEIVED` → webhook → conferir:
   - `assinaturas.status = 'ativa'` (era `pendente`)
   - 1 linha em `pagamentos_manuais` (`metodo='asaas'`, `asaas_payment_id` preenchido)
   - `GET /api/v1/minha-assinatura` → `status=ativa`, `liberado=true` (ADR-055 Fase B)
4. (Opcional) simular vencido no painel → `PAYMENT_OVERDUE` → `status='suspensa'`.

## Rollback (voltar pra sandbox)

- `ASAAS_ENV=sandbox` (ou remover) + `ASAAS_API_KEY` = key sandbox → recriar containers.
- Webhook prod pode ficar registrado (sem tráfego de prod não dispara); ou remover no painel.
- Nenhuma migração de dado — só env. Assinaturas já `ativa` permanecem.

## Gotchas

- **Key Asaas começa com `$` (`$aact_…`) → no `.env` do box (carregado via `env_file` do
  compose) DOBRAR o cifrão: `ASAAS_API_KEY=$$aact_…`.** Senão o docker-compose interpola
  `$aact_…` como variável (inexistente) e **zera a key** → `AsaasClient.Configurado=false`
  → "sem API KEY" / 503. Confirmar no container: `docker compose exec api-gateway sh -lc
  'echo len=${#ASAAS_API_KEY}'` (len=0 = comeu o `$`). Vale p/ qualquer `$` no valor.
- `ASAAS_ENV=prod` é o que troca a base URL. Esquecer = key prod no sandbox → 401.
- Webhook **fail-closed**: sem `ASAAS_WEBHOOK_TOKEN` no gateway → 503 (Asaas reenfileira). O token do
  header no painel **tem** que bater com o env.
- `billingType=UNDEFINED`: o médico escolhe pix/boleto/cartão no link da 1ª cobrança.
- Webhook é `AllowAnonymous` (autentica por token de header), URL pública — não exige JWT.
- Idempotência: `pagamentos_manuais.asaas_payment_id` com `ON CONFLICT DO NOTHING` — reenvio do mesmo
  pagamento não duplica.
- Produção cobra de verdade → smoke sempre com valor baixo; spend/limites no Console da Anthropic não
  têm relação (isto é gateway de pagamento, não LLM).
- Sem webhook entregue, a assinatura não vira `ativa` sozinha (rede de segurança = job de reconciliação
  noturno proposto na Fase E do ADR-055 — ainda não implementado).

---

*Cérebro Amigo by Arinelli · Fluxo A (ADR-034) · paywall (ADR-055).*
