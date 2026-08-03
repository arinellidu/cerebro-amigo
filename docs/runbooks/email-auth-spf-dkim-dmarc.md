# Runbook — Autenticação de e-mail (SPF · DKIM · DMARC) do `cerebroamigo.com.br`

**Objetivo:** fechar a proteção contra phishing/spoofing do domínio publicando os 3 registros DNS
de autenticação. **DNS é hospedado na Vercel** (zona `cerebroamigo.com.br`), então os registros
entram no painel Vercel (Domains → `cerebroamigo.com.br` → DNS Records) ou via `vercel dns add`.

> **Por que não é só "ligar DMARC".** O domínio manda e-mail por **dois remetentes**:
> 1. **Google Workspace** (apex `MX = smtp.google.com`) — e-mail humano (`contato@`, etc.).
> 2. **Resend** (transacional: magic link, alerta de crise, PDF/relatório do checkup) — envelope/Return-Path
>    no subdomínio `send.cerebroamigo.com.br`, assinado por DKIM `resend._domainkey`.
>
> Um DMARC em `p=reject`/`quarantine` **agora rejeitaria o e-mail humano da clínica**, porque o
> Google Workspace hoje **não passa SPF nem DKIM alinhados** (ver diagnóstico). Por isso a sequência
> abaixo é faseada: primeiro alinhar o Google, depois subir o DMARC de `none` → `quarantine` → `reject`.

## Diagnóstico do estado atual (medido via `dig` em 2026-06-29)

| Registro | Estado | Observação |
|---|---|---|
| SPF apex (`cerebroamigo.com.br` TXT) | ❌ **ausente** | só há `google-site-verification=…` |
| SPF `send.cerebroamigo.com.br` | ✅ `v=spf1 include:amazonses.com ~all` | Resend/SES — **não mexer** |
| DKIM `resend._domainkey` | ✅ publicado (`p=MIGf…`) | Resend — **não mexer** |
| DKIM `google._domainkey` | ❌ **ausente** | Google Workspace sem DKIM |
| DMARC `_dmarc` | ❌ **ausente** | **buraco principal** |

**Conclusão:** Resend já passa DMARC (DKIM alinhado `d=cerebroamigo.com.br`). **O Google Workspace
não** — falta SPF apex + DKIM do Google. Alinhar os dois **antes** de endurecer o DMARC.

---

## Passo 1 — SPF no apex (autoriza o Google Workspace)

| Campo | Valor |
|---|---|
| Type | `TXT` |
| Name / Host | `@` (apex — `cerebroamigo.com.br`) |
| Value | `v=spf1 include:_spf.google.com ~all` |
| TTL | 3600 |

- O `google-site-verification` existente **coexiste** (são TXT separados). Só pode haver **um** TXT
  começando com `v=spf1` no apex — hoje não há nenhum, então é seguro adicionar.
- **Não** incluir `amazonses.com` aqui: o Resend usa envelope no subdomínio `send.` (já tem SPF
  próprio). O apex só precisa autorizar o Google.

## Passo 2 — DKIM do Google Workspace (gerar no Admin Console, publicar na Vercel)

DKIM do Google **não dá pra inventar** — a chave é gerada no Admin:

1. `admin.google.com` → **Apps → Google Workspace → Gmail → Authenticate email (DKIM)**.
2. Selecionar o domínio `cerebroamigo.com.br` → **Generate new record** (chave **2048-bit**).
3. O Admin mostra um par **Host/Name = `google._domainkey`** e **Value = `v=DKIM1; k=rsa; p=<chave longa>`**.
4. Publicar na Vercel:

| Campo | Valor |
|---|---|
| Type | `TXT` |
| Name / Host | `google._domainkey` |
| Value | `v=DKIM1; k=rsa; p=<colar a chave do Admin>` |
| TTL | 3600 |

5. Voltar no Admin → **Start authentication**. (DNS propaga; pode levar até ~48h, normalmente minutos.)

> Sem este passo, e-mail enviado pelo Google a partir de `@cerebroamigo.com.br` continua **sem DKIM
> alinhado** → seria barrado por DMARC estrito.

## Passo 3 — DMARC em modo monitor (`p=none`)

Começa **sem bloquear**, só coletando relatórios agregados (decidir o endurecimento com dado real).

| Campo | Valor |
|---|---|
| Type | `TXT` |
| Name / Host | `_dmarc` |
| Value | `v=DMARC1; p=none; rua=mailto:dmarc@cerebroamigo.com.br; pct=100` |
| TTL | 3600 |

- **Criar antes** o destino `dmarc@cerebroamigo.com.br` (alias/grupo no Google Workspace) **ou** apontar
  o `rua` para um agregador gratuito (dmarcian / Valimail / Postmark DMARC), que dá dashboard pronto.
- **LGPD (categoria especial — saúde mental):** usar **só `rua`** (relatório agregado: IP, resultado de
  auth, contagem — **sem conteúdo da mensagem**). **Não** configurar `ruf` (relatório forense pode
  carregar cabeçalhos/corpo = PII). Alinhamento **relaxado** (default) na largada — não setar `adkim`/`aspf`.

---

## Passo 4 — Endurecer (depois de 1–2 semanas de relatório limpo)

Só avançar quando os relatórios `rua` mostrarem **Google e Resend passando** e **nenhum remetente
legítimo falhando**:

1. `p=quarantine` (opcional rampa por `pct`): `v=DMARC1; p=quarantine; pct=25; rua=mailto:dmarc@cerebroamigo.com.br`
   → subir `pct` 25 → 50 → 100 ao longo de dias.
2. `p=reject` (postura final): `v=DMARC1; p=reject; rua=mailto:dmarc@cerebroamigo.com.br`
3. Considerar `sp=reject` (política de subdomínio) e `adkim=s; aspf=s` (alinhamento estrito) no fim,
   **depois** de confirmar que checkup (envia From `@cerebroamigo.com.br`) e Resend seguem passando.

## Checklist de verificação (rodar após propagar)

```bash
dig +short TXT cerebroamigo.com.br            # deve listar v=spf1 include:_spf.google.com ~all
dig +short TXT google._domainkey.cerebroamigo.com.br   # v=DKIM1; k=rsa; p=...
dig +short TXT _dmarc.cerebroamigo.com.br     # v=DMARC1; p=none; rua=...
dig +short TXT resend._domainkey.cerebroamigo.com.br   # (já existe — não deve mudar)
dig +short TXT send.cerebroamigo.com.br        # (já existe — v=spf1 include:amazonses.com ~all)
```

Validação fim-a-fim: enviar e-mail de teste do Gmail (`contato@`) e do Resend para uma conta Gmail
externa → **Show original** → conferir `SPF: PASS`, `DKIM: PASS`, `DMARC: PASS` nos dois.

## Resumo dos registros a adicionar (3)

| # | Type | Name | Value |
|---|---|---|---|
| 1 | TXT | `@` | `v=spf1 include:_spf.google.com ~all` |
| 2 | TXT | `google._domainkey` | `v=DKIM1; k=rsa; p=<gerado no Google Admin>` |
| 3 | TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:dmarc@cerebroamigo.com.br; pct=100` |

> **Não** tocar em `resend._domainkey`, `send.*` nem no `google-site-verification` — já corretos.
