# Units systemd do box clínico (ADR-077 — backup/restore-test do Postgres)

O host usa systemd timers (não há crontab — mesmo padrão do watchdog de crise).
Os scripts são instalados em `/usr/local/sbin` (cópia, não symlink: o repo no box
troca de commit a cada deploy) e as units em `/etc/systemd/system`.

## Instalação / atualização (via SSM, como root)

```bash
cd /opt/cerebro-amigo-v3
install -m 0755 infra/scripts/backup-postgres.sh /usr/local/sbin/backup-postgres.sh
install -m 0755 infra/scripts/test-restore.sh   /usr/local/sbin/test-restore.sh
install -m 0644 infra/systemd/cerebro-db-backup.service      /etc/systemd/system/
install -m 0644 infra/systemd/cerebro-db-backup.timer        /etc/systemd/system/
install -m 0644 infra/systemd/cerebro-db-restore-test.service /etc/systemd/system/
install -m 0644 infra/systemd/cerebro-db-restore-test.timer   /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now cerebro-db-backup.timer cerebro-db-restore-test.timer
```

## Agenda

| Timer | Quando | O quê |
|---|---|---|
| `cerebro-db-backup.timer` | diário 03:30 (America/Sao_Paulo) | `backup-postgres.sh` → `s3://cerebro-amigo-db-backups/postgres/daily/` (dom. também `weekly/`) |
| `cerebro-db-restore-test.timer` | domingo 05:00 (America/Sao_Paulo) | `test-restore.sh` — restaura o último backup em container efêmero e valida |
| `cerebro-pg-metrics.timer` | a cada 1 min | `pg-metrics.sh` — 12 métricas → CloudWatch `Cerebro/Postgres` (role `cerebro_monitor`/pg_monitor). Instalar também `install -m 0755 infra/scripts/pg-metrics.sh /usr/local/sbin/` + as units `cerebro-pg-metrics.*` |

## Alarmes CloudWatch (SNS `cerebro-amigo-piloto-alertas`)

`cerebro-pg-down` (PgUp<1, 2×60s, missing=breaching — pega coletor morto) ·
`cerebro-pg-data-disk-80` · `cerebro-pg-backup-stale` (>26h) ·
`cerebro-pg-restore-test-fail` · `cerebro-pg-oom-kills` · `cerebro-ec2-cpu-credits-low`
(<100). Dashboard: `cerebro-postgres` (fonte: `infra/aws/cw-dashboard-postgres.json`).
Simulação de falha validada em 2026-07-06 (stop → ALARM ~3 min → start → OK).
DR: `docs/runbooks/dr-postgres-selfhosted.md` (DLM `policy-01097c211c589bac5`, retenção 7).

## Observabilidade (pluga no alerta P7)

- Sucesso do backup: `s3://cerebro-amigo-db-backups/postgres/last-success` (timestamp).
- Falha do backup: `/var/lib/cerebro-backup/last-error` + objeto `last-error` no prefixo.
- Resultado do restore-test: `/var/lib/cerebro-backup/last-restore-test` + objeto `last-restore-test` (`PASS`/`FAIL`).
- Alarme futuro: staleness de `last-success` > 26 h ⇒ backup parou.

Execução manual: `systemctl start cerebro-db-backup.service` / `cerebro-db-restore-test.service`
(logs: `journalctl -u cerebro-db-backup.service -n 50`).
