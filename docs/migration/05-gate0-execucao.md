# 05 — Gate 0: execução do flip do checkup (2026-07-06)

> **Desfecho:** flip **EXECUTADO** (parâmetro v3→v4, RDS→local), split-brain **encerrado**,
> merge **dispensado** (delta zero provado), rollback **preparado e não usado**.
> **Ressalva material:** E2E de superfície ✅, E2E de **persistência ✗** — o driver Node do
> checkup rejeita o cert self-signed (verify-full CK-3 hardcoded). Fix de código commitado
> nesta branch; **o relógio de 48h do checkup NÃO iniciou** — só inicia após deploy do fix
> + persistência provada. Checkup segue NO AR servindo teste/PDF (fail-open by design).

## Linha do tempo (UTC)

| Hora | Evento |
|---|---|
| 21:40 | Pré-janela ok: v3 salva p/ rollback (root-only), consumidor único (userdata do LT), ssl=on, auth `checkup_app` local ok, permissões testadas |
| **21:41:08** | **Janela abre** — ASG `min=0/desired=0` |
| 21:43:04 | ASG vazio (instância terminada) |
| 21:43–21:48 | Drenagem "não zerava": **falso positivo** — o loop consultava o RDS como `checkup_app` e contava a própria sessão. Corrigido (`pid <> pg_backend_pid()`) → **0 real** |
| 21:50:09 | **Audit final: tudo idêntico (incl. md5 de rate_limits) → merge DISPENSADO** (§04) |
| 21:52 | Flip via box **negado** (role sem `ssm:PutParameter`); auto-grant de IAM temporária **bloqueado pelo modo da sessão** (corretamente — invariante) → comandos emitidos ao operador |
| 21:58 | Operador aplica IAM temporária escopada (`TempGate0CheckupFlip`, só o parâmetro) |
| 21:59:30 | **Operador executa o flip** (send-command; senha nunca saiu do box) → **parâmetro v4**: `postgresql://checkup_app:***@172.31.4.97:5432/cerebro_v3?sslmode=require` (validado mascarado) |
| 22:00:01 | Subida: `min=1/desired=1` |
| ~22:04 | Instância nova `i-056140c8eacbc6d98` InService/Healthy; target ALB `healthy`; `/api/health` 200 |
| 22:10 | E2E: `test_started`/`test_completed`/`result`/`report_generated` → 200; **PDF real** (application/pdf, 22,8 KB, 1 pág) |
| 22:11 | **Prova de destino falha**: nenhuma linha nova no local **nem no RDS**; RDS com 0 conexões `checkup_app` |
| 22:14 | Causa raiz nos logs do container: `self-signed certificate` — driver `postgres.js` com `ssl:{ca:RDS_CA, rejectUnauthorized:true}` hardcoded p/ host não-local |
| 22:2x | IAM temporária **removida**; fix de código commitado (branch); decisão: **manter no local, sem rollback** |

**Downtime da superfície pública: ~23 min** (21:41→22:04; estimados 10 — o excedente foi
o vaivém de permissões do flip).

## Versões do parâmetro SSM

- Antes: **v3** (RDS) — Value preservado em `/var/lib/cerebro-backup/checkup-dsn.v3` (root-only).
- Depois: **v4** (local, `172.31.4.97/cerebro_v3`, `sslmode=require`), chave `alias/aws/ssm` (sem `--key-id`).
- Rollback (não usado): re-put do Value da v3 + ciclo `desired 0→1`.

## E2E — evidências (mascaradas)

- Sessão de teste: `f70b7813-...` · eventos e `result` com `{"ok":true}` [200] · PDF binário válido.
- **(b) prova de ausência de writer residual no RDS: ✅** — contagens do RDS congeladas
  (42/29/2/1/0/0/0), sessão do E2E ausente no RDS, `pg_stat_activity` = 0.
- **(a) persistência no local: ✗** — sessão ausente também no local. Logs do container:
  `Error: falha ao gravar funnel_event/test_result ... self-signed certificate`.
  O `getDb()` é fail-open (responde `ok:true` e loga) — comportamento de design (CK-2),
  que mascarou a falha no smoke de status HTTP.

## Causa raiz e correção

`apps/checkup/src/lib/db/index.ts` força verify-full com a **CA do RDS embarcada** para
qualquer host não-localhost (CK-3). Com o Postgres self-hosted (cert self-signed, sem SAN
de IP), a verificação falha sempre — `sslmode` da URL é irrelevante (a opção `ssl` do
construtor prevalece). **Fix commitado nesta branch:** host RFC1918 → TLS com
`rejectUnauthorized:false` (cifra; anti-MITM intra-VPC delegado ao SG 5432 SG-to-SG);
hosts RDS mantêm verify-full. `tsc` PASS. Evolução registrada: cert com SAN
(IP/`db.cerebro.internal`) + CA própria via env → verify-full também no caminho interno.

## Fechamento do Gate 0 — 2026-07-06T22:29Z ✅

1. **Deploy do fix:** PR #167 mergeado 22:20Z → CI build checkup → instance refresh
   **Successful 100%** (~22:28Z), imagem `fba6fb7…`. (O build **clínico** do mesmo run
   falhou por NU1903 pré-existente em `Microsoft.OpenApi` 2.0.0 — advisory
   GHSA-v5pm-xwqc-g5wc; pin 2.7.5 em PR próprio. Stack clínico seguiu saudável na
   imagem anterior; box re-sincronizado com o main do merge via SSM.)
2. **E2E de persistência PROVADO (22:29Z):** local `funnel_events` 42→45 e
   `test_results` 1→2 com a sessão do E2E presente; **RDS congelado** (contagens
   idênticas às do audit, sessão ausente, 0 conexões `checkup_app`); PDF real gerado.
3. **Relógio de 48h do checkup: iniciado 2026-07-06T22:29Z → fecha 2026-07-08T22:29Z.**
   Gate de delete do RDS abre em 2026-07-09T20:25Z (72h do stack, o mais tardio).

Perda aceita no interím: telemetria de funil/resultados consentidos do checkup não
persistem (tráfego test mode ~zero; nada clínico; rate-limit degrada para fail-open).
Rollback ao RDS foi considerado e rejeitado: reintroduziria o split-brain para salvar
telemetria ~nula.
