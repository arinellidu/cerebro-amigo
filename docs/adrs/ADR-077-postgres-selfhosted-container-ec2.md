# ADR-077 — Postgres self-hosted: container pgvector no EC2 (saída do RDS)

Status: Aceito · Data: 2026-07-06 · Revisa: ADR-043 (postura de HA do piloto: gatilho de religar Multi-AZ) · Relacionado: ADR-018 (cifragem em repouso), ADR-042 (RLS multi-tenant), ADR-045 (checkup conecta no mesmo RDS)

> Base factual: `docs/migration/00-discovery.md` (discovery de 2026-07-06, somente leitura).
> Execução: `docs/migration/01-runbook.md` (cutover em fases, rollback por fase).

## Contexto

- **Produto pré-receita, em test mode.** Não há cliente pagante com expectativa de SLA;
  o único MRR é simbólico (smoke de cobrança). Nenhum SLA externo foi prometido.
- **O EC2 já está pago.** Savings Plan t3/sa-east-1 (US$ 0,0772/h) ativo até **2027-06-18**,
  99,95% utilizado pela frota atual — o box clínico é custo afundado e está ocioso
  (CPU ~8%, 553 MiB de RAM usados de 3,7 GiB).
- **O RDS é o maior custo variável:** `cerebro-postgres-enc` (db.t4g.small Single-AZ,
  20 GB gp3, PG 16.13) custa **~US$ 56/mês (~R$ 291)** em steady-state — para servir
  **352 MB de dados lógicos**. Os créditos AWS acabaram em junho/2026; de julho em
  diante a fatura é cheia.
- O banco é pequeno, o workload é leve e as defesas estruturais (RLS ADR-042, cifragem
  de coluna ADR-018, trilhas imutáveis) vivem **no schema e na aplicação**, não no RDS.

## Decisão

Sair do RDS e rodar o Postgres **no próprio box clínico**, como container do compose:

1. **Imagem:** `pgvector/pgvector:0.8.4-pg16` (pin exato). Mesmo major do RDS (16.13);
   `vector 0.8.4 ≥ 0.8.1`; `pgcrypto`/`uuid-ossp` inclusos. Upgrade de major fica
   desacoplado (bump de tag + `pg_upgrade`, sem RDS no meio).
2. **Dados em volume EBS dedicado:** 20 GB gp3 **cifrado (KMS)**, montado fora do
   root (`/var/lib/cerebro-pgdata`), bind-mount no container. Snapshot/restore
   independentes do disco raiz; LGPD categoria especial exige cifragem em repouso —
   o RDS já era encrypted, o volume novo nasce encrypted.
3. **Backups diários:** `pg_dump -Fc` (todas as databases + `pg_dumpall --globals-only`)
   → **S3 (SSE-KMS, sa-east-1)**, retenção 35 dias (paridade com o RDS). Snapshot DLM
   diário do volume EBS como segunda camada. **Restore-test mensal** obrigatório
   (backup que nunca foi restaurado não é backup).
4. **Objetivos de recuperação: RPO 24 h · RTO 1 h.** Degradação consciente vs o PITR
   de ~5 min do RDS — aceitável apenas porque não há cliente pagante (ver gatilho
   de reversão).
5. **Nada muda nas defesas estruturais:** roles (`cerebro_gateway` NOBYPASSRLS,
   `cerebro_workers` BYPASSRLS, `checkup_app`), policies RLS, cifragem de coluna e
   trilhas imutáveis são recriadas 1:1 via dump/restore e validadas por
   `apps/api-gateway-tests`. TLS permanece ligado (cert self-signed; DSNs seguem
   `sslmode=require`). O checkup (ASG separado) passa a alcançar a 5432 do box por
   regra de SG restrita ao SG dele — nunca 0.0.0.0/0.
6. **Cutover faseado com o RDS intacto até o fim** (runbook 01): até o
   descomissionamento, rollback = reapontar connection strings para o RDS.

## Alternativas consideradas

- **Manter o RDS como está** — mais seguro operacionalmente, mas R$ 291/mês sem
  receita para 352 MB de dados. Rejeitado agora; **é exatamente o plano de reversão**.
- **Downgrade para db.t4g.micro** — 1 GiB não comporta o working set (medição de
  junho/2026); economia parcial mantendo o custo fixo do managed. Rejeitado.
- **Postgres gerenciado de terceiros (Neon/Supabase/etc.)** — residência do dado fora
  do controle em sa-east-1/BR compromete LGPD categoria especial (mesmo racional que
  abortou a migração web para a Vercel, ADR-076). Rejeitado.
- **Aurora Serverless v2** — piso de ACU + storage custa igual ou mais que o RDS atual
  para este workload. Rejeitado.

## Consequências

### Aceitas (com os olhos abertos)

- **Single point of failure assumido:** banco, gateway e caminho de crise na mesma
  t3.medium. O auto-recovery do EC2 (alarme já em prod) cobre falha de host; corrupção
  de disco/dados agora se resolve por backup (RPO 24 h). As **trilhas de auditoria
  imutáveis (Regra 5)** ficam sujeitas ao mesmo RPO — risco registrado.
- **Operação de DBA internalizada:** backup + verificação, restore-test mensal,
  patching de minor (bump de tag de imagem), vacuum/bloat, monitoração de disco e
  conexões. Sem janela de manutenção gerenciada, sem storage autoscaling (vira alarme
  de disco + resize manual do EBS), sem Multi-AZ de um clique.
- **RPO piora de ~5 min (PITR 35d) para 24 h** — perda de até 1 dia de dados em
  desastre. Tolerável somente em test mode; é o primeiro item a morrer no gatilho
  de reversão.

### Positivas

- **Economia líquida ~R$ 274/mês (~R$ 3,3 mil/ano):** sai R$ 291 do RDS, entram
  ~R$ 17 (EBS 20 GB + S3). Maior custo variável da conta eliminado.
- Latência de banco local (mesmo host para gateway/orchestrator).
- Paridade dev/prod maior (mesma imagem pgvector em qualquer ambiente).

## Gatilho de reversão (explícito)

> **Primeiro cliente pagante com expectativa de SLA ⇒ retorno a banco gerenciado.**

Sinal objetivo: assinatura ativa de cliente real (não smoke) OU contrato/proposta que
mencione disponibilidade/SLA. Ao disparar: provisionar RDS novo (restore do backup
S3/snapshot EBS), flip de DSNs (mesmo mecanismo do runbook 01, na direção inversa),
religar PITR/Multi-AZ conforme o caso. Este gatilho **substitui** o do ADR-043
("religar Multi-AZ no 1º pagante") — a volta é para o *managed*, não só para o Multi-AZ.

### Gatilhos de revisão adicionais

- Qualquer incidente com perda de dados (mesmo dentro do RPO) → reavaliar imediatamente.
- Dados > 10 GB ou workload deixar de ser ocioso → re-dimensionar (o orçamento de
  memória atual assume t3.medium ociosa).
- Exigência regulatória/clínica de RPO < 24 h → WAL streaming (wal-g) ou volta ao managed.
