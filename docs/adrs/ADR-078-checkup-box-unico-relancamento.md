# ADR-078 — Relançamento do Check-up Mental em box único EC2 (pós-teardown)

- **Status:** aceito (2026-07-15)
- **Supersede na prática:** ADR-045 (ALB + ASG dedicados do checkup) enquanto o produto estiver relançado sozinho
- **Contexto relacionado:** ADR-044 (Anthropic API direta), ADR-077 (Postgres self-hosted em container)

## Contexto

Em 2026-07-09 toda a infra AWS do projeto foi desligada (teardown completo: EC2, ALB/ASG,
CloudFront, ECR, RDS, SSM params — fim do crédito promocional; fatura cheia inviável no
momento). Sobraram: snapshot final do RDS (`cerebro-postgres-enc-final-teardown-2026-07-09`),
snapshots EBS diários e o **Savings Plan EC2 `6c71ed92` (família t3, sa-east-1), ativo e
pago até 2027-06-18** — ~US$56/mês sendo cobrados com zero instância rodando.

Decisão do produto: relançar **somente** o `apps/checkup` (superfície pública anônima,
motor de aquisição), em `checkup.cerebroamigo.com.br`. Uma proposta de migrar para Azure
foi descartada na mesma conversa (Savings Plan já pago torna o compute AWS marginalmente
gratuito; regra do projeto é AWS-only; reintroduzir Azure exigiria novo ADR e nova análise
LGPD).

## Decisão

Box único **t3.small** (`cerebro-checkup-box`, i-08352f5021f7595fd) em sa-east-1, coberto
pelo Savings Plan, com `docker compose` (`infra/checkup-box/`):

- **checkup** — imagem buildada no próprio box (source via tarball no S3; sem ECR).
  `network_mode: host`, bind em `127.0.0.1:3001`.
- **db** — `postgres:16-alpine`, volume local, porta publicada só em loopback.
  Banco `checkup`, schema `checkup` recriado **zerado** das migrations versionadas
  (0039, 0040, 0042, 0044, 0059, 0061); role `checkup_app` com menor privilégio.
  Histórico antigo do funil segue recuperável no snapshot final do RDS.
- **caddy** — TLS automático (Let's Encrypt), vhost `checkup.` + redirect 301 de
  `www.checkup.`. Substitui CloudFront+ALB. `CHECKUP_TRUSTED_PROXY_HOPS=1`.
- **DNS** — zona na Vercel: `checkup` e `www.checkup` = A → EIP `54.94.33.65`.
- **Segredos** — SSM Parameter Store SecureString sob `/cerebro-amigo/checkup/*`
  (anthropic-api-key, db-password, db-superuser-password, metrics-token), lidos pelo
  `deploy.sh` no box via role `EC2-SSM-CerebroAmigo` (reaproveitada; nenhuma mudança IAM).
- **Backup** — systemd timer diário `pg_dump | gzip → s3://cerebro-amigo-db-backups/postgres/checkup/`
  (bucket recriado com o MESMO nome para casar com a policy já existente na role).
- **Gestão** — sem SSH; só SSM Session Manager/send-command. SG expõe apenas 80/443.

Tracking longitudinal permanece **dark** (`NEXT_PUBLIC_CHECKUP_TRACKING_ENABLED=false`,
sem `CHECKUP_ENCRYPTION_KEY`/`CHECKUP_CRON_TOKEN` → rotas fail-closed, como desenhado).

## Consequências

- Custo marginal ≈ **US$6-8/mês** (EIP IPv4 + EBS 20 GB + S3), compute já pago pelo SP.
- Sem HA e sem escala horizontal: box único é SPOF — aceito para a fase atual (postura
  piloto, mesmo racional do ADR-043 Adendo). Voltar a ALB+ASG (ADR-045) se tração exigir.
- DB local ao box: o backup diário para S3 é a única cópia fora da instância — o timer é
  parte obrigatória do deploy, não opcional.
- Deploy manual (tarball S3 + `deploy.sh` via SSM); o job `deploy-checkup` do GitHub
  Actions (ECR + instance refresh do ASG) fica órfão até revisão do CI.
- Cockpit clínico de aquisição continua fora do ar (o resto do sistema segue desligado);
  `CHECKUP_METRICS_TOKEN` já provisionado para religamento futuro.
