# ADR-079 — Relançamento do stack clínico em box único EC2 (pós-teardown)

- **Status:** aceito (2026-07-15)
- **Decisores:** Patrick Arinelli
- **Contexto relacionado:** ADR-078 (checkup em box único — padrão espelhado),
  ADR-077 (Postgres self-hosted em container), ADR-076 (web permanece fora da
  Vercel por LGPD — **reafirmado aqui**), ADR-074 (X-Edge-Auth), ADR-044 (Anthropic
  API direta), ADR-018 (cifragem em repouso)

## Contexto

O teardown de 2026-07-09 desligou toda a infra do produto clínico (EC2, ALB/ASG,
CloudFront, ECR, RDS, SSM params). O checkup foi relançado sozinho em box único
(ADR-078). Decisão agora: **relançar o produto principal (www.cerebroamigo.com.br)**
no mesmo formato de custo mínimo — o Savings Plan `6c71ed92` (família t3,
sa-east-1, pago até 2027-06-18) torna o compute marginalmente gratuito.

Antes do teardown, o stack clínico **já rodava no Postgres self-hosted** (cutover
ADR-077 concluído em 2026-07-06; o gate de observação de 72h venceu exatamente em
07-09). Este ADR re-executa aquele formato final, sem RDS.

**Frontend na Vercel foi considerado e descartado de novo:** o ADR-076 (Patrick +
Adonai) vetou o BFF na Vercel porque dado de saúde em trânsito sairia do controle
nacional (operadora US = transferência internacional, art. 33 LGPD). Nada mudou
nesse cenário; o web roda no box, e a Vercel segue apenas com a zona DNS.

## Decisão

Box único **t3.medium** (`cerebro-clinical-box`) em sa-east-1, coberto pelo
Savings Plan, com `docker compose` (`infra/clinical-box/`):

- **5 serviços clínicos** (web, api-gateway, orchestrator-py, agents-py,
  notifier-py) buildados **no próprio box** (source via tarball no S3; sem
  ECR/CI — o `deploy.yml` fica órfão até revisão). Limites de memória/CPU do
  ADR-009/077 mantidos (postgres = caminho de crise, protegido de vazamento).
- **postgres** — `pgvector/pgvector:0.8.4-pg16`, volume EBS dedicado cifrado em
  `/data/postgres`, TLS self-signed (cert em `/data/pgcerts`), **banco
  `cerebro_v3` ZERADO** das migrations versionadas (0001..0060, exceto as do
  schema `checkup`), controle em `schema_migrations`. Roles least-privilege:
  `cerebro_gateway` (NOBYPASSRLS — RLS de tenant vale) e `cerebro_workers`
  (BYPASSRLS), senhas via SSM. Dados antigos ficam recuperáveis no snapshot
  final do RDS (`cerebro-postgres-enc-final-teardown-2026-07-09`) e nos
  snapshots EBS diários até 07-09 — **desde que a `ENCRYPTION_KEY` antiga
  (ADR-018) seja localizada**; a chave nova NÃO decifra o histórico.
- **caddy** — TLS automático (Let's Encrypt): `www.` → web:3000, apex → redirect
  301, `api.` → api-gateway:5000 (público por causa do webhook Asaas;
  `X-Edge-Auth` fail-closed cobre o resto — hardening do ADR-074 mantido).
- **coturn** — profile `turn` ativo (teleconsulta ADR-026); SG abre 3478 +
  UDP 49152-49251.
- **Checkup intocado** no box dele (ADR-078) — isolamento clínico ⇄ público
  (regra #4 do checkup) é a razão de NÃO consolidar os dois num box só.
- **DNS** — zona na Vercel: `www`, apex e `api` = A → EIP novo do box.
- **Segredos** — SSM SecureString sob `/cerebro-amigo/clinical/*`, todos
  **regenerados** (os antigos morreram no teardown): jwt-secret,
  internal-api-token, encryption-key (nova), edge-auth-secret, db-*-password,
  vapid-*-key (par novo — subscriptions antigas de push morrem), turn-secret,
  anthropic-api-key (mesmo valor do checkup). `deploy.sh` injeta; `.env` no box
  é derivado, não fonte.
- **Backup** — systemd timer diário `pg_dump | gzip → s3://cerebro-amigo-db-backups/postgres/clinical/`
  (07:45 UTC). Parte obrigatória do deploy: é a única cópia fora da instância.
- **Buckets de áudio** recriados com os MESMOS nomes pré-teardown
  (`cerebro-amigo-audio-sa-east-1` efêmero 1d, `cerebro-amigo-audio-msgs` 60d,
  `cerebro-amigo-social`) para casar com as policies existentes da role.
- **Gestão** — sem SSH; SSM Session Manager/send-command. SG expõe 80/443 + TURN.

## Consequências

- Custo marginal ≈ **US$8-12/mês** (EIP + EBS 50 GB + S3); compute no SP.
- Sem HA: box único é SPOF — aceito (postura piloto, mesmo racional ADR-043/078).
  Multi-box/ALB se tração exigir.
- Push subscriptions e sessões antigas inválidas (VAPID/JWT novos) — esperado
  com banco zerado.
- **Pendências para funcionalidade completa** (features fail-closed/off até lá):
  1. `RESEND_API_KEY` — e-mail (convites, magic-link) OFF até param existir
     (`/cerebro-amigo/clinical/resend-api-key`).
  2. `ASAAS_API_KEY`/`ASAAS_WEBHOOK_TOKEN` — cobrança OFF; re-apontar webhook no
     painel Asaas para `https://api.cerebroamigo.com.br/api/v1/asaas/webhook`.
  3. `INFOSIMPLES_TOKEN` — validação CRM em bypass (`crm_situacao='NaoValidado'`).
  4. `TURNSTILE_*` — captcha do signup OFF (flag-gated).
  5. **T0-7 (gates do Adonai)** — `CRISIS_RESILIENCE_ENABLED` segue `false` até
     atestação clínica (lista de termos + copy).
  6. Observabilidade zero (sem CloudWatch alarms/Sentry) — recriar o mínimo do
     piloto (alarme de health + SNS) quando houver uso real.
  7. IAM: conferir na role as permissions de Transcribe (escriba/diário) e
     Bedrock invoke (embeddings RAG) — se ausentes, features degradam e a
     correção exige grant do operador (política: mudança IAM pede ok do Patrick).
- Migrations novas entram por `init-db.sh` (tabela `schema_migrations`) a cada
  deploy — o fluxo `dotnet ef database update` do dev local não muda.
