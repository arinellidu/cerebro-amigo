# ADR-042: Isolamento de tenant em profundidade — least-privilege + RLS

**Status:** Accepted — TODAS as camadas em produção. Camada A (guards), Estágios 0
(roles + swap de DSN), 3 (testes/CI) e 1+2 (middleware + RLS) deployados e
verificados em 2026-06-08. RLS LIVE: 17 tabelas, fail-closed confirmado em prod.
**Data:** 2026-06-08
**Decisores:** Equipe de engenharia + Patrick Arinelli (responsável pelo projeto)
**Categoria:** Segurança / LGPD (categoria especial — saúde mental)

## Contexto

Auditoria de isolamento de tenant (2026-06-08) achou e confirmou **7 vazamentos
cross-tenant REAIS** em produção — um médico autenticado lia/alterava dado de
paciente de OUTRO médico (IDOR), inclusive medicação/dose e takeover de conta via
magic-link. Todos por **um WHERE de tenant esquecido** na aplicação. O isolamento
era 100% manual (cada query repete o predicado de tenant), sem rede de segurança.
Tenant = `medicos.id`; âncora = `pacientes.medico_responsavel_id`.

Pior: **todos os serviços conectavam como `cerebroadmin`** (RDS master =
rds_superuser E dono das tabelas), que **bypassa RLS** — qualquer policy seria
inócua enquanto isso fosse verdade.

## Decisão

Defesa em profundidade, em camadas independentes:

- **Camada A — guards na aplicação:** corrigir os 7 IDOR ancorando cada query no
  tenant do JWT (`JOIN pacientes ON p.cliente_id = t.paciente_id AND
  p.medico_responsavel_id = @medico`, ou `medico_id = @medico` nas tabelas com
  coluna direta). Convenção: o filtro de tenant é a 1ª cláusula, nunca opcional.

- **Estágio 0 — roles least-privilege (0036):** aposentar `cerebroadmin` no
  runtime. Gateway → `cerebro_gateway` (NOSUPERUSER, **NOBYPASSRLS**); serviços
  Python → `cerebro_workers` (NOSUPERUSER, **BYPASSRLS** — fazem scans
  cross-tenant legítimos via scheduler, e precisam de `CREATE` no schema para o
  checkpointer do LangGraph). Sem isso a RLS não valeria.

- **Estágio 3 — suíte de regressão (apps/api-gateway-tests):** Testcontainers
  sobe Postgres real, aplica as migrations, seeda 2 médicos e prova que A não
  acessa dado de B. Job CI `dotnet-tests` no PR — pega a classe dos 7 IDOR antes
  do merge.

- **Estágios 1+2 — RLS fail-closed (0037 + TenantSessionMiddleware):** rede no
  banco para o WHERE futuro esquecido.
  - **RLS ENABLE (não FORCE):** o dono (`cerebroadmin`, migrations) e
    `cerebro_workers` (BYPASSRLS) seguem livres; só `cerebro_gateway` é filtrado.
  - **GUC de sessão por request:** o `TenantSessionMiddleware` abre a conexão do
    DbContext e seta, conforme o JWT, `app.current_medico` (médico),
    `app.current_paciente` (portal) ou `app.tenant_bypass=on` (owner/admin). Todas
    as queries do request reusam a conexão (o `DbExtensions` não fecha conexão já
    aberta), então o GUC vale para todas. Reset no fim + reset-on-close do Npgsql.
  - **Policy** (`NULLIF(current_setting(...,true),'')::uuid` para tratar
    ausência/reset): `bypass OR paciente dono OR médico dono (via pacientes)`.
    Sem GUC → NULL/false em tudo → **zero linhas (fail-closed)**.
  - **Escopo iteração 1:** tabelas-folha clínicas (prescricoes, sintomas,
    consultas, evolucoes_clinicas, consulta_transcricoes, diario_entradas,
    checkins, notificacoes_medico, etc.). FORA: tabelas que DEFINEM o tenant
    (medicos/pacientes/clientes/usuarios — lidas para estabelecer o tenant) e
    auth/webhook/catálogos.

## Alternativas descartadas

- **`SET LOCAL` em transação por request:** exigiria envolver todo request numa
  transação. Quebraria os inserts best-effort com try/catch (GravarEvento,
  RegistrarAcessoProntuario): no Postgres, um erro dentro da transação aborta
  tudo, e o catch não salvaria. `set_config(...,false)` (sessão, autocommit
  preservado) evita isso.
- **FORCE ROW LEVEL SECURITY:** filtraria também o dono (migrations) e exigiria
  bypass explícito para os workers. ENABLE já dá o efeito desejado.
- **Só guards na aplicação:** foi o que falhou (7 IDOR). Mantidos, mas com RLS
  por baixo.

## Consequências

- Um WHERE esquecido no futuro **não vaza** — a RLS barra o `cerebro_gateway`.
- Custo: subquery `EXISTS pacientes` por linha nas tabelas via paciente_id
  (mitigado pelos índices `pacientes(cliente_id)` PK e `(medico_responsavel_id)`).
- Acoplamento: todo acesso do gateway a tabela com RLS depende do middleware ter
  setado o GUC. Endpoints anônimos/internos NÃO tocam as tabelas no escopo —
  verificado. Workers bypassam.
- Validação: 15 testes verdes (9 HTTP com o gateway como role restrito + RLS
  ativa; 6 de RLS direto no banco: fail-closed, isolamento A↔B, bypass, dimensão
  paciente).

## Rollout (prod) — ORDEM IMPORTA

1. **Deploy do gateway com o middleware PRIMEIRO** (RLS ainda não habilitada → o
   middleware seta GUCs que ninguém lê → zero mudança de comportamento).
2. **Aplicar 0037** (habilita RLS). Efeito imediato; o gateway já está em
   `cerebro_gateway` (NOBYPASSRLS, swap de DSN feito 2026-06-08).
3. **Verificar** um fluxo de médico em prod (lê prontuário, registra prescrição).
4. **Rollback instantâneo** se algo quebrar: `ALTER TABLE <t> DISABLE ROW LEVEL
   SECURITY` nas tabelas da 0037.

> Invertendo a ordem (0037 antes do middleware) o gateway fail-close TUDO (sem
> GUC, RLS nega) e o app cai. Nunca aplicar 0037 sem o middleware já no ar.

## Iteração 2 — estender RLS às tabelas que faltaram (0038)

**Status:** **DEPLOYADO + verificado em prod (`cerebro_v3`) 2026-06-09.** Migration
`0038_rls_tenant_iteracao2.sql` aplicada via SSM como `cerebroadmin` (atômica, -1);
6 tabelas com `rowsecurity=true` + policy `tenant_iso` (total RLS 17→23). Motor RLS
re-confirmado vivo (prescricoes, 5 linhas: `cerebro_gateway` sem GUC → 0 fail-closed,
GUC=médico A → 5, GUC=médico B → 0 isolado, bypass → 5). As 6 tabelas-alvo estão
vazias em prod hoje (portal conversacional sem uso real), então a prova positiva
veio dos 30 testes locais + do motor em prescricoes; as policies estão instaladas e
filtram quando houver dado. 0 erro de RLS/permissão nos 5 containers; gateway
/ready=200; watchdog de crise do notifier (cerebro_workers, BYPASSRLS) intacto.

> ⚠️ **Gotcha de deploy (custou um susto):** o `/opt/cerebro/.env` do EC2 está STALE
> (`POSTGRES_DB=cerebro` = V2 legado). O app de prod usa o database **`cerebro_v3`**
> (provado pelos 5 containers em runtime). A 1ª tentativa aplicou mirando o `.env` →
> caiu no `cerebro` legado e **falhou atômica (zero dano)**. Sempre FORCE
> `PGDATABASE=cerebro_v3` ao aplicar migration via SSM. Ver runbook.

Recon de 2026-06-08 (5 frentes) resolveu uma premissa errada das notas: os 3
serviços Python **já** conectam como `cerebro_workers` (lêem `POSTGRES_DSN_URL`,
não os componentes `POSTGRES_*`) — o objetivo "role não-superuser p/ Python" já
estava cumprido na iteração 1. O que faltava era cobertura de tabelas.

A 0038 habilita RLS (ENABLE, policy `tenant_iso`, fail-closed) em 6 tabelas que a
0037 não pegou, todas lidas/escritas diretamente pelo `cerebro_gateway`:

| Tabela | Âncora de tenant | Policy |
| --- | --- | --- |
| `conversas` | `cliente_id` (= `clientes.id`) | 2-hop: paciente dono OU médico via `pacientes` |
| `mensagens` | `conversa_id` → `conversas` | 3-hop: subquery reusa a regra de `conversas` |
| `crise_alerta_eventos` | `medico_id` (nullable) | direto (igual `notificacoes_medico`) — fecha leak de alerta de crise entre tenants |
| `condutas_eventos` | `paciente_id` | 1-hop (irmã de `condutas_automacao`, passou batido na 0037) |
| `receitas_memed` | `paciente_id` | 1-hop |
| `acessos_prontuario` | `medico_id` | direto (log de acesso pertence ao médico-ator) |

**Fora de escopo (decisões):**
- **`cobrancas`:** o webhook do Asaas (`POST /api/v1/asaas/webhook`,
  `AllowAnonymous`) escreve sem JWT → o middleware não seta GUC → a RLS barraria o
  `UPDATE` de pagamento (fail-closed). O isolamento segue no WHERE da aplicação até
  o webhook ganhar um `app.tenant_bypass` explícito (follow-up).
- **`social_*`** (rede médico↔médico): modelo de acesso distinto, não é tenant de
  paciente.
- **Apertar o orchestrator** (BYPASSRLS → role própria + `set_config` por request):
  **iteração 3**. Refactor Python com risco no caminho de crise; o recon mostrou
  que toda query do orchestrator já é escopada por paciente, então o ganho é
  defesa-em-profundidade, não fechar um vazamento aberto.

**Validação:** testes de regressão (apps/api-gateway-tests) estendidos com deny
cross-tenant em conversas/mensagens + controles positivos; gateway de teste conecta
como role NOBYPASSRLS para a RLS valer.

## Estágios futuros

- **Iteração 3** — apertar `cerebro_workers`/orchestrator: role própria
  (NOBYPASSRLS) + `set_config(app.current_medico/paciente)` por request de conversa,
  tratando o checkpointer do LangGraph (CREATE) e os INSERTs de crise sob RLS.
- Webhook Asaas com bypass explícito → então cobrir `cobrancas` com RLS.
- Ver memória `project-tenant-isolation` e `project-infalivel-top5`.
