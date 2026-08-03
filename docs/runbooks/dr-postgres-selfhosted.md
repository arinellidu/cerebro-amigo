# DR — Postgres self-hosted (ADR-077) · alvo RTO 1h / RPO 24h

Camadas de recuperação, da mais rápida à mais profunda. Pré-requisitos permanentes:
dump diário no S3 (`s3://cerebro-amigo-db-backups/postgres/daily/`, testado semanalmente),
snapshot DLM diário do volume `cerebro-postgres-data` (retenção 7, `policy-01097c211c589bac5`),
alarmes CloudWatch → SNS `cerebro-amigo-piloto-alertas`.

> ⚠️ **Pré-requisito crítico fora do git:** o `.env` do box (senhas `PG_LOCAL_*`,
> `POSTGRES_LOCAL_PASSWORD`, tokens). Sem cópia dele, o RTO de perda total do box não
> fecha em 1h. Manter cópia manual segura (ex.: SSM SecureString atualizado a cada
> mudança de senha — fazer por operador humano; pendência registrada).

## Cenário A — container/postgres corrompido, volume íntegro (RTO ~10 min)

1. `docker compose stop postgres` (apps degradam; caminho de crise fora — comunicar).
2. Investigar (`docker logs`, `journalctl -k` p/ OOM). Se dado íntegro: subir de novo.
3. Se PGDATA corrompido: `mv /data/postgres/* /data/postgres.quarentena/` →
   `docker compose up -d postgres` (initdb novo) → restaurar dump mais recente do S3
   (mesmo fluxo do `test-restore.sh`, direção produção): roles (`.env`) → databases →
   extensões → `pg_restore -j 2` → grants (`docs/migration/02-validacao-dados.md`).
4. Validar contagens vs manifesto do backup + smoke (login 401 via gateway).

## Cenário B — volume EBS perdido/corrompido (RTO ~20–30 min)

1. Escolher o snapshot DLM mais recente do volume `cerebro-postgres-data`:
   `aws ec2 describe-snapshots --owner-ids self --filters Name=tag:Name,Values=cerebro-postgres-data --query "sort_by(Snapshots,&StartTime)[-1]"`.
2. `aws ec2 create-volume --snapshot-id <snap> --availability-zone sa-east-1a --volume-type gp3 --encrypted` (+ tag `Name=cerebro-postgres-data` — a tag mantém o DLM cobrindo o volume novo).
3. Detach do volume antigo (se presente), attach do novo em `/dev/sdf`;
   `infra/scripts/setup-data-volume.sh` remonta (idempotente; detecta o device e NÃO formata — guarda blkid).
4. `docker compose up -d postgres` → healthcheck → smoke. Dados = estado do snapshot
   (RPO ≤ 24h; o dump diário do S3 pode ser mais novo — comparar `last-success` e, se for,
   preferir Cenário A passo 3 com o dump).

## Cenário C — instância EC2 perdida (RTO ~45–60 min)

1. Lançar EC2 nova: AL2023, **t3.medium**, subnet/AZ `sa-east-1a`, SG `cerebro-app-sg`,
   instance profile `EC2-SSM-CerebroAmigo`, EIP `18.229.175.231` re-associado.
   (Não há AMI customizada — o provisionamento é leve: `dnf install docker git` +
   plugin compose + login ECR. Se o RTO apertar no futuro: criar AMI dourada.)
2. `git clone` do repo em `/opt/cerebro-amigo-v3` + restaurar `.env` da cópia segura.
3. Volume de dados: attach do volume existente (se a AZ bater) ou Cenário B a partir do
   snapshot DLM. Rodar `setup-data-volume.sh` + `setup-swap.sh` (idempotentes).
4. Reinstalar operação: `infra/systemd/README.md` (backup/restore-test/pg-metrics timers).
5. `IMAGE_TAG=<sha vigente> docker compose up -d --no-build` (pull do ECR) → health 6/6 →
   smoke → conferir alarmes voltando a OK.

## Cenário D — região/conta (fora de alvo)

Dumps S3 são a única cópia lógica portátil. Restore em qualquer Postgres 16+:
roles → extensões → `pg_restore`. RTO indefinido (fora do alvo de 1h); aceito para o piloto.

## Pós-recovery (qualquer cenário)

- `test-restore.sh` manual contra o backup mais novo (prova o ciclo de novo).
- Conferir `cerebro-pg-*` alarmes em OK e `PgUp=1` no dashboard `cerebro-postgres`.
- Registrar o incidente e a duração real vs RTO 1h neste runbook.
