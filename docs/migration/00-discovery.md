# 00 — Discovery: migração RDS → container pgvector no EC2

> **Data da coleta:** 2026-07-06 · **Sessão:** somente leitura (nenhuma alteração de infra/código)
> **Ferramentas:** AWS CLI (perfil `adonaiarinelli`, conta 004177894935), SSM `AWS-RunShellScript` no box clínico, `docker exec` + asyncpg (role `cerebro_workers`), AWS Pricing API, Cost Explorer.
> **Câmbio usado:** US$ 1 = R$ 5,18 (open.er-api.com, 2026-07-06).

---

## ⚠️ Correções de premissa (leia primeiro)

1. **O box clínico NÃO é t3.large/8 GB.** `cerebro-app` (i-057860cd97edafefb) é **t3.medium — 2 vCPU / 3,7 GiB de RAM utilizável** (downgrade aplicado em 2026-06-21, ver memória de rightsizing). O orçamento de memória "≤ 6,5 GB" pedido só existe se a instância voltar a t3.large — e isso custa **+US$ 49/mês (~R$ 254) on-demand**, porque o Savings Plan (t3/sa-east-1, US$ 0,0772/h) está **99,95% utilizado** pela frota atual (medium + 2× small). Upgrade quase anula a economia da migração. Ver §7.2.
2. **O front Next.js NÃO roda na Vercel.** A migração web→Vercel foi abandonada (ADR-076, LGPD); o web roda no EC2 (`cerebro-web` ASG + ALB) **e** há um container `web` no compose deste box. Irrelevante para o Postgres (web fala com o gateway, não com o banco), mas o compose daqui tem 5 serviços, não 2.
3. **Não existe DbUp/`SchemaVersions` em nenhum database** (verificado; ver §3). A validação pós-migração terá que ser por contagem de linhas (baseline neste doc) + suíte `api-gateway-tests`.
4. **O checkup (ASG separado) conecta direto no RDS** (schema `checkup` dentro do `cerebro_v3`; regra de SG dedicada). Migrar o Postgres para dentro do box clínico exige dar ao checkup um caminho de rede até o box na 5432 — implicação de segurança tratada no §5.

---

## 1. RDS atual

| Item | Valor |
|---|---|
| Identificador | `cerebro-postgres-enc` |
| Engine / versão exata | PostgreSQL **16.13** |
| Classe | **db.t4g.small** (2 vCPU Graviton, 2 GiB) |
| Storage alocado | **20 GB gp3** (3000 IOPS, 125 MB/s) · autoscaling até 100 GB |
| Storage usado | **~1,95 GB** no filesystem (FreeStorageSpace mín. 24h = 18,05 GB) — dados lógicos ~352 MB (§2) |
| Multi-AZ | **false** (Single-AZ desde 2026-06-21) |
| Deletion protection | **true** ⚠️ (precisa desligar na fase final, nunca antes) |
| Cifragem em repouso | Sim — KMS `ae3bc623-68a0-4a2e-bd42-26e9dda65261` (customer-managed) |
| Backup | Retenção **35 dias** (PITR); janela 07:00–07:30 UTC |
| Acesso público | Não (`PubliclyAccessible: false`) |
| Security group | `sg-01b07c7f4a5e0b2c5` (`cerebro-rds-sg`) |
| Endpoint | `cerebro-postgres-enc.ch8u4aig6zs6.sa-east-1.rds.amazonaws.com:5432` |
| Parameter group | `default.postgres16` (in-sync) |
| CA / validade | rds-ca-rsa2048-g1, até 2027-06-14 |
| Snapshots manuais | 2 — `cerebro-postgres-enc-pre-singleaz-2026-06-21` e `mybestbrain-db-snapshot` (2026-06-11, aparenta órfão de outro projeto — revisar) |

### 1.1 Custo mensal atual (estimado, config vigente)

Preços Pricing API sa-east-1: instância db.t4g.small Single-AZ PostgreSQL **US$ 0,069/h**; storage gp3 **US$ 0,219/GB-mês**.

| Componente | US$/mês | R$/mês |
|---|---:|---:|
| Instância (0,069 × 730 h) | 50,37 | 260,90 |
| Storage gp3 (20 GB × 0,219) | 4,38 | 22,70 |
| Backup além do free tier (medido jun) | ~0,58 | ~3,00 |
| KMS (chave customer-managed) | 1,00 | 5,18 |
| **Total steady-state** | **~56,3** | **~R$ 291/mês** |

Sanidade vs fatura real: junho/2026 bruto (sem créditos) do serviço RDS = **US$ 102** — mês atípico (cutover de cifragem em 06-14, Multi-AZ até 06-21, experimentos de classe t4g.medium/micro/t3.small). A config atual estabilizada corresponde ao steady-state acima. **Atenção: o crédito de US$ 200 acabou em junho — a partir de julho a fatura é cheia.**

**Economia bruta ao eliminar o RDS: ~R$ 291/mês (~R$ 3.490/ano).** Custos novos e cenários no §7.

---

## 2. Inventário Postgres (via `cerebro_workers`, BYPASSRLS)

- **Versão exata do servidor:** `16.13`
- **Settings relevantes (RDS hoje):** `shared_buffers` ≈ 413 MB · `effective_cache_size` ≈ 826 MB · `work_mem` 4 MB · `maintenance_work_mem` 64 MB · `max_connections` **181**

### 2.1 Databases e tamanhos

| Database | Tamanho | Observação |
|---|---:|---|
| `cerebro_v3` | **287 MB** | Produção (inclui schema `checkup`) |
| `cerebro` | 57 MB | **V2 legado** — decidir: migrar ou arquivar dump e não restaurar |
| `postgres` | 8 MB | default, só plpgsql |
| `rdsadmin` | — | interno RDS, não migra |

**Total de dados lógicos: ~352 MB.** Banco minúsculo — dump/restore completo leva minutos.

### 2.2 Extensões por database (`\dx`)

| Database | Extensões |
|---|---|
| `cerebro_v3` | `pgcrypto 1.3` · `plpgsql 1.0` · `uuid-ossp 1.1` · **`vector 0.8.1`** |
| `cerebro` | `pgcrypto 1.3` · `plpgsql 1.0` · `uuid-ossp 1.1` · `vector 0.8.1` |
| `postgres` | `plpgsql 1.0` |

Todas disponíveis na imagem `pgvector/pgvector` (vector nativo; pgcrypto/uuid-ossp = contrib incluído). Nenhuma extensão exótica/RDS-only em uso. ✅

### 2.3 Roles não-padrão

| Role | Login | BYPASSRLS | Papel |
|---|---|---|---|
| `cerebroadmin` | ✔ | ✘ (createdb) | Master (única capaz de dump completo — ver nota abaixo) |
| `cerebro_gateway` | ✔ | ✘ | Gateway .NET (RLS ativa, ADR-042) |
| `cerebro_workers` | ✔ | **✔** | Serviços Python |
| `checkup_app` | ✔ | ✘ | Checkup (schema `checkup` apenas) |
| `rds_ad`, `rds_extension`, `rds_reserved` | ✘ | ✘ | Internas RDS — **não migrar** |

> **Nota de permissão (importante p/ o dump):** `cerebro_workers` **não lê** as tabelas do database `cerebro` (V2) nem o schema `checkup` (permission denied na coleta). `pg_dumpall --globals-only` e os `pg_dump` devem rodar como **`cerebroadmin`** (senha no SSM). No destino, recriar as 4 roles com as senhas vigentes dos DSNs (SSM) — sem a role `rds_superuser`, o atributo BYPASSRLS de `cerebro_workers` é aplicado com `ALTER ROLE` normal.

### 2.4 Top 20 tabelas — `cerebro_v3` (baseline de validação)

| # | Tabela | Tamanho total | Linhas (count exato) |
|--:|---|---:|---:|
| 1 | `public.notificacoes_medico` | 147 MB | **264.460** |
| 2 | `public.agente_execucoes` | 110 MB | **395.965** |
| 3 | `public.crise_alerta_eventos` | 1,5 MB | 5.892 |
| 4 | `public.conhecimento` | 1,0 MB | 62 |
| 5 | `public.insights` | 536 KB | 115 |
| 6 | `public.checkpoints` | 176 KB | 32 |
| 7 | `public.checkpoint_writes` | 160 KB | 128 |
| 8 | `public.tomadas_medicacao` | 152 KB | 317 |
| 9 | `public.checkins` | 136 KB | 226 |
| 10 | `public.acessos_prontuario` | 104 KB | 162 |
| 11 | `public.checkpoint_blobs` | 88 KB | 37 |
| 12 | `public.exames_agenda` | 80 KB | 2 |
| 13 | `public.assinaturas` | 80 KB | 5 |
| 14 | `public.social_posts` | 80 KB | 1 |
| 15 | `checkup.funnel_events` | 80 KB | (sem acesso — contar como `checkup_app`/`cerebroadmin` na janela) |
| 16 | `public.pagamentos_manuais` | 80 KB | 1 |
| 17 | `public.social_presenca` | 72 KB | 1 |
| 18 | `public.clientes` | 64 KB | 6 |
| 19 | `public.medicamento_dicionario` | 64 KB | 50 |
| 20 | `public.interacao_catalogo` | 64 KB | 21 |

> 96% do volume são as **trilhas de auditoria imutáveis** (`notificacoes_medico`, `agente_execucoes` — Regra 5 do CLAUDE.md). **Não** "limpar" para encolher a migração.

`cerebro` (V2): topo = `notificacoes_medico` 41 MB; contagens indisponíveis para `cerebro_workers` (recolher como `cerebroadmin` se decidir migrar o V2).

---

## 3. DbUp / SchemaVersions — **não existe**

Verificado em `cerebro_v3`, `cerebro` e `postgres`: nenhum `public."SchemaVersions"`, `schemaversions`, `__EFMigrationsHistory` ou `schema_migrations` (`to_regclass` nulo em todos). O repo confirma: migrations são **SQL manual versionado** em `infra/migrations/0001..0060` aplicadas via SSM/runbook — não há tabela de tracking no banco.

**Validação pós-migração substituta:**
1. Contagens do §2.4 (re-coletar na janela de corte, imediatamente antes do dump final — os números deste doc são de 2026-07-06 e vão andar).
2. `\dx` idêntico (§2.2) + roles (§2.3) + policies RLS presentes (`SELECT count(*) FROM pg_policies` antes/depois).
3. Suíte `apps/api-gateway-tests` (Testcontainers) apontada para o novo DB — pega regressão de RLS/tenant.
4. Objetos da migration mais recente presentes (ex.: artefatos da `0060_escriba_presencial.sql`).

---

## 4. Host (box clínico, via SSM — coletado 2026-07-06)

- **Instância:** `cerebro-app` i-057860cd97edafefb · **t3.medium** (confirmado no metadata) · EIP 18.229.175.231
- **RAM:** 3,7 GiB total · **1,0 GiB em uso** · 2,4 GiB disponível · **Swap: swapfile de 2 GiB** (39 MiB em uso)
- **Disco (`lsblk`/`df`):** 1 volume — `nvme0n1` **20 GB gp3** (vol-03e17318110001912), raiz com **7,7 GB usados / 13 GB livres (39%)**
- **Compose:** 5 serviços, todos `Up 6 days (healthy)`

| Container | Uso real (RSS) | Config compose hoje |
|---|---:|---|
| `web` | 76 MiB | reservation 1g, sem teto (interativo) |
| `api-gateway` | 117 MiB | reservation 1g, sem teto (interativo) |
| `orchestrator-py` | 127 MiB | reservation 2g, sem teto (crise, ADR-009) |
| `agents-py` | 163 MiB | **limit 4g** (calibrado p/ t3.xlarge — desatualizado), cpus 2.0 |
| `notifier-py` | 71 MiB | limit 1g, cpus 1.0 |
| **Total medido** | **~553 MiB** | |

> O comentário do compose ainda diz "calibrado para t3.xlarge/16 GB" — os tetos precisam ser re-calibrados na migração de qualquer forma.

---

## 5. Conectividade e rede

- **EC2 → RDS 5432: OK.** `cerebro-rds-sg` permite TCP 5432 de `sg-0f8f950282b292818` (`cerebro-app-sg`) ✅ e de `sg-0c240ece2f5c0e46f` (checkup ASG) ✅. Teste TCP do box ao endpoint: **ABERTO**.
- **Consequência da migração:** o novo Postgres no box precisa atender **duas origens**:
  1. Containers locais (rede do compose — trivial).
  2. **Checkup ASG** (instância separada) — hoje entra no RDS pela regra própria. Será preciso: publicar a 5432 do container **somente na rede privada** e adicionar ingress no `cerebro-app-sg` TCP 5432 **restrito a `sg-0c240ece2f5c0e46f`** (nunca 0.0.0.0/0 — o box roda o caminho de crise). Alternativa mais isolada: schema `checkup` num segundo container/porta.
- `cerebro-web` não fala com o banco (BFF → gateway) — nada a fazer.
- ⚠️ `cerebro-app-sg` hoje expõe 80/443/3000/5050 a 0.0.0.0/0 — ao virar servidor de banco, revisar se 3000/5050 públicos ainda se justificam (fora de escopo, mas anotar).

---

## 6. Custos silenciosos (varredura sa-east-1)

| Item | Achado | Custo |
|---|---|---|
| NAT Gateways | **Nenhum** ✅ | — |
| EIPs não associadas | **Nenhuma** — as 7 alocações estão em uso (1 no box; 6 são ENIs dos 2 ALBs: 3× `cerebro-web-alb`, 3× `cerebro-checkup-alb`) | — |
| IPv4 públicos cobrados | **9 endereços** (3 instâncias + 6 de ALB) × US$ 0,005/h | **~US$ 32,85/mês (~R$ 170)** — estrutural; reduzir exige repensar os 2 ALBs |
| Volumes EBS `available` | **Nenhum** ✅ (3 volumes, todos in-use: 20 GB app + 8 GB web + 8 GB checkup) | — |
| Snapshots EBS órfãos | **Nenhum** ✅ | — |
| Snapshots RDS manuais | 2 (pré-Single-AZ 06-21 + `mybestbrain-db-snapshot` aparente órfão) | Pequeno (backup storage); deletar o órfão; pós-migração o snapshot final substitui ambos |

---

## 7. Alvo proposto

### 7.1 Imagem

**`pgvector/pgvector:0.8.4-pg16`** (pin exato; tag existente no Docker Hub, verificada).

- Mesmo major do RDS (**16**.13) → dump/restore de paridade, zero surpresa de planner/catálogo. Regra do pedido ("major igual ou superior") atendida com o menor risco.
- `vector` **0.8.4 ≥ 0.8.1** do RDS ✅ (índices são recriados no restore; compatível).
- `pgcrypto` e `uuid-ossp` = contrib, incluídos na imagem ✅.
- Upgrade para `:pg17`/`:pg18` fica para depois, desacoplado da migração (pg_upgrade dentro do container, sem RDS no meio).

### 7.2 Instância e orçamento de memória — decisão prévia obrigatória

**Cenário A — manter t3.medium (recomendado): 3,7 GiB.** Uso real hoje é 553 MiB; o banco tem 352 MB de dados e a caixa é ociosa (CPU ~8%). Postgres cabe com folga. Orçamento (SO + docker + awslogs ≈ 0,8 GiB reservado):

| Container | Reserva | Teto | Tuning |
|---|---:|---:|---|
| **postgres (novo)** | 512 MiB | 1 GiB | `shared_buffers=256MB`, `effective_cache_size=1GB`, `work_mem=4MB`, `max_connections=120` |
| api-gateway | 256 MiB | sem teto (interativo, ADR-009) | Npgsql `Maximum Pool Size=30` no DSN |
| orchestrator-py | 512 MiB | sem teto (caminho de crise) | pools atuais (psycopg3 10 + asyncpg 20) |
| web | 256 MiB | sem teto | — |
| agents-py | 512 MiB | **1 GiB (reduzir de 4g)** | cpus 2.0 → manter |
| notifier-py | 256 MiB | 512 MiB | — |
| **Soma de tetos duros (batch+pg)** | | **2,5 GiB** | uso de regime esperado ≈ 1,3–1,6 GiB; folga > 2 GiB + swap 2 GiB |

Manter a assimetria do ADR-009 (interativo sem teto; OOM killer come o batch primeiro). O postgres ganha teto de 1 GiB **mas** `restart: unless-stopped` + healthcheck: se o banco cai, cai tudo — ver riscos (§8).

**Cenário B — subir para t3.large (8 GiB), como o pedido assumia.** Orçamento ≤ 6,5 GiB: postgres 2 GiB (`shared_buffers=512MB`) · web 768 MiB · gateway 768 MiB · orchestrator 1,5 GiB · agents 1 GiB · notifier 512 MiB = **6,5 GiB** ✔. **Custo:** o Savings Plan está 99,95% utilizado → o delta medium→large é on-demand puro: **+US$ 49,1/mês (~R$ 254)**. Economia líquida da migração cai para **~R$ 20/mês** — na prática, não compensa; só se justifica se houver outro motivo para o upgrade.

### 7.3 Volume EBS de dados

- Dados atuais: 352 MB lógicos / ~1,95 GB no filesystem do RDS (com WAL/overhead).
- Regra do pedido (atuais + 50%, mínimo 20 GB) → **novo volume gp3 de 20 GB, dedicado e cifrado (KMS)**, montado em `/data/postgres`, com o bind-mount do container apontando para ele.
- Motivo do volume dedicado (e não a raiz): snapshot/restore independente do root, DLM por volume, sem competir com build-cache do Docker (histórico de disco a 83%).
- Custo: ~US$ 3/mês (~R$ 16) a preço gp3 EC2 sa-east-1 (~US$ 0,152/GB-mês).
- **Cifragem é inegociável** (LGPD categoria especial; o RDS hoje é encrypted) — criar o volume já com KMS; a cifragem de coluna (ADR-018) segue intacta por cima.

### 7.4 Espaço temporário para dumps

- `pg_dump -Fc` dos 3 databases: ~350 MB brutos → ~100–200 MB comprimidos; `pg_dumpall --globals-only`: KB.
- **Reservar 2 GB** em `/tmp`/staging (margem p/ dump + cópia + logs). Root do box tem **13 GB livres** ✅. Copiar dump para S3 antes do restore (evidência + rollback).

### 7.5 Custo antes × depois (resumo)

| | Hoje (RDS) | Cenário A (t3.medium) | Cenário B (t3.large) |
|---|---:|---:|---:|
| RDS | R$ 291 | 0 | 0 |
| Delta EC2 | 0 | 0 | +R$ 254 |
| EBS 20 GB dados | 0 | +R$ 16 | +R$ 16 |
| S3 backups | 0 | ~R$ 1 | ~R$ 1 |
| **Total mensal** | **R$ 291** | **~R$ 17** | **~R$ 271** |
| **Economia líquida** | — | **~R$ 274/mês** | ~R$ 20/mês |

---

## 8. O que se perde ao sair do RDS (encarar de frente)

1. **PITR de 35 dias** → substituto proposto: `pg_dump` diário → S3 (SSE-KMS, sa-east-1) + snapshot DLM do volume EBS (ex.: 4×/dia, retenção 7d). **RPO piora de ~5 min para horas** — decisão consciente a registrar no ADR (dado clínico!). Streaming/WAL-G é o upgrade futuro se o RPO doer.
2. **Failover/Multi-AZ como opção de um clique** — o gatilho "religar HA no 1º pagante" (ADR-043) morre; HA passa a ser projeto manual.
3. **Patch automático de minor** — passa a ser bump de tag de imagem (operacionalmente simples, mas manual).
4. **SPOF concentrado:** banco + caminho de crise + gateway na mesma t3.medium. O EC2 auto-recovery (alarme já existente) cobre falha de host, não corrupção de disco. Regra 5 (auditoria imutável) agora depende do backup operado por nós.
5. **Storage autoscaling** (20→100 GB automático) — vira alarme de disco + resize manual de EBS.

---

## 9. Checklist go/no-go

**GO exige todos marcados:**

- [ ] **ADR aprovado** registrando a saída do RDS, o novo RPO/RTO e o plano de backup (CLAUDE.md exige ADR p/ mudança estrutural; toca dado de saúde → revisar com `clinical-safety` a parte de disponibilidade do caminho de crise).
- [ ] **Decisão de instância tomada** (A: t3.medium com orçamento §7.2-A — recomendado; B só com justificativa além de custo).
- [ ] Volume EBS 20 GB gp3 **cifrado (KMS)** criado e montado; fstab/`docker compose` apontando pgdata pra ele.
- [ ] Backup novo **funcionando antes do cutover**: cron `pg_dump`→S3 + DLM snapshot do volume, com restore TESTADO uma vez.
- [ ] Caminho de rede do **checkup ASG → box 5432** definido e aplicado (ingress no `cerebro-app-sg` restrito ao SG do checkup; bind não-público), OU decisão de mover o schema `checkup`.
- [ ] Globals (`pg_dumpall --globals-only` como `cerebroadmin`) + 4 roles recriadas com as senhas vigentes do SSM; `cerebro_workers` com BYPASSRLS; **sem** roles `rds_*`.
- [ ] Janela de corte definida: quiesce da aplicação (parar agents/notifier; congelar escrita), dump final, restore, flip dos DSNs (`.env` do box + SSM `/checkup/database-url`), `up -d --force-recreate` (containers Python não releem env em restart simples — gotcha conhecido).
- [ ] Validação pós: contagens §2.4 re-coletadas na janela **batem**; `\dx`, roles e `pg_policies` idênticos; `api-gateway-tests` verde contra o novo banco; smoke dos 5 serviços + checkup funnel-metrics 200.
- [ ] Decisão sobre o database `cerebro` (V2 legado, 57 MB): migrar junto ou arquivar dump no S3 e não restaurar (recomendado: arquivar).
- [ ] **Snapshot final do RDS tirado e retido** antes de qualquer delete; `deletion-protection` desligada só no momento do descomissionamento; instância parada (não deletada) por 7 dias de quarentena antes do delete definitivo.
- [ ] Monitoração ajustada: healthcheck do container postgres no compose + watchdog `/health`; alarmes CloudWatch de disco (novo volume) e memória; remover alarmes RDS depois.

**NO-GO / adiar se:**

- RPO de horas for inaceitável para dado clínico neste estágio (sem eng. adicional de WAL streaming);
- For necessário t3.large (economia líquida ~R$ 20/mês não paga o risco operacional);
- Perspectiva próxima de religar Multi-AZ (1º pagante) — voltaria a apontar para managed DB;
- Não houver janela segura para o cutover com o piloto ativo.

---

*Baseline coletado em 2026-07-06. Re-coletar contagens e tamanhos na janela de corte — estes números envelhecem.*
