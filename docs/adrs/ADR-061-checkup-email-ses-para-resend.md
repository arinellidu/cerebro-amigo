# ADR-061 — E-mail transacional do checkup: AWS SES → Resend

- **Status:** Accepted
- **Data:** 2026-06-16
- **Decisor:** Dono (Patrick).
- **Relacionados:** ADR-050 (checkup longitudinal / nudge), ADR-018 (cifra em repouso),
  CK-4 (DEBT), `clinical-safety` regra #4 (LGPD / dado em sa-east-1), `apps/checkup/CLAUDE.md` regra #3.

## Contexto

O checkup enviava e-mail por **AWS SES sa-east-1** (in-region, via role do EC2/ASG) em dois pontos:
`/api/email-report` (PDF de devolutiva, ativo) e `/api/tracking/cron` (nudge longitudinal, DARK).
O SES exige **production-access** para sair do sandbox (senão só envia a e-mail verificado) — o
pedido ficou em análise/lento, **travando o envio do PDF a qualquer usuário**. O lado clínico já
usa **Resend** para todo e-mail transacional (magic-link, alerta de crise ao médico, onboarding).

## Decisão

Trocar o provider de e-mail do checkup de **SES → Resend**, via helper único
`apps/checkup/src/lib/email/resend.ts` (POST `https://api.resend.com/emails`, Bearer
`RESEND_API_KEY`; PDF como anexo base64). `EMAIL_FROM` opcional (default
`Check-up Mental <noreply@cerebroamigo.com.br>`). Os dois endpoints passam a usar o helper;
o nudge segue **DARK** (flag `NEXT_PUBLIC_CHECKUP_TRACKING_ENABLED`).

## LGPD / clinical-safety

- **Regra #4 (dado e inferência em sa-east-1) respeitada no que importa:** o **dado-store** do
  checkup (`test_results`, `report_emails`, `tracking_*`) continua **no RDS sa-east-1**, e a
  inferência (Anthropic) é inalterada. O que muda é o **transporte** do e-mail — que já era Resend
  em todo o lado clínico. Não há novo dado em repouso fora do Brasil.
- **Minimização preservada:** envia-se só o e-mail que o usuário informou + o PDF de devolutiva
  (triagem **anônima**, sem PII clínica nominal). E-mail bruto **nunca** gravado: `report_emails`
  guarda só hash bcrypt; o nudge guarda `email_enc` cifrado (pgp_sym, ADR-018) + `email_hash`.
- **Opt-in/consent + unsubscribe + erasure** (ADR-050) inalterados.
- `checkup/CLAUDE.md` regra #3 (anônimo, e-mail em tabela separada sem FK) inalterada.

## Consequências

- Destrava o envio do PDF **sem esperar SES production-access**. CK-4 deixa de depender do SES.
- Requer `RESEND_API_KEY` no SSM/compose do checkup + domínio `cerebroamigo.com.br` verificado no Resend.
- `@aws-sdk/client-sesv2` vira dependência órfã no `package.json` do checkup (cleanup futuro;
  deixada declarada p/ não regenerar o `pnpm-lock` agora — tree-shaking a remove do bundle).
- **Reversível:** o helper é o ponto único de troca de provider. Se no futuro a residência estrita
  do transporte virar requisito, reabrir com SES production-access por novo ADR.
