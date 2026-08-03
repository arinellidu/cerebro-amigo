# ADR-075: Defesa em camadas anti denial-of-wallet na superfície pública do checkup

**Status:** Accepted
**Data:** 2026-06-29
**Decisores:** Patrick Arinelli, Adonai Arinelli
**Categoria:** Segurança / Custo / apps/checkup
**Relaciona:** ADR-044 (LLM via Anthropic API direta), ADR-045 (checkup em ASG+ALB próprio), ADR-061/073 (e-mail por Resend), ADR-018 (cifragem/LGPD), ADR-055 (Turnstile no signup médico)

## Contexto

`apps/checkup` é a **única superfície pública anônima** do sistema. A rota `POST /api/devolutiva` chama a Anthropic API (Haiku, ADR-044) com a `ANTHROPIC_API_KEY` do projeto. A conta Anthropic é **separada** da AWS — o AWS Budget ($120/mês) **não a enxerga**. As rotas `pdf` e `email-report` também custam (CPU do react-pdf; envio Resend).

Auditoria red-team adversarial (2026-06-29, 8 vetores × craft+verify contra o código) confirmou **8/8 vetores exploráveis** para drenar os créditos Anthropic (*denial-of-wallet*):

- **`xff-spoof` / `ip-rotation`** — `getClientIP` lia `x-forwarded-for.split(",")[0]` (o **primeiro** hop = valor forjável pelo viewer). CloudFront (`HeaderBehavior: allViewer`) e ALB apenas *anexam* o IP real à direita → o atacante injetava `X-Forwarded-For: <aleatório>` e ganhava um "IP novo" por request, zerando o limite de 20/IP/h. Copiado em **5 rotas**.
- **`session-churn` / `direct-api-no-binding`** — `sessionId` vinha do **body** (`crypto.randomUUID()` no cliente), sem binding a um teste concluído. UUID novo por request = balde de 3/sessão/24h sempre virgem. `POST` direto na API, sem fazer o teste.
- **`unbounded-input-tokens`** — `band`/`bandLabel` eram `z.string().min(1)` **sem `.max()`**; `bandLabel` entrava cru no prompt. `max_tokens` limita só a **saída** → string gigante inflava os **input-tokens** por chamada (assimetria de 3–4 ordens de grandeza).
- **`retry-amplification`** — retry de parse manual (×2) + `maxRetries: 1` do SDK = até ~4 `messages.create` por request.
- **`db-failsoft-open`** — sob falha do DB de rate limit, o caminho caía no limitador **in-memory por processo**; no ASG multi-instância isso é `N × limites` e trivialmente saturável (fail-**open** no caminho pago).
- **`email-ses-amplification`** — `email-report` enviava PDF para destinatário arbitrário com defesa só de 30/IP/h (furável pelo mesmo XFF) → email-bomb de terceiros + risco à reputação do domínio clínico compartilhado.

Não havia **WAF**, **captcha** nem **teto de gasto em código** — o único backstop era o spend-limit **mensal** do Console Anthropic, que é o último recurso e, quando dispara, **nega o produto para todos** pelo resto do mês.

## Decisão

**Construir defesa em camadas em código (no app), começando pelas mais baratas e de maior impacto, de modo que o spend-limit do Console seja o último recurso, não a defesa.** O princípio é degradar para o **fallback estático** (que é produto — `src/lib/ai/CLAUDE.md`), nunca quebrar.

Implementado nesta entrega (in-app, sem infra/migration):

1. **IP confiável** (`src/lib/client-ip.ts`, helper único substituindo as 5 cópias) — `X-Forwarded-For` descartando **N hops confiáveis da direita** (`CHECKUP_TRUSTED_PROXY_HOPS`), nunca o `[0]`. **Default 0** = topologia viva (ADR-045: o checkup serve DIRETO do ALB, 1 hop; o IP real é a última entrada que o ALB anexou). Quando o CloudFront for fronteado e **enforçado** (origin-secret no `:443`), setar `=1`. Valor não-inteiro/negativo → cai no default (nunca reabre o spoof em silêncio). O header `CloudFront-Viewer-Address` só é confiado sob `CHECKUP_TRUST_CF_VIEWER_HEADER=true` — enquanto o ALB `:443` estiver aberto, um atacante batendo direto no ALB poderia forjá-lo. **Importante:** este fix por-IP é topology-dependent; o teto de gasto topology-independent é o breaker (item 3).
2. **`.max()` nos campos que viram custo** — `devolutiva`: `band.max(24)`/`bandLabel.max(48)`; `email-report`: `band.max(24)`/`label.max(64)`; `pdf`: length-guards (scale ≤24, band ≤24, label ≤64, sub ≤500 e ≤30 entradas, score 0–999). Mata `unbounded-input-tokens` na raiz (cada call vira barata mesmo sob vazão).
3. **Circuit breaker GLOBAL de chamadas LLM** (`src/lib/ai/breaker.ts`) — teto **horário e diário** (`CHECKUP_LLM_HOURLY_CAP` default 500, `CHECKUP_LLM_DAILY_CAP` default 3000), contador atômico em `checkup.rate_limits` (migration 0040, **sem migration nova**; in-memory não serve — viraria N× no ASG). Estouro → `getFallback` + log `llm.breaker.tripped`. Transforma "drenagem ilimitada" em "DoS temporário da feature de IA com custo capped em USD conhecido".
4. **Fail-CLOSED no caminho pago** — `dbHit` passa a distinguir `no-db` (dev/CI → in-memory) de `db-error` (incidente em prod). `devolutiva` e `email-report` **negam** (degradam para fallback) sob falha de DB em vez de abrir a torneira; `pdf` segue fail-soft (só CPU). Breaker falha **aberto** (o caminho por request já é fail-closed na mesma condição).
5. **`maxRetries: 0`** no client Anthropic — numa superfície anônima o SDK não deve retentar erro de rede (teto 2 chamadas/request em vez de ~4).
6. **Observabilidade** — log estruturado `llm.breaker.tripped` para metric filter + alarme CloudWatch (`/cerebro/checkup` → SNS `piloto-alertas`).

**Fronteira (CLAUDE.md):** nada cruza para os serviços clínicos; o que vai ao LLM continua sendo só escala/escore/faixa (LGPD intacta); o IP confiável e os baldes do breaker **não** introduzem PII.

## Deferido (follow-up, exige infra/migration ou mudança no cliente)

- **Nonce assinado teste→devolutiva** (HMAC, uso único) — mata `direct-api-no-binding` de vez (exige tabela nova + mudança em `QuizFlow`/`email-report`).
- **WAF rate-based no CloudFront** (rede de borda independente; protege também o DoS de CPU do PDF) e/ou **Turnstile invisível** (reusar ADR-055) na devolutiva.
- **Endurecer o ALB `:443`** com o `X-CF-Origin-Secret` (hoje só o `:80` enforça; o `:443` faz forward direto — `checkup-asg-alb.yaml:197-198`) OU `routing.http.xff_header_processing.mode = remove` no ALB. Enquanto o `:443` estiver alcançável direto, o fix por-IP é bypassável por esse caminho (o atacante vira topologia de 1 hop); o breaker (item 3) é o que limita o dano nesse meio-tempo. Só **depois** disso faz sentido frontear o CloudFront, expor `CloudFront-Viewer-Address` no Origin Request Policy e ligar `CHECKUP_TRUST_CF_VIEWER_HEADER=true` + `CHECKUP_TRUSTED_PROXY_HOPS=1`.
- **Dedup `tracking_reminders`** (UNIQUE `email_hash` + throttle por destinatário no cron) **antes** de ligar a flag CK-4.

## Consequências

- **Positivas:** teto de gasto **em código** (não só mensal no Console); cada chamada barata por construção; rate-limit por IP com identidade confiável na topologia ativa; falha de DB não abre a torneira paga; visibilidade de gasto anômalo em minutos. Verificado: `tsc` limpo, testes verdes, `next build` ok.
- **Negativas / a calibrar:** os caps do breaker (500/h, 3000/dia) são chutes conservadores para tráfego pré-lançamento (~0) — **recalibrar com tráfego real** para não cortar uso legítimo num pico. O fix por-IP é **topology-dependent**: `CHECKUP_TRUSTED_PROXY_HOPS` precisa casar com a topologia ativa (0 = ALB-direto hoje; 1 = CloudFront→ALB depois do enforcement no `:443`) — por isso o **breaker** é o backstop que NÃO depende de IP. Enquanto o ALB `:443` aceitar acesso direto, o rate-limit por IP é bypassável por esse caminho (mitigado pelo breaker até o hardening listado em *Deferido*).
- **Backstop final** continua sendo o spend-limit do Console Anthropic — agora com alarme upstream que avisa **antes** de ele cortar.
