# ADR-074: `apps/web` volta para a Vercel (Pro, região gru1); decomissão da stack EC2 ASG+ALB+CloudFront do web

**Status:** ❌ Superseded por [ADR-076](ADR-076-web-permanece-no-ec2-lgpd.md) — **ABANDONADO**. O cutover de DNS **nunca foi executado**; a análise LGPD no momento do flip vetou a transferência de dado de saúde para operadora US. O `apps/web` **permanece no EC2** `sa-east-1`. (Preparo técnico aproveitado como hardening — ver ADR-076.)
**Data:** 2026-06-29
**Decisores:** Patrick Arinelli, Adonai Arinelli
**Categoria:** Infra / Arquitetura / Compliance
**Supersede:** a migração **web Vercel→EC2** (jun/2026 — infra-only, sem ADR próprio: `infra/aws/web-asg-alb.yaml` + `infra/aws/cloudfront-web.yaml` + job `deploy-web` no `deploy.yml` + runbook `web-vercel-to-ec2-cutover.md`).
**Relaciona:** ADR-052 (Check-up roda no EC2, não na Vercel — mesma fronteira, decisão oposta por dependência de RDS), ADR-045 (checkup decouple ASG/ALB), ADR-047 (CloudFront + header secreto de origem `X-CF-Origin-Secret`), ADR-073 (zona DNS na Vercel), ADR-008/ADR-044 (residência de dado no Brasil), ADR-042 (RLS/least-privilege), ADR-026/ADR-040 (teleconsulta/escriba — SSE).

## Contexto

`apps/web` (Next.js 16: landing + dashboard médico + portal paciente `/p/*` + **BFF** em `app/api/*`) roda hoje na AWS `sa-east-1`: EC2 Auto Scaling Group `cerebro-web-asg` + ALB internet-facing (`infra/aws/web-asg-alb.yaml`) atrás de CloudFront (`www` → `dcw0e8uihnh8r.cloudfront.net`). A migração anterior (Vercel→EC2) foi motivada por **custo** (cartão não pagava a Vercel) e **cold start** de serverless.

Duas coisas mudaram:
1. O dono **assinou Vercel Pro** para separar os fronts do backend clínico — mas hoje a Vercel só serve o redirect 307 do apex e hospeda o DNS (ADR-073). O Pro está **ocioso**.
2. **Fluid Compute** (default no Pro) reduz drasticamente o cold start que motivou a saída anterior.

Diferença estrutural que torna `web` migrável (e o `checkup` **não** — ADR-052): `web` é um **BFF stateless**. Não abre conexão com o RDS nem com o orchestrator; faz apenas **HTTPS outbound** para o gateway .NET em `https://api.cerebroamigo.com.br` (TLS público, EC2 sa-east-1), autenticando com `INTERNAL_API_TOKEN` + cookie JWT repassado como Bearer (`apps/web/lib/gateway.ts`). O gateway **já é público** (ALB internet-facing, monitorado em `uptime-piloto.yaml`). Logo, mover `web` para a Vercel **não muda onde o dado clínico fica em repouso** (RDS sa-east-1) — muda **onde o BFF processa o dado em trânsito** (passa a ser a Vercel) e **fecha a opção** de um dia tornar o caminho web↔gateway privado dentro da VPC (`web-asg-alb.yaml:34-37`).

## Decisão

**Migrar `apps/web` para a Vercel (Pro), com funções fixadas em `gru1` (São Paulo); manter `checkup`, gateway .NET e os 3 serviços Python na AWS; decomissão faseada da stack EC2 do web só após janela de estabilidade.**

1. **Vercel Pro, projeto monorepo** com Root Directory `apps/web`; `vercel.json` com `"regions": ["gru1"]` (processamento no Brasil — residência LGPD + latência intra-região ao gateway). CDN de assets segue global (sem PII). Nenhuma rota em `runtime: "edge"` (furaria o pin de região).
2. **Postura do gateway exposto.** Como o egress da Vercel é dinâmico (sem IP fixo no Pro), a autenticação de origem é por **header secreto compartilhado** (`X-Edge-Auth`, SecureString no SSM), validado no gateway **fail-closed** antes da auth de negócio — reaproveitando o padrão `X-CF-Origin-Secret` que já protege o checkup (ADR-047). Camadas mantidas: JWT HS256 + `INTERNAL_API_TOKEN` (identidade/role) + TLS fim-a-fim. Acrescentar **AWS WAF managed rules + rate-limit por IP** na borda do ALB do gateway (o caller agora é a internet aberta).
3. **Paridade de segurança.** A CSP enforcing + HSTS + `X-Robots-Tag: noindex` vivem em `apps/web/next.config.mjs` (`headers()`) e são honradas pela Vercel. Deployment Protection obrigatório nos Previews (preview com dado clínico não pode ser público).
4. **SSE/streaming** (`maxDuration` nas 3 rotas: conversa paciente↔IA e as 2 de sinalização de teleconsulta) sob Fluid Compute; o EventSource do cliente reabre no fim do `maxDuration` e a sinalização sobrevive.
5. **Deploy** passa para a Git Integration da Vercel; o job `deploy-web` (ASG refresh) e o target `web` do bake/ECR são removidos **só após** o cutover validado (o EC2 é o rollback quente na janela de estabilidade).
6. **Cutover reversível por DNS:** flip do `www` (CNAME CloudFront → alvo Vercel) com TTL 60s; ASG/ALB/CloudFront ficam vivos ~1–2 semanas; rollback = reverter o CNAME. A chave de Server Actions (`NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`) é provisionada **idêntica** na Vercel e no EC2 antes do flip (evita `E191` na janela de coexistência).

## Consequências aceitas (trade-offs)

- **Gateway público permanente.** Perde-se a possibilidade (nunca exercida) de fechar o caminho web↔gateway na VPC (`web-asg-alb.yaml:34-37`). Risco residual de superfície de ataque permanente num sistema clínico — mitigado por header secreto + WAF + rate-limit + rotação, **não eliminado**. Aceitação consciente do responsável (não default técnico).
- **Suboperador LGPD nos EUA + transferência internacional.** A Vercel (empresa US) passa a **tratar dado de categoria especial em trânsito** (proxy de prontuário/mensagens/humor). Atrito direto com a postura "dado no Brasil" (ADR-008/044). Mitigado por `gru1` (processamento no Brasil) + DPA + base legal de transferência (LGPD art. 33) + garantia de não-log de corpo — **não eliminado**. Exige **DPA assinado e base de transferência definida como bloqueadores do cutover**, além de registro de suboperador no RoPA e revisão da DPIA/RIPD.
- **Custo:** Vercel Pro (~$20 + uso) passa a ter função real; em troca remove o ASG+ALB do web (~$35/mês). O crédito AWS expirou (jun/2026), então a economia de infra é líquida.
- **Cold start** volta a ser um vetor (foi o motivo da saída anterior) — mitigado por Fluid Compute; registrar como gatilho de revisão se reaparecer.

## Guardrails clínicos / LGPD respeitados

- **Regra 3 (sem log de conteúdo clínico cru) estendida à Vercel.** Auditado: `lib/gateway.ts`, `lib/gateway-paciente.ts`, `lib/teleconsulta-proxy.ts` e `app/api/paciente/conversation/route.ts` **não logam corpo** (SDP/ICE/mensagem). Confirmar que nenhuma observability da Vercel capture corpo de SSE/proxy.
- **Dado em repouso não se move** — segue cifrado no RDS sa-east-1 (ADR-018/054). A migração toca só o BFF (trânsito).
- **`gru1`** mantém o processamento no Brasil; sem `functionFailoverRegions` para fora do país.
- **Trilhas de auditoria** (Regra 5) intactas — vivem no gateway/RDS, não no web.

## Alternativas rejeitadas

- **Mover o `checkup` em vez do `web`.** Rejeitada: o checkup fala Postgres **cru** num RDS **privado** (sem `PubliclyAccessible`); a Vercel externa não alcança sem expor o RDS (regressão) ou Secure Compute/PrivateLink (Enterprise). É exatamente o que o ADR-052 decidiu — não reabrir.
- **Manter `web` no EC2.** Rejeitada: deixa o Vercel Pro ocioso, mantém o cold start, e não dá a separação front/backend que o dono quer. A opção VPC-privada do gateway, único ganho de manter, nunca foi exercida.
- **Vercel Secure Compute (egress estático) p/ IP-allowlist do gateway.** Rejeitada agora: tier Enterprise, over-engineering — o header secreto resolve o egress dinâmico a custo ~zero. Gatilho de revisão se o header se mostrar insuficiente.

## Gatilhos de revisão

- Cold start voltar a degradar UX do dashboard/portal mesmo com Fluid Compute.
- Falha recorrente de SSE (conversa/teleconsulta) sob os limites de Function da Vercel.
- Mudança na base legal de transferência internacional, ou exigência regulatória de residência estrita (processamento no Brasil obrigatório) → reavaliar voltar o BFF para a AWS.
- Vercel oferecer egress estático acessível (reabre a opção de IP-allowlist do gateway).
- Encerramento do Vercel Pro / mudança de custo que inverta a vantagem econômica.
