# Runbook — trocar DSN dos serviços para roles least-privilege (Estágio 0)

Pré-req: migration `0036_least_privilege_roles.sql` aplicada no RDS prod (cria
`cerebro_gateway` e `cerebro_workers` SEM senha → ainda não logam). Aplicar a
migration sozinha é não-disruptivo.

Objetivo: parar de conectar como `cerebroadmin` (rds_superuser + dono das tabelas,
que **bypassa RLS**) e passar o **gateway** para `cerebro_gateway` (NOBYPASSRLS) e
os **3 serviços Python** para `cerebro_workers` (BYPASSRLS, scans cross-tenant
legítimos). Isto é pré-requisito do RLS (Estágio 2) e já reduz blast radius.

Host: EC2 `i-057860cd97edafefb` (`/opt/cerebro-amigo-v3`), via SSM. RDS `cerebro_v3`.

## 1. Setar senhas dos roles (fora do git)

Gere 2 senhas fortes. No RDS (psql como `cerebroadmin`), via SSM:

```sql
ALTER ROLE cerebro_gateway PASSWORD '<SENHA_GATEWAY>';
ALTER ROLE cerebro_workers PASSWORD '<SENHA_WORKERS>';
```

> ⚠️ **REGRA: o `ALTER ROLE` no RDS e o `.env`/SSM andam JUNTOS, no mesmo passo, + `--force-recreate` na hora.**
> Trocar só um lado deixa drift **latente**: o container vivo mantém o env antigo (compose **não relê env sem recreate**) e segue autenticando, então parece ok — até o **próximo deploy recriar** o container e carregar o env novo, aí estoura `Npgsql 28P01: password authentication failed` em toda conexão nova → endpoints que leem DB viram 500. Aconteceu em **2026-06-24** (gateway **e** checkup `checkup_app`; rotação de 06-23 trocou o `.env` mas pulou o `ALTER ROLE`). Detector: alarme CloudWatch `cerebro-gateway-db-auth-fail` (log group `/cerebro/api-gateway`). `/ready` **não** pega (pool mascara: reusa conexão pré-rotação ainda autenticada). Fix de emergência: `ALTER ROLE <role> PASSWORD '<a que o container já tem no env>'` como `cerebroadmin` (creds master estão no env do próprio container) — alinha RDS→env sem restart.

## 2. Validar os GRANTs ANTES de trocar (smoke read/write como o novo role)

```sql
SET ROLE cerebro_gateway;
SELECT count(*) FROM pacientes;            -- deve ler
INSERT INTO acessos_paciente (paciente_id, acao) VALUES
  ((SELECT cliente_id FROM pacientes LIMIT 1), 'login') RETURNING id;  -- deve escrever
RESET ROLE;
```

Se algo der "permission denied", re-rodar os GRANTs da 0036 (faltou tabela nova).

## 3. Trocar o DSN no `.env` do EC2

- Gateway (.NET): `POSTGRES_DSN` → `Username=cerebro_gateway;Password=<SENHA_GATEWAY>`
  (manter Host/Database/SSL Mode).
- Python (`POSTGRES_DSN_URL`, formato URL): trocar `cerebroadmin:<...>@` por
  `cerebro_workers:<SENHA_WORKERS>@`.

Backup antes: `cp .env .env.bak.roles-AAAAMMDD`.

## 4. Recriar containers (env_file só é relido com recreate, não com restart)

```
cd /opt/cerebro-amigo-v3 && docker compose up -d --force-recreate \
  api-gateway orchestrator-py agents-py notifier-py
```

## 5. Verificar saúde + um fluxo real

- `curl -sf localhost:5000/ready` (gateway) e `/health` dos Python = 200.
- Logar como médico no dashboard, abrir um prontuário (leitura), registrar 1
  prescrição (escrita) → 200. Agentes/notifier: ver log do próximo tick sem
  "permission denied".

## Rollback (instantâneo)

Voltar `POSTGRES_DSN`/`POSTGRES_DSN_URL` para `cerebroadmin` no `.env`
(`cp .env.bak.roles-AAAAMMDD .env`) e `docker compose up -d --force-recreate`.
Os roles novos podem ficar criados (inertes) sem efeito.

## Depois (Estágio 2, separado)

Com o gateway em `cerebro_gateway` (NOBYPASSRLS), habilitar RLS tabela-a-tabela:
`ALTER TABLE <t> ENABLE ROW LEVEL SECURITY; ... FORCE ROW LEVEL SECURITY;` +
`CREATE POLICY ... USING (tenant = current_setting('app.current_medico')::uuid)`,
com o middleware de transação-por-request setando `SET LOCAL app.current_medico`.
Ver memória `project-tenant-isolation` (Estágio 1/2) e ADR a registrar.
