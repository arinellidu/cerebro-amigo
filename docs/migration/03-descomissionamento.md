# 03 — Descomissionamento do RDS + limpeza (Fase 4 do runbook)

> **Modo de execução:** os comandos abaixo são executados **manualmente pelo operador**,
> na ordem. Nenhum deles foi executado pela sessão que gerou este plano. Após a execução,
> a verificação (§6) confirma via describes e o ADR-077 vira `Implemented`.
> Plano gerado em 2026-07-06T21:00Z com estado real da conta (describes read-only).

---

## 0. GATES — NÃO EXECUTE NADA ANTES DESTES ✋

### Gate 0 — Flip do checkup ✅ CONCLUÍDO (2026-07-06T22:29Z)

> **Execução completa em `05-gate0-execucao.md`:** flip FEITO (parâmetro v4 → local),
> split-brain ENCERRADO, merge dispensado (delta zero, `04-gate0-audit.md`). Fix de TLS
> do driver deployado via PR #167 (instance refresh Successful) e **E2E com persistência
> PROVADA às 22:29Z** (local +3 eventos +1 resultado; RDS congelado, sessão ausente,
> 0 conexões). **Relógio de 48h do checkup: 2026-07-06T22:29Z → 2026-07-08T22:29Z.**
> Abertura efetiva do gate de delete = **2026-07-09T20:25Z** (as 72h do stack fecham
> depois das 48h do checkup).

**Situação:** o SSM `/cerebro-amigo/checkup/database-url` ainda aponta para o RDS, database
`cerebro_v3` — o MESMO database que o stack principal cortou para o Postgres local às 20:25Z.
Split-brain: stack principal escreve no local, checkup escreve no RDS. Precisão factual: o
schema `checkup` local foi re-sincronizado às **20:33:07Z** (restore do delta da Fase 1) —
o divergível corre desde aí. **Audit preliminar (2026-07-06T21:13Z): delta ZERO e ownership
disjunto confirmado — ver `04-gate0-audit.md`.** Deletar o RDS sem este gate derruba o checkup.

**Pre-flights — os três VERDES em 2026-07-06T21:0x (verificados com evidência):**

1. **Bind + SG:** `ss -ltnp` → postgres ouvindo em `172.31.4.97:5432` (compose já
   parametrizado com `POSTGRES_BIND`); SG do LT do ASG (`lt-0b158c6b0455f824f` v4) =
   `sg-0c240ece2f5c0e46f`, que é exatamente a origem da regra 5432 SG-to-SG já existente
   no `cerebro-app-sg` (`sgr-02b4eba21076995b6`; sem CIDR, sem 0.0.0.0/0). Teste TCP
   **da instância do checkup** → box:5432 = OK (via SSM). ⚠️ Lembrete: bind em IP privado
   não protege nada por si — EC2 com IP público faz NAT para a mesma ENI; **o SG é o gate real**.
2. **SSL:** `SHOW ssl` = **on**; cert self-signed em `$PGDATA` (key `0600` owner postgres);
   conexão real `psql postgresql://checkup_app:***@172.31.4.97:5432/cerebro_v3?sslmode=require`
   (senha lida do `.env`, sem eco) = OK. Nenhuma recriação de container foi necessária.
3. **Senha + grants:** `PG_LOCAL_CHECKUP_PASSWORD` = 48 chars `[A-Za-z0-9]` (hex — sem
   rotação necessária); `has_table_privilege(checkup_app, ..., INSERT)` = `t` nas 7 tabelas
   do schema `checkup` no local (grants reaplicados no restore do delta; armadilha do
   `--no-owner --no-acl` do P5 já coberta).

**Sequência de execução (operador; nesta ordem):**

```bash
# 1) Parar o checkup (min-size é 1 — precisa baixar junto; superfície pública fica fora do ar na janela)
aws autoscaling update-auto-scaling-group --region sa-east-1 --auto-scaling-group-name cerebro-checkup-asg --min-size 0 --desired-capacity 0

# 2) Drenagem: aguardar a instância terminar E zero conexões do checkup no RDS
aws autoscaling describe-auto-scaling-groups --region sa-east-1 --auto-scaling-group-names cerebro-checkup-asg --query 'AutoScalingGroups[0].Instances'   # deve ficar []
# No box (via SSM), com a DSN antiga do parâmetro:
#   SELECT count(*) FROM pg_stat_activity WHERE usename = 'checkup_app';   → 0

# 3) Audit FINAL de delta (re-executar as queries do 04-gate0-audit.md com o checkup parado)

# 4) SOMENTE SE delta > 0: merge RDS → local (checkup parado)
#    truncate+reload das 7 tabelas: pg_dump -Fc --schema=checkup "<DSN RDS>" | restore no local
#    (drop schema checkup local + pg_restore como cerebroadmin + grants — mecanismo já
#    ensaiado na Fase 1). Ao final, realinhar TODAS as sequences do schema:
#    SELECT 'SELECT setval(''' || schemaname||'.'||sequencename || ''', COALESCE((SELECT max(id) FROM checkup.' || replace(sequencename, '_id_seq','') || '), 1))' FROM pg_sequences WHERE schemaname='checkup';
#    (gerar e executar cada setval contra o max(id) da tabela correspondente)

# 5) Flip do SSM (parâmetro usa alias/aws/ssm — chave AWS-managed, verificado via
#    describe-parameters; NÃO precisa de --key-id. Se algum dia migrar p/ CMK, preservá-la aqui.)
aws ssm send-command --region sa-east-1 --instance-ids i-057860cd97edafefb --document-name AWS-RunShellScript --parameters 'commands=["C=$(grep ^PG_LOCAL_CHECKUP_PASSWORD= /opt/cerebro-amigo-v3/.env | cut -d= -f2-); aws ssm put-parameter --region sa-east-1 --name /cerebro-amigo/checkup/database-url --type SecureString --overwrite --value postgresql://checkup_app:${C}@172.31.4.97:5432/cerebro_v3?sslmode=require"]'

# 6) Religar
aws autoscaling update-auto-scaling-group --region sa-east-1 --auto-scaling-group-name cerebro-checkup-asg --min-size 1 --desired-capacity 1

# 7) E2E REAL: fazer um PHQ-9 completo em https://checkup.cerebroamigo.com.br (ambiente de
#    teste/anônimo) até a devolutiva + PDF; conferir /api/health 200, funnel-metrics 200 no
#    Cockpit, o evento novo gravado no Postgres LOCAL, e zero conexões checkup_app no RDS.

# 8) Início do relógio de 48h do checkup (logs limpos no CloudWatch do checkup).
```

**Regra registrada:** se optar por `start-instance-refresh` em vez de `desired=0`, o merge
só pode rodar **após o refresh completar** — instância em drenagem ainda escreve no RDS.

**Melhorias futuras (registradas, fora desta janela):**
- (a) IP privado hardcoded na DSN quebra no DR via AMI/instância nova — criar Route53
  **private hosted zone** (`db.cerebro.internal` → IP do box) e apontar a DSN pro nome.
- (b) Endurecer `pg_hba` para **`hostssl`** na origem do checkup (hoje o TLS está ligado,
  mas o pg_hba aceita `host` — conexão sem TLS não é recusada pelo servidor).

**Lição de post-mortem:** *parameter store é superfície de cutover.* O P6 desta migração
varreu `.env` e compose, mas não o SSM — o checkup ficou para trás e criou o split-brain.
Em migrações futuras, o passo de flip DEVE varrer
`aws ssm get-parameters-by-path --path /cerebro-amigo --recursive` (e equivalentes) por
endpoints antigos antes de declarar o cutover completo.

### Gate 1 — 72 h de observação estável do stack 🔴 (abre em **2026-07-09T20:25Z**)

Cutover: 2026-07-06T20:25Z (tag `migration/postgres-selfhosted-cutover`). **O delete do RDS
exige TODOS os itens abaixo** (gate atualizado pela emenda do Gate 0):
- [ ] Data ≥ 2026-07-09T20:25Z.
- [ ] 6 alarmes `cerebro-pg-*`/`cerebro-ec2-cpu-credits-low` sem ALARM no período
      (exceção documentada: ALARM proposital da simulação de falha em 06/07 20:43Z):
      `aws cloudwatch describe-alarm-history --region sa-east-1 --start-date 2026-07-06T20:45:00Z --history-item-type StateUpdate --query 'AlarmHistoryItems[?contains(HistorySummary,\`to ALARM\`)].[AlarmName,Timestamp]' --output table`
- [ ] 3 backups diários verdes: `aws s3 ls s3://cerebro-amigo-db-backups/postgres/daily/` (07, 08, 09/07)
      e `last-success` fresco. Restore-test: manual de 06/07 = PASS; o dominical roda 12/07 (não bloqueia).
- [ ] **Gate 0 completo: checkup flipado** (SSM apontando pro local, confirmado com
      `get-parameter | sed` mascarado) **+ 48 h de logs limpos do checkup + E2E real verde**
      (PHQ-9 → devolutiva → PDF, evento no Postgres local, zero conexões `checkup_app` no RDS).

---

## 1. Snapshot final (seguro de arrependimento) — ANTES de mexer na proteção

```bash
SNAP="cerebro-postgres-enc-final-adr077-$(date +%Y%m%d)"
aws rds create-db-snapshot --region sa-east-1 --db-instance-identifier cerebro-postgres-enc --db-snapshot-identifier "$SNAP"
aws rds wait db-snapshot-available --region sa-east-1 --db-snapshot-identifier "$SNAP"
# Confirmar: Status=available e Encrypted=true (KMS ae3bc623-... — por isso a chave KMS NÃO será deletada)
aws rds describe-db-snapshots --region sa-east-1 --db-snapshot-identifier "$SNAP" --query 'DBSnapshots[0].{Status:Status,Encrypted:Encrypted,Kms:KmsKeyId,Size:AllocatedStorage}'
```

## 2. Desabilitar deletion protection (só depois do snapshot available)

```bash
aws rds modify-db-instance --region sa-east-1 --db-instance-identifier cerebro-postgres-enc --no-deletion-protection --apply-immediately
aws rds wait db-instance-available --region sa-east-1 --db-instance-identifier cerebro-postgres-enc
```

## 3. Delete da instância

```bash
aws rds delete-db-instance --region sa-east-1 --db-instance-identifier cerebro-postgres-enc --skip-final-snapshot
aws rds wait db-instance-deleted --region sa-east-1 --db-instance-identifier cerebro-postgres-enc   # ~5-10 min
```

> Rollback pós-delete: `aws rds restore-db-instance-from-db-snapshot` a partir do `$SNAP`
> (endpoint novo → flip reverso das DSNs; RTO de horas). O snapshot final fica retido
> indefinidamente (custa ~R$ 2/mês; reavaliar em 6 meses).

## 4. Limpeza de acessórios e custos silenciosos

Re-scan de 2026-07-06 (pós-discovery): **zero** EIPs não associadas, **zero** volumes EBS
`available`, **zero** NAT gateways, **zero** snapshots EBS órfãos — não há comando de release
de EIP/volume/NAT a executar (a conta já estava limpa; os 9 IPv4 públicos ≈ R$ 170/mês são
estruturais dos 2 ALBs + 3 instâncias — otimização separada, fora deste plano).

Sobram exatamente estes:

```bash
# 4a. Snapshot manual antigo da NOSSA instância (redundante após o snapshot final)
aws rds delete-db-snapshot --region sa-east-1 --db-snapshot-identifier cerebro-postgres-enc-pre-singleaz-2026-06-21

# 4b. ⚠️ mybestbrain-db-snapshot: é de OUTRA instância (mybestbrain-db, projeto distinto,
#     NÃO cifrado, criado 2026-06-11) e pode ser o único backup daquele projeto.
#     SÓ execute com confirmação explícita do dono (Patrick):
# aws rds delete-db-snapshot --region sa-east-1 --db-snapshot-identifier mybestbrain-db-snapshot

# 4c. Alarmes RDS órfãos — pertencem ao stack CFN cerebro-observabilidade-piloto
#     (cerebro-rds-conexoes-altas, cerebro-rds-cpu-alta, cerebro-rds-storage-baixo).
#     NÃO deletar na mão (drift): remover os 3 recursos AWS::CloudWatch::Alarm de
#     infra/aws/observability-piloto.yaml e atualizar o stack:
aws cloudformation update-stack --region sa-east-1 --stack-name cerebro-observabilidade-piloto --template-body file://infra/aws/observability-piloto.yaml
#     (o stack rds-backup-alarm.yaml, se dedicado ao RDS, pode ser deletado inteiro:
#      conferir `aws cloudformation describe-stacks --stack-name <nome>` antes)

# 4d. Security group do RDS (após o delete da instância; nada mais o referencia)
aws ec2 delete-security-group --region sa-east-1 --group-id sg-01b07c7f4a5e0b2c5

# 4e. SNS órfão de alertas de backup do RDS (sem event subscriptions ativas — verificado)
aws sns delete-topic --region sa-east-1 --topic-arn arn:aws:sns:sa-east-1:004177894935:cerebro-amigo-rds-backup-alertas
```

**Não tocar:** chave KMS `ae3bc623-...` (cifra o snapshot final — deletá-la inutiliza o
seguro de arrependimento) · subnet group `default` (grátis) · RI do RDS (payment-failed,
sem cobrança) · regra 5432 checkup→box no `cerebro-app-sg` (é do banco novo).

## 5. Economia mensal estimada (registrar no ADR após execução)

| Item | R$/mês |
|---|---:|
| RDS db.t4g.small Single-AZ + 20 GB gp3 + backup (steady-state, câmbio 5,18) | **−291** |
| Novos custos permanentes: EBS 20 GB (+16) · S3 backups (+2) · snapshots DLM (+2) · 12 métricas + 6 alarmes CloudWatch (+25) · snapshot final RDS retido (+2) | **+47** |
| **Economia líquida** | **≈ R$ 244/mês (~R$ 2.930/ano)** |

(Junho real do RDS foi US$ 102 bruto — mês atípico de cutovers; a base honesta é o
steady-state. Crédito AWS acabou em junho: a economia aparece integral na fatura de agosto.)

## 6. Verificação pós-execução (rodada pela sessão do Claude, read-only)

- `describe-db-instances` → `DBInstanceNotFound` para `cerebro-postgres-enc`.
- `describe-db-snapshots` → snapshot final `available` + `Encrypted=true`; `pre-singleaz` ausente.
- SG `sg-01b07c7f4a5e0b2c5` inexistente; alarmes `cerebro-rds-*` ausentes; topic SNS ausente.
- Stack clínico + checkup saudáveis no banco local; alarmes `cerebro-pg-*` OK.
- ADR-077 → `Status: Implemented` com a economia realizada e a data.

**Status: AGUARDANDO GATES — Gate 0 (flip do checkup + 48 h + E2E) e Gate 1 (72 h do stack,
abre 2026-07-09T20:25Z) — e execução manual do operador.**
