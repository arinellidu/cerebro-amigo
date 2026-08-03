# ADR-054 — Cifragem em repouso do RDS clínico (migração para instância KMS-encrypted via snapshot+restore)

**Status:** Accepted
**Data:** 2026-06-14
**Decisores:** Patrick e Adonai Arinelli (cutover executado via `aws ssm send-command` no box, autorizado por Patrick)
**Categoria:** Infra / Segurança clínica / LGPD (categoria especial — saúde mental)
**Relaciona:** ADR-018 (cifragem de coluna — **complementar**, não substituída), ADR-042 (roles/RLS preservadas no snapshot), ADR-053 (Multi-AZ era pré-requisito), ADR-045/ADR-052 (checkup no ASG `cerebro-checkup-asg`), T0-5 do `docs/DEBT.md`

## Contexto

T0-5 do DEBT: o storage do RDS clínico (`cerebro-postgres`, db.t4g.medium) estava **não cifrado** (`StorageEncrypted: false`). A cifragem de coluna do ADR-018 cobre só `mensagens.conteudo`; o resto das tabelas clínicas (prontuários, prescrições, trilhas de auditoria) ficava em **texto claro no disco e em todos os snapshots** — categoria especial LGPD.

O RDS **não liga cifragem in-place**: exige instância nova restaurada de um snapshot cifrado. Decisão prévia (2026-06-14, contexto do ADR-053): **Multi-AZ primeiro, cifragem em seguida** — por isso esta migração veio depois.

## Decisão

1. **Instância nova `cerebro-postgres-enc`**, `StorageEncrypted` via **KMS CMK** (`sa-east-1`, key `ae3bc623…`), **Multi-AZ**, mesma classe `db.t4g.medium`, **mesmo Security Group, subnet e parameter group** (`default.postgres16`) do OLD.
2. **Método (não liga in-place):** `snapshot do OLD → copy-db-snapshot --kms-key-id (cópia cifrada) → restore para enc`. O restore de snapshot **preserva tudo**: roles (`cerebro_gateway` NOBYPASSRLS, `cerebro_workers`, `checkup_app`), senhas, RLS (ADR-042), `pgcrypto` e o schema `checkup`. **ADR-018 permanece** — defesa em camadas (disco + coluna).
3. **Cutover por reconfiguração de host, não recriação de dado:**
   - **Clínico:** `/opt/cerebro-amigo-v3/.env` host OLD→enc (`sed` nos 4 keys: `POSTGRES_DSN/HOST/DSN_URL` + `CHECKUP_DATABASE_URL`) + `docker compose up -d` (recria os 5 serviços no enc). Backup = `.env.bak-precifra`.
   - **Checkup:** SSM `/cerebro-amigo/checkup/database-url` host→enc (`checkup_app`, `cerebro_v3`) + `aws autoscaling start-instance-refresh cerebro-checkup-asg`.
4. **Zero perda nas trilhas imutáveis (regra #5):** o snapshot é point-in-time (freeze **17:28 UTC**); ~2h de escrita ficou só no OLD. Reconciliado antes/depois do cutover:
   - `stop agents-py` (o firehose do APScheduler) congela as duas tabelas que cresciam;
   - backfill OLD→enc de **`agente_execucoes` (944)** e **`notificacoes_medico` (402)** via temp table + `INSERT … ON CONFLICT (id) DO NOTHING` (**PK `uuid` ⇒ sem colisão**), com prova `missing_in_enc = 0`;
   - sweep pós-cutover pegou +15 stragglers do `orchestrator-py`;
   - `protocolos_crise_acionados` / `mensagens` / `consultas` / `condutas_eventos` = **0 no gap**.

## Operação (executado 2026-06-14 ~16:42 BRT)

1. Recon read-only: enc `available`/encrypted/MultiAZ; SG idêntico ao OLD (5432 já aberto ao box + ASG); roles preservadas.
2. `agents-py` parado; backfill das 2 tabelas de auditoria; verificação `missing=0`.
3. Clínico: `sed` no `.env` + `up -d`; 5 containers healthy, gateway logando `Username=cerebro_gateway;SSL Mode=VerifyFull`.
4. Checkup: SSM + instance refresh → **Successful**; `api/health` + `teste/phq9` = 200.
5. Sweep final; CSVs de backfill (continham `notificacoes_medico`) **shredados** do `/tmp` do box (LGPD).
6. **Prova de migração (CloudWatch `DatabaseConnections`):** enc **0→13**, OLD **13→0** no instante do cutover.

## Consequências

- **Segurança/LGPD:** storage clínico + **snapshots futuros** cifrados em repouso com CMK gerenciada. **Fecha T0-5.** Complementa (não substitui) a cifragem de coluna do ADR-018.
- **`force_ssl`:** enc usa `default.postgres16` (igual ao OLD) ⇒ **sem regressão**; o verify-full client-side do T1-4 segue intacto (host continua `*.rds.amazonaws.com`).
- **Rollback (armado):** OLD `cerebro-postgres` mantido **LIGADO por 48h**. Reverter = `cp .env.bak-precifra .env && docker compose up -d` (clínico) + reverter SSM `database-url` + instance refresh (checkup).
- **Monitoramento re-apontado:** o alarme de backup (ADR-043 item E, stack `cerebro-rds-backup-alarm`) foi **re-apontado de `cerebro-postgres` para `cerebro-postgres-enc`** (param `DbInstanceId` + default do template `infra/aws/rds-backup-alarm.yaml`), com a métrica `Cerebro/RDS BackupAgeHours` re-semeada na nova dimensão (invoke da Lambda); alarme `cerebro-rds-backup-stale` em `State: OK`. Feito **antes** do descarte do OLD, p/ não deixar janela sem vigilância de backup.
- **Descarte (após 48h estável):** deletar a instância OLD `cerebro-postgres` **e** o snapshot em texto claro `cerebro-pre-cifra-20260614-1427`. Os **snapshots automated antigos** do OLD continuam não cifrados — expiram pela retenção (7 dias) ou deletar manualmente.
- **Custo:** a instância nova **substitui** a antiga (não soma 24/7 depois do descarte); custo marginal da CMK.
- **Gap anônimo do checkup** (2 linhas `funnel_events`; `test_results`/`report_emails` = 0) **não reconciliado** — valor desprezível, recuperável na janela de 48h.
- **Reversível por design:** sem mudança de schema, código ou DSN — só host. Reaplicar o caminho (snapshot→copy→restore) fica documentado para futuros resizes/migrações.
