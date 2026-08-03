# Runbook — Smoke E2E: entrega garantida do alerta de crise (ADR-041, Fase 1)

Valida os 3 caminhos: e-mail imediato · fail-safe (Resend fora ainda escala) · ack para a escada.

**Pré-requisitos:** código deployado (PR #28 mergeado em `main` → deploy) em staging ou prod; migration `0035` aplicada (já está em prod); 1 médico de teste com e-mail real; 1 paciente de teste vinculado a ele.

**Atalho p/ não esperar 10/30 min:** no serviço notifier, setar temporariamente `CRISE_ACK_TIMEOUT_SEGUNDOS=30` e `CRISE_OPS_TIMEOUT_SEGUNDOS=60` + restart do container. **Reverter no fim** (600/1800).

**Acesso ao banco (EC2 `i-057860cd97edafefb`):** `POSTGRES_DSN` está em formato Npgsql (`Host=..;Port=..;Database=..;Username=..;Password=..`) — NÃO dá `source .env`. Ler com `grep '^POSTGRES_DSN='` e converter chaves (Host→host, Database→dbname, Username→user) pra conninfo do psql (`/usr/bin/psql` no host).

---

## Cenário 1 — caminho feliz (e-mail imediato, não no próximo tick)
1. Como paciente de teste, no portal, envie mensagem que o classificador marque como risco (ideação/autolesão).
2. Verifique (psql):
   ```sql
   SELECT id, paciente_id, criado_em FROM protocolos_crise_acionados ORDER BY criado_em DESC LIMIT 1;  -- guarde <id>
   SELECT canal, evento, estagio, detalhe, criada_em FROM crise_alerta_eventos WHERE protocolo_id = '<id>' ORDER BY criada_em;
   ```
   **Esperado:** linha `in_app / enviado / 0` (na hora, gravada pelo orchestrator) **+** linha `email / enviado / 0` em **segundos** (trigger imediato — NÃO espera 60s do watchdog).
3. Confirme o e-mail na caixa do médico de teste (assunto "Cérebro Amigo · atenção prioritária a um paciente"; sem detalhe clínico).

## Cenário 2 — FAIL-SAFE (Resend fora → escala por tempo mesmo assim)
1. Quebre o Resend no notifier: `RESEND_API_KEY=re_invalido` (ou bloqueie egress HTTPS) + restart do notifier.
2. Dispare nova crise (passo 1 do Cenário 1). Guarde `<id2>`.
3. Acompanhe a trilha enquanto o tempo passa (com timeouts reduzidos):
   ```sql
   SELECT canal, evento, estagio, detalhe, criada_em FROM crise_alerta_eventos WHERE protocolo_id='<id2>' ORDER BY criada_em;
   ```
   **Esperado:** `email/falhou/0` (repetido) → após `CRISE_EMAIL_MAX_TENTATIVAS`: `ops/falhou/0 (email_indisponivel)` → após ack_timeout: `ops/enfileirado/1 (sem_ack_estagio1)` → após ops_timeout: `ops/falhou/2 (sem_ack_estagio2)`. **A escada SOBE sem e-mail** (é o fail-safe). Confirme `logger.critical` nos logs do notifier (`crise.alerta.email_indisponivel`, `crise.alerta.sem_ack`).
4. Restaure `RESEND_API_KEY` + restart.

## Cenário 3 — ack para a escada
1. Com uma crise aberta, no dashboard do médico: abra o paciente → banner de crise → clique **"Estou ciente"**.
2. Verifique:
   ```sql
   SELECT canal, evento, estagio, detalhe FROM crise_alerta_eventos WHERE protocolo_id='<id>' AND evento='confirmado';
   ```
   **Esperado:** linha `in_app / confirmado` (detalhe `ack_dashboard`).
3. Espere 2 ticks do watchdog (~2 min) → **nenhum evento novo** (escada parada).
4. Repita com **"Retomar automação"** em outra crise → deve gravar `confirmado` (detalhe `retomar`) **e** limpar `pacientes.automacao_pausada`.

---

## Pós-smoke
- Reverter `CRISE_ACK_TIMEOUT_SEGUNDOS` / `CRISE_OPS_TIMEOUT_SEGUNDOS` para 600 / 1800 + restart.
- **NÃO** apagar linhas de `protocolos_crise_acionados` / `crise_alerta_eventos` (append-only / auditoria). Use paciente de teste descartável; os registros de teste ficam na trilha (esperado).
