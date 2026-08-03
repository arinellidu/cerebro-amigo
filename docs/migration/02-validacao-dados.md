# 02 — Validação da migração de dados (Fase 1 do runbook)

> **Janela:** 2026-07-06 · freeze **20:10:01Z** → validação concluída **20:14:11Z** (~4 min)
> **Estado ao final:** aplicações **PARADAS** (religam no P6); RDS **intocado** (somente leituras);
> Postgres local com `cerebro_v3` restaurado e validado. Rollback desta fase = `docker compose start`
> dos 5 serviços (DSNs ainda apontam para o RDS).

## Desvio de método: dump composto (sem credencial master)

A senha do `cerebroadmin` (master do RDS) foi rotacionada no hardening de 2026-06-23 e o valor
não existe em nenhum lugar acessível (`.env` do host e env dos containers = stale, ambos
`28P01`; SSM só tem `gateway-db-password` e `checkup/database-url`). Resetar a senha master
violaria a regra da janela ("RDS intocado além de leituras"). Solução — **dois dumps que compõem
100% do `cerebro_v3`**:

| Dump | Role | Escopo | Artefato (S3, retido sem lifecycle) |
|---|---|---|---|
| A | `cerebro_workers` (BYPASSRLS) | `cerebro_v3` sem schema `checkup` + db `postgres` | `postgres/migration/workers/daily/2026-07-06/` (24 MB) |
| B | `checkup_app` | só schema `checkup` | `postgres/migration/checkup/daily/2026-07-06/` (22 KB) |

Flags em ambos: `--no-owner --no-acl` (via `PG_DUMP_EXTRA_FLAGS` novo do
`backup-postgres.sh`; client pg16.14 de dentro do container pgvector ≥ servidor 16.13).
BYPASSRLS garante dump de **todas as linhas** de todos os tenants.

**Consequências registradas:**
- **V2 (`cerebro`, 57 MB) ficou sem dump lógico** — nenhuma role acessível lê as tabelas.
  Decisão do go/no-go já era arquivar sem restaurar; a preservação fica por conta do
  snapshot final do RDS (Fase 4), que retém o V2 inteiro.
- **ACLs originais não vieram** (`--no-acl` + master indisponível p/ lê-las por completo).
  Grants recriados **por serviço** (abaixo). Refinamento por tabela (ex.: REVOKE DELETE
  explícito nas trilhas de auditoria) → pendência de hardening pós-P6; a proteção primária
  (RLS + código) foi restaurada e validada.
- **Checkup continua vivo** (ASG separado, fora do escopo do freeze): escritas em
  `checkup.funnel_events` após 20:10:16Z ficam só no RDS. Reconciliar no P6 com re-dump
  do schema `checkup` (segundos) ou aceitar a perda (telemetria de funil, não-clínico).

## Roles criadas (least privilege, senhas novas no `.env` do box)

| Role | Atributos | Acesso |
|---|---|---|
| `cerebroadmin` | LOGIN CREATEDB (sem SUPERUSER) | owner do database e dos objetos restaurados |
| `cerebro_gateway` | LOGIN | CRUD em `public` (RLS ativa por cima — NOBYPASSRLS) |
| `cerebro_workers` | LOGIN **BYPASSRLS** | CRUD em `public` |
| `checkup_app` | LOGIN | CRUD **somente** em `checkup` |

Senhas: `PG_LOCAL_{ADMIN,GATEWAY,WORKERS,CHECKUP}_PASSWORD` geradas no box (`openssl rand
-hex 24`), nunca transitaram fora dele; placeholders no `.env.example`. `ALTER DEFAULT
PRIVILEGES FOR ROLE cerebroadmin` cobre objetos de migrations futuras.

Restore: extensões pré-criadas (`vector`, `pgcrypto`, `uuid-ossp`) e entradas `EXTENSION`
filtradas do TOC (`pg_restore -l | grep -v EXTENSION`); `pg_restore -j 2 --no-owner
--no-acl -U cerebroadmin` — **rc=0 nos dois dumps, zero erros**.

## Resultados da validação (20:13–20:14Z)

### V1 — Contagens top-20 vs manifestos do dump: ✅ 20/20 exatas, 0 mismatches

| Tabela | Manifesto (RDS congelado) | Restaurado |
|---|---:|---:|
| public.notificacoes_medico | 264.760 | 264.760 ✅ |
| public.agente_execucoes | 396.365 | 396.365 ✅ |
| public.crise_alerta_eventos | 5.892 | 5.892 ✅ |
| public.conhecimento | 62 | 62 ✅ |
| public.insights | 115 | 115 ✅ |
| public.checkpoints / _writes / _blobs | 32 / 128 / 37 | idem ✅ |
| public.tomadas_medicacao | 317 | 317 ✅ |
| public.checkins | 226 | 226 ✅ |
| public.acessos_prontuario | 162 | 162 ✅ |
| public.exames_agenda / assinaturas | 2 / 5 | idem ✅ |
| public.social_posts / social_presenca / pagamentos_manuais | 1 / 1 / 1 | idem ✅ |
| public.clientes | 6 | 6 ✅ |
| public.medicamento_dicionario / interacao_catalogo | 50 / 21 | idem ✅ |
| checkup.funnel_events | 42 | 42 ✅ |

### V2 — Extensões (`\dx`): ✅ conjunto idêntico ao discovery

`pgcrypto 1.3` · `plpgsql 1.0` · `uuid-ossp 1.1` · `vector 0.8.4`
(⚠️ única divergência esperada: **vector 0.8.1 → 0.8.4**, versão da imagem pinada — superset
compatível, índices recriados no restore.)

### V3 — SchemaVersions (DbUp): ✅ idêntico ao P0

`to_regclass('public."SchemaVersions"')` → **ausente** — exatamente como registrado no
discovery (P0): este repo não usa DbUp; migrations são SQL manual (`infra/migrations/`,
0001..0060). Equivalência provada pelo V5.

### V4 — RLS: ✅

`pg_policies` = **27** (RDS na janela: 27) · tabelas com `relrowsecurity` em `public`: **26**.

### V5 — Artefato da migration mais recente (0060): ✅

2 colunas `escriba_%` em `consultas` (`escriba_consentido_metodo`, `escriba_consentido_em`)
— a 0060 (ADR-075) está no schema restaurado.

### V6 — Similaridade vetorial real: ✅

`conhecimento.embedding`: 62 embeddings restaurados. Query `<->` (L2) contra o primeiro
registro: top-3 = `0.0000` (ele próprio), `0.4383`, `0.4991` — auto-distância zero e
vizinhos em faixa plausível.

### V7 — Fronteiras de privilégio: ✅

`cerebro_gateway` SELECT em `public.pacientes` = **t** · `checkup_app` USAGE em `checkup`
= **t** · `cerebro_gateway` USAGE em `checkup` = **f** (isolamento clínico ⇄ público mantido).

### V8 — ANALYZE: ✅ executado; `cerebro_v3` local = 240 MB.

## Pendências para o P6 (cutover de apps)

1. Flip das DSNs (`POSTGRES_DSN`, `POSTGRES_DSN_URL` no `.env`; SSM `/cerebro-amigo/checkup/database-url`)
   usando as senhas `PG_LOCAL_*` — **nada foi alterado nesta fase**.
2. Re-dump/reconciliação do schema `checkup` no momento do flip (delta pós-20:10Z).
3. TLS no postgres local antes de receber o checkup ASG (runbook Fase 0 item 3, pendente).
4. Religar os 5 serviços (hoje PARADOS — caminho de crise fora do ar até o P6).
5. Hardening de grants por tabela (REVOKE DELETE nas trilhas imutáveis) — comparar com o
   snapshot final do RDS quando houver acesso master, ou re-derivar do código.

## Gotchas de execução registrados

- `docker exec -i` dentro de script alimentado por pipe/`while read` **consome o stdin do
  loop** — truncou o manifesto na 1ª tabela (corrigido em `backup-postgres.sh` e
  `test-restore.sh`: `-i` só onde há input real; `</dev/null` no resto). Mesma classe de
  bug anulou o primeiro apply de grants (heredoc vs `</dev/null` na função) — reaplicado
  com `-c` e verificado no V7.
- `.env` do host e env dos containers têm `POSTGRES_USER/PASSWORD` (cerebroadmin) **stale**
  desde o hardening de 06-23 — não confiar neles; a fonte de verdade de senha de app é o SSM.
