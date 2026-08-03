# AWS Support case — Bedrock on-demand throughput (tokens/day = 0)

Onde abrir: Console → **Support** → **Create case** → **Looking for service limit increases?** →
ou **Account and billing** se não houver plano de suporte técnico.
Service: **Amazon Bedrock**. Region: **South America (São Paulo) sa-east-1**.

---

## Subject
Bedrock on-demand inference blocked — "tokens per day" quota is 0 and not adjustable (sa-east-1)

## Case body (paste)

Account ID: 004177894935
Region: sa-east-1 (South America / São Paulo)

Every on-demand Bedrock `Converse` / `InvokeModel` call in this account fails with:

    ThrottlingException: Too many tokens per day, please wait before trying again.

This happens immediately, with zero prior usage today, on ALL Anthropic models —
including older ones (e.g. `anthropic.claude-3-haiku-20240307-v1:0`) — so it is an
account-level limit, not a per-model issue.

Diagnosis from Service Quotas (sa-east-1, bedrock):

- "Global cross-region model inference tokens per day for Anthropic Claude Sonnet 4.6"
  (quota L-248E47B7): APPLIED = 0, Adjustable = false
- "Global cross-region model inference tokens per day for Anthropic Claude Haiku 4.5"
  (quota L-B5C049AE): APPLIED = 0, Adjustable = false
- "...tokens per minute for ... Sonnet 4.6" (L-7BEE40FB): APPLIED = 0, DEFAULT = 6,000,000
- "...tokens per minute for ... Haiku 4.5" (L-9A11C666): APPLIED = 0, DEFAULT = 5,000,000

Model access is fine — GetFoundationModelAvailability returns
authorizationStatus = AUTHORIZED, entitlementAvailability = AVAILABLE,
agreementAvailability = AVAILABLE, regionAvailability = AVAILABLE.

The applied values are 0 even though AWS defaults are non-zero, and the
"tokens per day" quotas are marked non-adjustable, so I cannot raise them
through Service Quotas (console or API).

Request:
Please enable on-demand inference throughput for Anthropic Claude models in
this account in sa-east-1 — specifically set the per-day and per-minute token
limits to the standard account defaults (or any working non-zero value) for
Claude Sonnet 4.6, Claude Haiku 4.5 and Claude Opus 4.8.

Use case: healthcare SaaS (psychiatry), data residency in Brazil (sa-east-1),
authenticating to Bedrock via IAM role. Currently in development/testing.

---

## Fatos coletados (referência, não colar)
- IAM user usado no teste: arn:aws:iam::004177894935:user/adonaiarinelli (AdministratorAccess)
- Inference profile IDs corretos: global.anthropic.claude-sonnet-4-6,
  global.anthropic.claude-haiku-4-5-20251001-v1:0, global.anthropic.claude-opus-4-8
- Pedido via API nas quotas ajustáveis (per-minute) foi rejeitado:
  "You must provide a quota value greater than the default quota value of 6000000.0"
- Quotas per-day (L-248E47B7, L-B5C049AE) são Adjustable=false → só suporte resolve.
