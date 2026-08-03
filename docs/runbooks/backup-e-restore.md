# Runbook: Backup e Restore do RDS

## Contexto

Dados de saúde mental (LGPD categoria especial). Perda de dado é inaceitável.
Este runbook cobre backups automatizados do RDS PostgreSQL e o procedimento
manual de restore em caso de desastre.

## Backups automatizados (RDS)

A instância RDS de produção é **`cerebro-postgres-enc`** na `sa-east-1`
(instância cifrada em repouso, ADR-018 — sucessora de `cerebro-postgres`/
`cerebro-amigo-v3` após o cutover de cifragem de 2026-06-14). É `db.t4g.small`,
**Single-AZ** (postura piloto; gatilho para religar Multi-AZ = 1º pagante).

### Estado atual (verificado 2026-06-25)

| Configuração | Valor atual | Rationale |
|---|---|---|
| Backup retention period | **35 days** | Máximo do PITR automático da AWS (subido de 7→35 em 2026-06-25). LGPD categoria especial; guarda além de 35d → AWS Backup vault |
| Backup window | **07:00–07:30 UTC** (04:00–04:30 BRT) | Madrugada BR, menor uso; não sobrepõe a janela de manutenção (`thu 06:01–06:31 UTC`) |
| Maintenance window | `thu 06:01–06:31 UTC` (03:01 BRT qui) | Não pode sobrepor o backup window |
| Automated backups | Enabled | Snapshot diário + WAL contínuo |
| Snapshot encryption | KMS (instância cifrada, ADR-018) | Dados cifrados em repouso |
| Cross-region snapshot copy | **VEDADO** (não usar `us-east-1` nem outra region) | LGPD: dado de saúde é categoria especial, residência obrigatória no Brasil. AWS só tem 1 region no BR (`sa-east-1`) → não há DR cross-region possível dentro do país |

### Cadência do backup (importante)

São **dois mecanismos com cadências diferentes**:

- **Snapshot completo: 1×/dia**, na janela `07:00–07:30 UTC`. Backup full do volume.
- **Transaction logs (WAL): a cada ~5 min**, o dia todo, independente da janela.
  São eles que dão o PITR.

Consequência: **RPO ≈ 5 min** (perda máxima de dado em desastre). Dá para
restaurar para qualquer instante dos últimos **35 dias** com granularidade de
~5 min — não só para os horários dos snapshots diários.

### Teto de retenção e guarda longa

- **PITR automático: máximo 35 dias** (teto duro da AWS). Subir o
  `backup-retention-period` acima de 35 falha.
- Para guarda além de 35d (arquivo de prontuário, exigência LGPD de longo
  prazo): **AWS Backup vault** (lifecycle em anos, compliance-lock/WORM) ou
  **snapshots manuais** (sem expiração, vivem até deleção explícita). Não usar
  PITR como arquivo de longo prazo.

### DR e residência de dado (LGPD)

Dado de saúde mental = **categoria especial** (LGPD), com **residência
obrigatória no Brasil**. Por isso:

- **Não copiar snapshot para outra region AWS** (`us-east-1` etc.) — tira o
  dado do Brasil. Vedado sem revisão jurídica/LGPD.
- A AWS só tem **uma** region no Brasil (`sa-east-1`), então **não existe DR
  cross-region in-country**. O DR fica restrito a recursos in-region.
- Opções de DR/guarda longa que **permanecem em `sa-east-1`**:
  - **AWS Backup vault** in-region com lifecycle longo (compliance-lock/WORM).
  - **Snapshots manuais** retidos in-region.
  - **Export pra S3** em `sa-east-1` (bucket com cifragem + bloqueio público).
- Resiliência intra-region já disponível: **Multi-AZ** (failover automático na
  mesma region). Hoje Single-AZ; gatilho para religar = 1º pagante.

> A `ENCRYPTION_KEY` (ADR-018) é credencial, não dado clínico — pode ter cópia
> de DR, mas mantenha o alvo de replicação **em `sa-east-1`** para não criar
> superfície fora do Brasil junto de snapshots vazados.

### Como ajustar retenção / janela (sem downtime)

Mudar retention ou backup window **não reinicia** a instância:

```bash
# Subir retenção (ex.: 35 dias; máximo permitido)
aws rds modify-db-instance \
  --db-instance-identifier cerebro-postgres-enc \
  --backup-retention-period 35 \
  --apply-immediately --region sa-east-1

# Mover a janela de backup (UTC, mínimo 30 min, sem sobrepor manutenção)
aws rds modify-db-instance \
  --db-instance-identifier cerebro-postgres-enc \
  --preferred-backup-window 07:00-07:30 \
  --apply-immediately --region sa-east-1
```

Confira que `PendingModifiedValues` voltou vazio após aplicar.

### Verificação de health dos backups

```bash
# Config atual de backup
aws rds describe-db-instances \
  --db-instance-identifier cerebro-postgres-enc \
  --region sa-east-1 \
  --query 'DBInstances[].{retention:BackupRetentionPeriod,backup:PreferredBackupWindow,maint:PreferredMaintenanceWindow,multiaz:MultiAZ}'

# Lista snapshots recentes
aws rds describe-db-snapshots \
  --db-instance-identifier cerebro-postgres-enc \
  --region sa-east-1 \
  --query 'DBSnapshots[?SnapshotCreateTime>='"'"'$(date -u -d "7 days ago" +%Y-%m-%d)'"'"'].[DBSnapshotIdentifier,SnapshotCreateTime,Status]' \
  --output table
```

Alarme CloudWatch: disparar se nenhum snapshot `available` nos últimos 7 dias.

## Restore Point-in-Time (PITR)

O RDS mantém WAL (Write-Ahead Log), permitindo restore para qualquer ponto
no período de retenção (até o último minuto).

### Procedimento de restore (desastre)

1. **Parar todos os serviços** para evitar escrita durante o restore:
   ```bash
   ssh ec2-user@cerebro-amigo-v3
   docker compose down
   ```

2. **Criar nova instância a partir do snapshot mais recente**:
   ```bash
   aws rds restore-db-instance-to-point-in-time \
     --source-db-instance-identifier cerebro-postgres-enc \
     --target-db-instance-identifier cerebro-postgres-enc-restored \
     --restore-time "2026-06-02T10:00:00Z" \
     --region sa-east-1
   ```

3. **Atualizar o security group** para permitir conexão da EC2.

4. **Atualizar `POSTGRES_DSN` e `POSTGRES_DSN_URL`** na EC2 (nova endpoint).

5. **Subir serviços**:
   ```bash
   docker compose up -d
   ```

6. **Validação pós-restore**:
   ```bash
   curl -sf http://localhost:5050/ready | grep ready
   curl -sf http://localhost:8081/ready | grep ready
   # Verificar se últimos registros de checkins/mensagens estão presentes
   ```

## Rollback de migrations

As migrations são **forward-only** (DDL versionado em `infra/migrations/`).
Não há rollback automático.

### Se uma migration quebrar em produção:

1. **Não faça `down`**. O estado do banco é append-only (regra clínica).

2. **Crie uma migration corretiva** (ex.: `0008_fix_0007.sql`) que corrige
   o schema sem destruir dados:
   ```sql
   -- Exemplo: adicionar coluna faltante em vez de recriar tabela
   ALTER TABLE tabela ADD COLUMN nova_coluna tipo DEFAULT valor;
   ```

3. **Teste a migration corretiva** em staging antes de aplicar em produção.

4. **Se a migration causar downtime**: restaure do snapshot mais recente
   (antes da migration) e aplique a migration corretiva.

## Rotação de segredos

### `INTERNAL_API_TOKEN`

1. Gerar novo token: `openssl rand -hex 32`
2. Atualizar no AWS SSM Parameter Store / Secrets Manager
3. Atualizar `.env` na EC2
4. Reiniciar serviços: `docker compose restart`
5. O token antigo pode ser removido após confirmação de que todos os
   serviços estão usando o novo (health checks passando).

### `JWT_SECRET`

1. Gerar nova secret
2. Atualizar no SSM / `.env`
3. **Efeito**: todos os tokens JWT existentes são invalidados (usuários
   precisam fazer login novamente). Planejar janela de manutenção.

### `ENCRYPTION_KEY` (ADR-018)

**NUNCA perca esta chave**. Sem ela, dados cifrados no banco são
irrecuperáveis. Backup separado:
- AWS Secrets Manager **em `sa-east-1`** (não replicar para outra region — ver
  nota de residência LGPD acima; a chave fora do BR + snapshot vazado = dado
  clínico exposto)
- Cópia offline em cofre físico (opção de negócio)
