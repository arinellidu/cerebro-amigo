# ADR-055 — Captcha (Cloudflare Turnstile) no signup público de médico

- **Status:** Accepted
- **Data:** 2026-06-15
- **Relacionados:** ADR-046 (signup externo de médico — a superfície que este ADR protege),
  ADR-017 (validação CRM/CFM via Infosimples — a chamada PAGA que o captcha blinda),
  ADR-008 (AWS-only — Turnstile é SaaS pontual, não muda hosting), skill `dotnet-gateway`, skill `nextjs-bff`.

## Contexto

O ADR-046 abriu o auto-cadastro público de médico (`POST /api/v1/auth/medico/signup`, form
`/medicos/cadastro`). Ao ligar o CTA "Criar conta" na landing `/medico` (antes a única porta na UI
era o QR do checkup), a superfície passa a receber tráfego orgânico/anônimo. Cada signup dispara uma
consulta de CRM no CFM via Infosimples, **paga por consulta**. Sem barreira contra automação, um bot
pode enfileirar cadastros e **queimar orçamento** (além de poluir a base com contas não-verificadas
até o e-mail-verify).

Defesas já existentes (ADR-046): rate-limit por IP, cross-check de nome com o CFM, CRM Regular como
hard gate e e-mail-verify obrigatório. O rate-limit por IP é burlável (XFF spoof / IP rotativo) e é a
única barreira *antes* da chamada paga. Falta um desafio humano antes do gasto.

## Decisão

Adicionar um captcha ao form de signup, verificado **no gateway** antes da consulta ao CFM.

### 1. Provedor: Cloudflare Turnstile
Gratuito (sem custo por verificação). *Privacy-first*: não faz o rastreamento comportamental
cross-site do reCAPTCHA — alinhado ao contexto LGPD/saúde mental. É um SaaS pontual, como Resend
(e-mail) e Infosimples (CRM) já são; **não** altera a postura AWS-only de hosting (ADR-008) nem
reintroduz Azure. Trocável por reCAPTCHA/hCaptcha sem mudança de arquitetura (só o verifier + chaves).

### 2. Verificação no GATEWAY, não só no BFF
O endpoint `/api/v1/auth/medico/signup` é público e chamável direto (burla o BFF do web). A
verificação tem de morar onde o gasto acontece: o gateway (`TurnstileVerifier`) chama o `siteverify`
do Cloudflare **antes** do `CfmClient`. O front coleta o token (widget) e o BFF apenas o repassa.

### 3. Flag-gated pela presença da secret (mesmo padrão do `CRM_VALIDATION_ENABLED`)
Sem `TURNSTILE_SECRET_KEY` o verificador fica **desligado** (devolve `true`) e o form não renderiza o
widget (sem `NEXT_PUBLIC_TURNSTILE_SITE_KEY`). Evita quebrar dev/local e ambientes ainda sem as
chaves; o deploy ativa a proteção setando as duas (gateway + Vercel). As chaves **andam juntas**.

### 4. Fail-closed
Turnstile inalcançável ou token inválido → 403 `captcha_invalido`. Mesmo critério do self-signup
quando o CFM está fora (ADR-046): não cria conta sem validar; o usuário recarrega e tenta de novo.
Fail-open tornaria o captcha decorativo durante um outage; o rate-limit por IP segue como 2ª camada.

## Consequências

- Dependência de um terceiro (`challenges.cloudflare.com`) no front (script + iframe) e no gateway
  (siteverify). Sem CSP restritivo no `next.config.mjs`, não há ajuste de cabeçalho a fazer.
- Duas novas envs: `TURNSTILE_SECRET_KEY` (gateway, SSM SecureString) e
  `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (web/Vercel). Documentadas no `.env.example` e no runbook
  `signup-externo-deploy.md`.
- LGPD: token opaco e efêmero; loga-se só resultado e error-codes, nunca o token nem PII.
- Enquanto as chaves não forem setadas, o comportamento é idêntico ao de hoje (captcha desligado).

## Alternativas consideradas

- **Google reCAPTCHA v3** — rejeitado: rastreamento cross-site e dependência do ecossistema Google,
  pior para LGPD/saúde; o score do v3 ainda exige tuning de threshold.
- **hCaptcha** — viável e privacy-friendly, mas sem vantagem sobre o Turnstile (gratuito e de setup
  mais simples). Fallback se o Turnstile não atender.
- **Só rate-limit (status quo)** — insuficiente: única barreira antes do gasto e burlável.
- **Verificar no BFF** — rejeitado: o endpoint do gateway é público e chamável direto; ficaria burlável.
