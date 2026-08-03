# 01 — Runbook: cutover RDS → container pgvector no EC2

> ## 📍 STATUS (2026-07-06)
> - **Fase 0 ✅** (volume/swap/backup/timers) · **Fase 1 ✅** dados migrados e validados
>   (`02-validacao-dados.md`; janela 20:10→20:14Z) · **Fase 2 ✅ parcial**: stack clínico
>   (web, gateway, orchestrator, agents, notifier) **operando no Postgres local com TLS**
>   desde **20:25Z**; smoke E2E ok (BFF/gateway→banco: login 401 limpo; 6/6 healthy; 0 erros).
> - **⏱️ Observação de 72 h iniciada em 2026-07-06T20:25Z → gate em 2026-07-09T20:25Z.**
> - **⚠️ Checkup ainda no RDS**: a regra de SG (5432 `cerebro-checkup` SG → `cerebro-app-sg`)
>   foi bloqueada pelo modo de permissão da sessão. Para concluir: (1) `aws ec2
>   authorize-security-group-ingress --group-id sg-0f8f950282b292818 --protocol tcp --port 5432
>   --source-group sg-0c240ece2f5c0e46f`; (2) re-dump/restore do schema `checkup` (delta);
>   (3) flip do SSM `/cerebro-amigo/checkup/database-url` (host 172.31.4.97, role `checkup_app`,
>   senha `PG_LOCAL_CHECKUP_PASSWORD` do `.env` do box) + instance refresh. Bind já pronto
>   (`POSTGRES_BIND=172.31.4.97`) e TLS ligado.
> - **↩️ ROLLBACK (vigente durante as 72 h):** no box, `cp .env.pre-adr077 .env` →
>   `IMAGE_TAG=<tag vivo> docker compose up -d --no-build --force-recreate` dos 5 serviços →
>   stack volta ao RDS (vivo, intocado). Escritas locais pós-20:25Z precisam de reconciliação
>   (dump reverso) ou aceite de perda.
> - Gotcha novo: imagem do gateway tinha sido removida por prune → `up` ad-hoc tentou *buildar*
>   no box. Sempre `--no-build` + `docker compose pull <svc>` antes.

> **Decisão:** ADR-077 · **Baseline:** `00-discovery.md` (2026-07-06) · **Alvo:** `pgvector/pgvector:0.8.4-pg16`
> **Princípio do rollback:** até a Fase 4 (descomissionamento), o RDS permanece **intacto e rodando**.
> Rollback de qualquer fase = reapontar as connection strings de volta ao RDS. Só a Fase 4 é irreversível
> (e mesmo ela deixa snapshot final).

**Connection strings envolvidas (3 pontos de flip):**

| Consumidor | Variável | Formato | Onde vive |
|---|---|---|---|
| api-gateway (.NET) | `POSTGRES_DSN` | Npgsql key-value (`Host=...;SSL Mode=Require;Trust Server Certificate=true`) | `.env` do box (`/opt/cerebro-amigo-v3/.env`) |
| orchestrator/agents/notifier (Python) | `POSTGRES_DSN_URL` | URL (`postgresql://...?sslmode=require`) | `.env` do box |
| checkup (ASG separado) | `CHECKUP_DATABASE_URL` | URL | SSM `/checkup/database-url` → exige **instance refresh** do `cerebro-checkup-asg` |

Gotcha permanente: containers **não releem** `.env` em `restart` — todo flip exige
`docker compose up -d --force-recreate` dos serviços afetados.

---

## Fase 0 — Preparo (sem downtime, RDS segue primário)

**Objetivo:** deixar o destino 100% pronto e ensaiado antes de tocar em produção.

1. ADR-077 aprovado; janela da Fase 1/2 agendada (madrugada/fim de semana — a janela
   pausa o caminho de crise; avisar a médica antes, ver Fase 1).
2. **Volume EBS:** `infra/scripts/setup-data-volume.sh` (idempotente) — cria/anexa 20 GB gp3
   **cifrado** na AZ do box, formata xfs (guarda blkid), monta em `/data/postgres` (fstab por
   UUID, `nofail`, owner 999:999). Swap 4 GB + `vm.swappiness=10`: `infra/scripts/setup-swap.sh`.
   ✅ Executados em 2026-07-06 (volume `vol-038c4a52dcf572109`).
3. **Compose:** adicionar serviço `postgres` (branch própria; deploy normal via CI):
   - `image: pgvector/pgvector:0.8.4-pg16`
   - volume `/data/postgres:/var/lib/postgresql/data`
   - bind `172.31.4.97:5432:5432` (IP privado do box — estável em stop/start; **nunca** `0.0.0.0`)
   - TLS ligado: gerar cert self-signed no volume, `-c ssl=on` (os DSNs atuais usam
     `sslmode=require`/`Trust Server Certificate=true` — funcionam sem CA pública)
   - tuning cenário A do discovery §7.2: `shared_buffers=256MB`, `max_connections=120`
   - `mem_reservation: 512m`, `mem_limit: 1g`, healthcheck `pg_isready`
   - senha do superuser `postgres` local: **nova**, gravada em SSM SecureString (nunca no compose)
4. **SG:** ingress TCP 5432 no `cerebro-app-sg` **restrito a** `sg-0c240ece2f5c0e46f` (checkup)
   — os containers locais falam via rede do compose/IP privado, não precisam de regra.
5. **Globals e roles:** no RDS, `pg_dumpall --globals-only` como `cerebroadmin`; aplicar no
   container **removendo roles `rds_*`**; recriar `cerebroadmin`, `cerebro_gateway`,
   `cerebro_workers` (BYPASSRLS), `checkup_app` com as senhas vigentes do SSM.
6. **Backup antes do dado:** `infra/scripts/backup-postgres.sh` (DSN parametrizada — reusar
   no dump do RDS na Fase 1) + `test-restore.sh`, agendados por systemd timers
   (`infra/systemd/`, diário 03:30 + restore-test dom 05:00 BRT) → S3
   `s3://cerebro-amigo-db-backups/postgres/` (SSE-KMS; lifecycle daily/30d, weekly/90d;
   policy `CerebroAmigoDbBackupsS3` no instance profile). Falha/sucesso observáveis em
   `last-error`/`last-success`/`last-restore-test` (pluga no alerta P7).
   ✅ Executado 2026-07-06: backup smoke + test-restore PASS, timers ativos.
   Pendente: política DLM de snapshot do volume EBS (segunda camada).
7. **Ensaio geral (dry-run):** dump do RDS → restore no container → validar contagens
   (baseline 00-discovery §2.4), `\dx`, `pg_policies`; rodar `apps/api-gateway-tests`
   apontada para o container. **Executar um restore-test do backup S3** (prova o item 6).
8. Alarmes CloudWatch novos: disco do volume pgdata + memória do box.

**✅ Gate de saída:** dry-run validado + backup S3 restaurável + SG aplicado.

**↩ Rollback Fase 0:** nenhum impacto em produção (RDS intocado, apps nem sabem do container).
Desfazer = remover serviço do compose, desmontar/deletar volume EBS, remover regra SG e cron.

---

## Fase 1 — Migração de dados (janela de manutenção)

**Objetivo:** cópia final consistente. ⚠️ A janela para o caminho de crise (orchestrator
fora do ar) — janela curta (banco tem 352 MB; dump+restore = minutos), horário de menor
risco, médica avisada com antecedência (protocolo: pacientes em situação de crise devem
usar os canais de emergência indicados no app — o texto estático já cobre).

1. **Quiesce:** `docker compose stop web api-gateway orchestrator-py agents-py notifier-py`
   (container `postgres` novo fica up). Pausar temporariamente o scheduler externo do
   checkup-cron se ativo. Confirmar 0 conexões de app no RDS:
   `SELECT count(*) FROM pg_stat_activity WHERE usename LIKE 'cerebro%' OR usename='checkup_app'`.
2. **Baseline fresco:** re-coletar contagens top-20 + `count(*)` de `checkup.funnel_events`
   (como `cerebroadmin`) — anexar ao log da janela. Os números do 00-discovery §2.4 são de
   2026-07-06 e **envelheceram**.
3. **Dump final** (como `cerebroadmin`, direto do box): `pg_dump -Fc cerebro_v3` (+ `cerebro`
   V2 se a decisão do go/no-go foi migrá-lo; senão só arquivar o dump no S3). Copiar dumps
   para S3 **antes** do restore (evidência + insumo de rollback).
4. **Restore** no container: `pg_restore -d cerebro_v3 --no-owner --role=cerebroadmin` —
   conferir 0 erros; `ANALYZE` ao final.
5. **Validação (gate):** contagens do passo 2 batem 100%; `\dx` = pgcrypto/uuid-ossp/vector;
   `SELECT count(*) FROM pg_policies` idêntico ao RDS; roles com atributos certos
   (`cerebro_workers` BYPASSRLS, `cerebro_gateway` sem).

**✅ Gate de saída:** validação 100%. Qualquer divergência → rollback, investigar com calma.

**↩ Rollback Fase 1:** `docker compose start` dos 5 serviços (DSNs ainda apontam para o RDS —
nada foi flipado). Downtime termina; RDS nunca deixou de ser o primário. Custo do rollback: zero.

---

## Fase 2 — Cutover das aplicações (mesma janela, na sequência)

**Objetivo:** flip das 3 connection strings para o container.

1. **Backup dos valores atuais:** copiar `.env` do box (`cp .env .env.pre-adr077`) e anotar o
   valor atual de SSM `/checkup/database-url` (evidência de rollback).
2. **Flip no box:** editar `.env` — `POSTGRES_DSN` (Host=172.31.4.97) e `POSTGRES_DSN_URL`
   (host idem; manter `sslmode=require`). `docker compose up -d --force-recreate` dos 5 serviços.
3. **Smoke clínico:** `/health` + `/ready` dos 4 backends; login médico; abrir um prontuário;
   enviar mensagem de teste no portal paciente (SSE + cifragem ADR-018 no caminho novo);
   conferir gravação em `agente_execucoes`.
4. **Flip do checkup:** atualizar SSM `/checkup/database-url` (host 172.31.4.97) + instance
   refresh do `cerebro-checkup-asg`. Smoke: `GET /api/health` do checkup + funnel-metrics 200
   no Cockpit (BFF clínico).
5. **Reduzir teto do agents-py** (4g → 1g, discovery §7.2-A) no mesmo deploy do compose.
6. **RDS fica up, intocado, sem conexões** — é o botão de rollback pelas próximas 72 h.
   (Verificar `pg_stat_activity` no RDS = só rdsadmin.)

**✅ Gate de saída:** smoke completo verde nos 2 flancos (clínico + checkup).

**↩ Rollback Fase 2:** restaurar `.env.pre-adr077` + valor antigo do SSM → `--force-recreate`
+ instance refresh. Voltou ao RDS em minutos. **Atenção:** escritas feitas no container entre
o flip e o rollback **não estão no RDS** — quanto mais tarde o rollback, maior a janela a
reconciliar (dump reverso das tabelas tocadas ou aceite documentado da perda). Por isso a
observação da Fase 3 é ativa, não passiva.

---

## Fase 3 — Observação (72 h)

**Objetivo:** confiança operacional antes de queimar a ponte.

- **T+2 h e T+24 h:** revisar logs dos 5 serviços (`/cerebro/*` no CloudWatch) por erros de
  conexão/SSL/RLS; conferir latência percebida no dashboard.
- **T+24 h e T+48 h:** confirmar que o backup diário rodou e o objeto chegou no S3; no
  T+48 h, **restore-test** do backup mais recente num container efêmero (contagens batem).
- **T+72 h:** conferir alarmes (disco pgdata, memória, health) silenciosos; `docker stats`
  dentro do orçamento (§7.2-A); zero conexões no RDS o período todo.
- Congelamento: nenhum deploy estrutural/migration nova durante as 72 h (mudança de app ok).

**✅ Gate de saída:** 72 h limpas + 2 backups diários verificados + 1 restore-test pós-cutover.

**↩ Rollback Fase 3:** idêntico ao da Fase 2 (flip reverso), com a mesma ressalva de
reconciliação — agora potencialmente 1–3 dias de escritas no container. O dump diário no S3
é o insumo para levar esses dados de volta ao RDS se necessário.

---

## Fase 4 — Descomissionamento do RDS (ponto de não-retorno)

**Objetivo:** parar de pagar. Só executar com todos os gates anteriores verdes.

1. Re-confirmar: backup S3 do dia + restore-test da Fase 3 ok.
2. **Snapshot final manual:** `cerebro-postgres-enc-final-adr077-<data>` (fica retido; é o
   último rollback possível, com RTO de horas via restore de snapshot).
3. `aws rds stop-db-instance` e **quarentena de 7 dias** parado (storage ainda cobra; instância não).
   Qualquer surpresa nesse período → start + flip reverso.
4. Após a quarentena: desligar `deletion-protection` **somente agora** →
   `delete-db-instance --final-db-snapshot-identifier ...` (redundância do passo 2).
5. Limpeza: deletar snapshot manual órfão `mybestbrain-db-snapshot` (conferir dono antes) e o
   `pre-singleaz-2026-06-21`; remover alarmes CloudWatch do RDS; remover a regra do
   `cerebro-rds-sg` (ou o SG inteiro); deletar o RI/registro morto se houver.
6. **Docs:** atualizar `CLAUDE.md` (stack: "Banco: PostgreSQL (RDS)" → container no EC2),
   `docs/CONTEXT.md`, runbooks de restore/roles (`backup-e-restore.md`, `swap-db-roles.md`)
   e `docs/DEBT.md` (novo item: WAL streaming se RPO apertar).

**↩ Rollback Fase 4:** *antes* do delete = start da instância + flip reverso (com reconciliação
como na Fase 3). *Depois* do delete = restore do snapshot final para um RDS novo (endpoint novo
→ flip dos 3 pontos; RTO de horas). A partir daqui, o caminho de volta oficial é o **gatilho de
reversão do ADR-077** (1º pagante com SLA → managed).

---

## Anexo — comandos de referência

```bash
# Conexões ativas no RDS (deve zerar no quiesce e ficar zero pós-cutover)
SELECT usename, count(*) FROM pg_stat_activity GROUP BY 1;

# Dump final (do box, como cerebroadmin; senha via SSM)
pg_dump -Fc -h cerebro-postgres-enc.ch8u4aig6zs6.sa-east-1.rds.amazonaws.com \
  -U cerebroadmin -d cerebro_v3 -f /tmp/cerebro_v3-final.dump
pg_dumpall --globals-only -h <rds> -U cerebroadmin > /tmp/globals.sql   # remover roles rds_*

# Restore no container
docker exec -i <postgres> pg_restore -U postgres -d cerebro_v3 --no-owner --role=cerebroadmin < /tmp/cerebro_v3-final.dump

# Flip checkup
aws ssm put-parameter --name /checkup/database-url --type SecureString --overwrite --value 'postgresql://checkup_app:<pw>@172.31.4.97:5432/cerebro_v3?sslmode=require'
aws autoscaling start-instance-refresh --auto-scaling-group-name cerebro-checkup-asg

# Descomissionamento (Fase 4, e só nela)
aws rds create-db-snapshot --db-instance-identifier cerebro-postgres-enc --db-snapshot-identifier cerebro-postgres-enc-final-adr077-$(date +%Y%m%d)
aws rds stop-db-instance --db-instance-identifier cerebro-postgres-enc
aws rds modify-db-instance --db-instance-identifier cerebro-postgres-enc --no-deletion-protection --apply-immediately
aws rds delete-db-instance --db-instance-identifier cerebro-postgres-enc --final-db-snapshot-identifier cerebro-postgres-enc-final2-adr077
```
