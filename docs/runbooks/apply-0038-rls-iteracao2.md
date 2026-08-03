# Runbook — aplicar RLS iteração 2 (migration 0038) em prod

Estende a RLS de tenant a `conversas`, `mensagens`, `crise_alerta_eventos`,
`condutas_eventos`, `receitas_memed`, `acessos_prontuario` (ADR-042 §Iteração 2).

**Pré-condição já satisfeita:** o `TenantSessionMiddleware` está LIVE desde a
iteração 1 (0037) e o gateway já conecta como `cerebro_gateway` (NOBYPASSRLS, swap
de DSN feito 2026-06-08). Logo **NÃO há o risco de ordem da iteração 1** — o GUC já
é setado por request. Aplicar a 0038 é seguro a qualquer momento depois disso.

## Ordem

1. **Merge do código em `main`** (migration 0038 + testes + ADR). CI roda
   `dotnet-tests` (30 verdes) antes do merge. O deploy do EC2 NÃO muda
   comportamento (o middleware já seta os GUCs; as 6 tabelas só passam a filtrar
   quando a 0038 rodar). Migrations **não** são aplicadas pelo `deploy.yml` — é à
   mão (passo 2).

2. **Aplicar a 0038 no RDS via SSM**, como dono (`cerebroadmin`).

   > ⚠️ **DB ALVO = `cerebro_v3`** (NÃO `cerebro`). O `/opt/cerebro/.env` do EC2 está
   > **STALE**: tem `POSTGRES_DB=cerebro` e um `POSTGRES_DSN` apontando p/ o database
   > `cerebro` — que é o **V2 legado** (36 tabelas, 0 RLS). O app de produção roda em
   > **`cerebro_v3`** (67 tabelas, RLS viva): confirmado pelos 5 containers em runtime
   > (`docker exec <c> env | grep Database` → `Database=cerebro_v3`, gateway=`cerebro_gateway`,
   > Python=`cerebro_workers`). **FORCE `PGDATABASE=cerebro_v3`** ao aplicar; não confie
   > no `POSTGRES_DB` do `.env`. (As credenciais `cerebroadmin`/host/porta do `.env`
   > servem — é o mesmo servidor RDS e cerebroadmin é dono dos dois databases.)

   Técnica usada (gotchas SSM: aspas e parênteses inline quebram o parser do AWS CLI):
   **base64 do script**. Resumo do que o script faz no host:

   ```bash
   # no EC2 i-057860cd97edafefb (via SSM). psql em /usr/bin/psql.
   ENV=/opt/cerebro/.env
   export PGUSER=$(sed -n 's/^POSTGRES_USER=//p' $ENV | head -1)       # cerebroadmin
   export PGPASSWORD=$(sed -n 's/^POSTGRES_PASSWORD=//p' $ENV | head -1)
   export PGHOST=$(sed -n 's/^POSTGRES_HOST=//p' $ENV | head -1)
   export PGPORT=$(sed -n 's/^POSTGRES_PORT=//p' $ENV | head -1)
   export PGDATABASE=cerebro_v3        # <<< FORÇADO (ignora POSTGRES_DB=cerebro stale)
   psql -1 -v ON_ERROR_STOP=1 -f infra/migrations/0038_rls_tenant_iteracao2.sql
   ```

   Aplicar atômico (`-1 -v ON_ERROR_STOP=1`): se errar, NADA aplica. A 0038 é
   idempotente (DROP POLICY IF EXISTS + ENABLE). Embutir o SQL via base64 dispensa
   esperar o `git pull` do deploy trazer o arquivo ao host.

3. **Verificar** (como cerebro_gateway — o role filtrado):

   ```sql
   -- 6 tabelas com RLS ligada
   SELECT relname, relrowsecurity FROM pg_class
   WHERE relname IN ('conversas','mensagens','crise_alerta_eventos',
                     'condutas_eventos','receitas_memed','acessos_prontuario')
   ORDER BY relname;   -- esperado: todas t

   -- fail-closed: SEM GUC, cerebro_gateway não vê nada
   SET ROLE cerebro_gateway;          -- ou conectar como ele
   SELECT count(*) FROM conversas;    -- esperado 0
   SELECT count(*) FROM mensagens;    -- esperado 0

   -- com GUC de um médico real → vê só as conversas dos pacientes dele
   SELECT set_config('app.current_medico', '<medico_id_real>', false);
   SELECT count(*) FROM conversas;    -- > 0, só do tenant
   RESET ROLE;
   ```

4. **Smoke do app em prod:**
   - Médico abre uma conversa no dashboard (`/dashboard/mensagens`) → vê o
     histórico das próprias conversas (não 0).
   - Fila de escalações (`/api/v1/escalacoes`) carrega.
   - Banner/ack de crise (`/dashboard`, CriseEndpoints) funciona.
   - **Crítico (item #1):** o watchdog de escalação de crise do notifier-py segue
     disparando — ele conecta como `cerebro_workers` (BYPASSRLS), então a RLS NÃO
     o afeta. Conferir logs do notifier sem erro de permissão/RLS.
   - `GET /ready` do gateway = 200. Logs sem `permission denied`/exception de RLS.

## Rollback (instantâneo, por tabela)

```sql
ALTER TABLE conversas            DISABLE ROW LEVEL SECURITY;
ALTER TABLE mensagens            DISABLE ROW LEVEL SECURITY;
ALTER TABLE crise_alerta_eventos DISABLE ROW LEVEL SECURITY;
ALTER TABLE condutas_eventos     DISABLE ROW LEVEL SECURITY;
ALTER TABLE receitas_memed       DISABLE ROW LEVEL SECURITY;
ALTER TABLE acessos_prontuario   DISABLE ROW LEVEL SECURITY;
```

O isolamento volta a ser só o WHERE da aplicação (estado pré-0038). Sem perda de
dado — a 0038 só liga RLS + cria policy, não toca linha nenhuma.
```
