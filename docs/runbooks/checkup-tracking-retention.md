# Runbook — Check-up longitudinal: retenção, envio e erasure (ADR-050 Parte 2)

> **Cérebro Amigo** · https://www.cerebroamigo.com.br · Check-up Mental: https://checkup.cerebroamigo.com.br

Operação do acompanhamento longitudinal **pseudonimizado** do Check-up (schema `checkup`,
tabelas `tracking_series` / `tracking_points` / `tracking_reminders`). Dado de saúde
categoria especial — **minimização e retenção limitada são obrigatórias** (LGPD).

## Estado

A Parte 2 está **dark/inerte** até ser ligada. Enquanto `NEXT_PUBLIC_CHECKUP_TRACKING_ENABLED != "true"`,
o opt-in (`POST /api/tracking`) e o envio (`POST /api/tracking/cron`) respondem **404** e nada é coletado.

## Ligar a feature (pré-condições)

1. **SES production-access (CK-4)** aprovado em `sa-east-1` (envio de e-mail real). Sem isso o
   `cron` roda mas o envio falha e o reminder é retentado (sem efeito colateral).
2. Setar no SSM do checkup (ASG) — **nunca commitar**:
   - `CHECKUP_ENCRYPTION_KEY` (SecureString) — cifra/decifra `email_enc` (pgp_sym, padrão ADR-018).
   - `CHECKUP_CRON_TOKEN` (SecureString) — Bearer dos endpoints de scheduler (cron + retention).
   - `NEXT_PUBLIC_CHECKUP_TRACKING_ENABLED=true` — liga opt-in + cron.
   - `CHECKUP_TRACKING_RETENTION_DAYS` (opcional; default **365**).
3. Aplicar a migration **0044** no RDS `cerebro_v3` (cria as 3 tabelas + extensão `pgcrypto`).
   Via box/Session Manager, forçando `PGDATABASE=cerebro_v3` (o `.env` do box é stale).

> **Cuidado com a chave:** rotacionar `CHECKUP_ENCRYPTION_KEY` torna os `email_enc`
> existentes indecifráveis → reminders pendentes ficam não-enviáveis. Rotacione só com
> uma estratégia de re-cifragem ou aceitando perder os pendentes.

## Schedulers (EventBridge / cron externo → HTTP)

Dois jobs POST autenticados por `Authorization: Bearer $CHECKUP_CRON_TOKEN`:

| Job | Endpoint | Cadência sugerida |
|-----|----------|-------------------|
| Envio do nudge | `POST /api/tracking/cron` | de hora em hora |
| Purga de retenção | `POST /api/tracking/retention` | diária |

Disparo manual (do box, contra o domínio do checkup):

```bash
curl -s -X POST https://checkup.cerebroamigo.com.br/api/tracking/cron \
  -H "Authorization: Bearer $CHECKUP_CRON_TOKEN"
# → {"processed":N,"sent":N,"failed":N}

curl -s -X POST https://checkup.cerebroamigo.com.br/api/tracking/retention \
  -H "Authorization: Bearer $CHECKUP_CRON_TOKEN"
# → {"purged":N,"retentionDays":365}
```

O `cron` decifra o e-mail **só in-memory** no disparo, envia o template **fixo** (sem LLM,
sem escore) e marca `sent_at` por linha (idempotente; falha retenta). A `retention` faz
**DELETE real com CASCADE** das séries inativas há mais de `retentionDays`
(`COALESCE(last_seen_at, created_at) < now() - retentionDays`).

## Erasure (direito do titular — LGPD)

- **Self-service (preferido):** todo e-mail traz link **"apagar meus dados"** → página
  `/descadastrar?t=<series_token>` → `POST /api/tracking/erase` → DELETE CASCADE da série.
  E há **"cancelar lembretes"** (`/api/tracking/unsubscribe?t=`) — só para de enviar, não apaga.
- **Manual (suporte):** a série é **pseudônima** — não há lookup por e-mail (só `bcrypt` em
  `email_hash`). Se a pessoa fornecer o **link/token**, apague por `series_token`:

  ```sql
  -- via box → psql no RDS cerebro_v3 (schema checkup)
  DELETE FROM checkup.tracking_series WHERE series_token = '<token>';  -- CASCADE pontos+reminders
  ```

  Sem o token não dá para localizar a série de uma pessoa (é o objetivo do design — minimização).
  Oriente o titular a usar o link do e-mail.

## Pausar a feature

Setar `NEXT_PUBLIC_CHECKUP_TRACKING_ENABLED=false` → opt-in e cron voltam a 404 (não coleta,
não envia). A `retention` **continua** funcionando (limpeza não depende da flag) — deixe os
schedulers ativos para a purga continuar mesmo com a feature pausada.

## Verificação rápida (smoke)

`apps/checkup/scripts/smoke.sh` cobre o contrato **dark**: opt-in e cron → 404, retention sem
token → 503, `/evolucao` e `/descadastrar` → 200.
