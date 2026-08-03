# ADR-073: Abstração de e-mail por `EMAIL_PROVIDER` no notifier-py (Resend primário, SES atrás da flag)

**Status:** Accepted
**Data:** 2026-06-22
**Decisores:** Patrick Arinelli, Adonai Arinelli
**Categoria:** Stack / Infra / E-mail
**Espelha:** ADR-044 / ADR-015 (LLM provider-switchável por `LLM_PROVIDER`)
**Relaciona:** ADR-041 (entrega garantida do alerta de crise), ADR-018 (cifragem/LGPD), ADR-050 (nudge longitudinal do checkup, dep. SES CK-4), ADR-022 (notificação externa de crise)

## Contexto

O `notifier-py` envia e-mail em **dois caminhos**:

1. **Fallback de push** (`email_fallback.py`) — quando nenhum device recebe o push de check-in, o lembrete vai por e-mail (peso clínico: lembrete de medicação não pode sumir).
2. **Alerta de crise ao médico** (`medico_notify.py`, ADR-041 Fase 1) — estágio 0/1 da escada de entrega garantida.

Ambos batiam **direto na Resend REST API**, com a chamada `httpx` duplicada e sem abstração de provider. Não havia caminho SES.

O caminho AWS-nativo seria **Amazon SES in-region** (`sa-east-1`, residência LGPD, auth por IAM role) — mas a conta SES está em **sandbox** (`ProductionAccessEnabled=false`) e o domínio `cerebroamigo.com.br` **não está verificado no SES**. Isso é o bloqueio **CK-4** (SES production-access), do qual o nudge longitudinal do checkup (ADR-050 Parte 2) também depende.

O projeto já tem o padrão consolidado de **LLM provider-switchável por env** (`LLM_PROVIDER`, ADR-044/015): os call-sites são cegos ao provider, uma factory resolve o transporte, auth é validada no client. Faz sentido **espelhar esse padrão para e-mail**.

## Decisão

**Abstrair o envio de e-mail do notifier-py atrás de uma flag `EMAIL_PROVIDER`, com Resend como provider primário/vigente e SES como alternativa atrás da flag.**

1. **Client unificado** `app/core/email.py`:
   `async def send_email(*, to, subject, text) -> tuple[bool, str]`. Os call-sites chamam só `send_email(...)` e **não sabem** qual provider está ativo.
2. **Flag** `EMAIL_PROVIDER ∈ {resend, ses}`, **default e vigente `resend`**.
3. **Resend (PRIMÁRIO)** — REST, auth `RESEND_API_KEY`. Domínio `cerebroamigo.com.br` **verificado no Resend** (region `sa-east-1`), **DKIM** publicado (`resend._domainkey`) e **SPF** no subdomínio `send` (`v=spf1 include:amazonses.com ~all`). **Confirmado por envio e2e em 2026-06-22** (HTTP 200, `id=d962a066-…`).
4. **SES (ALTERNATIVA atrás da flag)** — SES v2 in-region (`sa-east-1`, LGPD), auth por IAM role do EC2/ASG, via `boto3`. **INATIVO / bloqueado por CK-4** (sandbox + domínio não verificado). Não promover sem **novo ADR** e SES production-access.
5. **Refator dos 2 call-sites** (`email_fallback`, `medico_notify._enviar_email`) para chamar `send_email`, **preservando o contrato `(ok, detalhe)`**. O `detalhe` é SEM PII (id da mensagem em sucesso; código de status em falha) e alimenta `crise_alerta_eventos.detalhe`.
6. **Divergência deliberada do client LLM:** e-mail é canal **best-effort** (push é o primário), então o client **degrada graciosamente** em vez de fail-fast no startup. Config ausente/SDK faltando → `(False, "<codigo>")` + log, nunca derruba o serviço. A escada de crise (ADR-041) **já escala por TEMPO** quando o e-mail cai — config de e-mail ausente não prende a escada nem deixa o paciente descoberto.

### Guardrails clínicos / LGPD respeitados

- **Nunca** logar destinatário, assunto ou corpo (PII / possível conteúdo clínico) — só metadados e código de status sem PII. (Regra 4.)
- Não altera as tabelas de auditoria nem a lógica da escada (ADR-041) — só o **transporte**. A escada continua decidindo por `ok`/eventos, nunca pelo texto do `detalhe`. (Regra 5.)
- SES, quando ligado, é in-region `sa-east-1` (residência de dado).
- O texto de crise segue **literal** (`medico_notify._corpo_email`, sem citar detalhe clínico) — abstração de e-mail não toca conteúdo. (Regra 2.)

## Consequências

- **+** Trocar de provider = mudar **uma env var**; SES fica pronto para ligar assim que o CK-4 liberar (production-access + verificação de domínio).
- **+** Lógica de e-mail num único lugar; os 2 call-sites ficam finos. Testes de provider switch (`tests/test_email_client.py`) cobrem resend (sucesso/erro/sem-chave), ses (sucesso/erro) e default.
- **+** `boto3` adicionado ao `notifier-py` para o caminho SES funcionar quando flipado (imagem cresce um pouco; aceitável).
- **−** **DMARC ainda ausente** no domínio. SPF (do subdomínio `send`) e DKIM já estão no ar; falta publicar o registro DMARC na zona DNS (hoje na **Vercel**):
  `_dmarc.cerebroamigo.com.br  TXT  "v=DMARC1; p=none; rua=mailto:dmarc@cerebroamigo.com.br; fo=1"`
  Começar em `p=none` (monitor) e endurecer para `quarantine`/`reject` depois de observar os relatórios.
- **Escopo:** o e-mail do **api-gateway .NET** (magic-link, etc.) **não** entra neste ADR — segue com seu próprio Resend. A abstração é só do `notifier-py`. Unificar o gateway é trabalho futuro, se desejado.
