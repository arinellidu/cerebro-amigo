# Runbook — rotação de segredos vazados no git (2026-06)

`.env` esteve **commitado** no histórico (commits `ff7a28d`, `5cf4291`, `178fc6c`; removido do
tracking em `90c244b`). Todos os segredos abaixo estão no histórico do git → se o repo foi/é
clonado ou público, vazaram. Rotacionar mata o valor vazado (não reescrevemos histórico —
clones já existem; rotação é o fix correto).

**RECALIBRAÇÃO (2026-06-11):** repo é **PRIVADO, 0 forks** (`gh repo view` → isPrivate:true);
Anthropic console "último uso = NUNCA". Risco real das vazadas = **BAIXO** → rotação é
**higiene, não urgência**. Fazer com calma, sem pressa de janela. Estado Anthropic:
- Clínica: nova `V6RqF09…` gerada hoje, está SÓ no `.env` LOCAL (dev). BOX ainda roda a velha →
  aplicar via comando de rotação clínica quando quiser. Confirmar velha REVOKED no console.
- Checkup: SSM `/cerebro-amigo/checkup/anthropic-api-key` = ainda a vazada `cbosSGr9…` (funcional).
  NÃO rotacionada. Rotacionar = nova key SEPARADA no console → eu SSM + instance refresh do ASG.
  (GOTCHA 2026-06-11: NÃO reusar a key clínica no checkup — viola isolamento; já corrigido um
  engano onde a clínica V6RqF09 foi parar no SSM do checkup + refresh; revertido p/ cbosSGr9.)

Status: `[ ]` pendente · `[~]` em andamento · `[x]` rotacionado+verificado.

## Prioridade 1 — abusável da INTERNET por qualquer um (só Patrick rota, nos consoles)

Zero impacto clínico em rotacionar (troca no console + atualiza env). FAZER PRIMEIRO.

- [ ] **MEMED** (`MEMED_API_KEY`, `MEMED_SECRET_KEY`) — prescrição digital / receita. MAIS sensível.
      Console MEMED → gerar novas → atualizar `.env` do box.
- [~] **Anthropic** (`ANTHROPIC_API_KEY` clínico + `CHECKUP_ANTHROPIC_API_KEY`) — gasto $$.
      Patrick gerou nova hoje (2026-06-11). CONFIRMAR: a key VELHA (vazada) está REVOKED no
      console (não só criada nova) + box rodando a nova (não só `.env` local). Checkup →
      SSM `/cerebro-amigo/checkup/anthropic-api-key` + instance refresh do ASG.
- [ ] **Resend** (`RESEND_API_KEY`) — DEFERIDO p/ migração SES-clínico (Patrick). RISCO RESIDUAL:
      clínico AINDA usa Resend (magic-link médico); a key vazada segue VIVA até o SES assumir
      o magic-link. Rotacionar agora OU expedir SES-clínico + revogar. Não esquecer.
- [ ] **Infosimples** (`INFOSIMPLES_TOKEN`) — validação CRM (pago). Painel Infosimples.
- [ ] **LangSmith** (`LANGSMITH_API_KEY`) — smith.langchain.com → revoke.
- [ ] **Sentry** (`SENTRY_AUTH_TOKEN`) — valor no `.env` parece placeholder (`sntrys_eyxxxxxxxx`); confirmar.

## Prioridade 2 — coordenado, com restart clínico (blip controlado; RDS já privado = menos urgente)

Cada um exige atualizar `.env` do box + recriar serviços. Fazer em janela calma, Patrick presente.

- [ ] **Senha master RDS** (`POSTGRES_PASSWORD` / `POSTGRES_DSN` / `POSTGRES_DSN_URL` = `cerebroadmin`).
      Claude: `aws rds modify-db-instance --master-user-password <novo> --apply-immediately`.
      IMEDIATAMENTE depois: box `.env` (3 vars) + `docker compose up -d --force-recreate api-gateway orchestrator-py agents-py notifier-py`. checkup NÃO afetado (já é `checkup_app`).
      Janela de risco: conexões NOVAS com senha velha falham até o restart. Pool sobrevive.
- [ ] **JWT_SECRET** — rotacionar desloga todos os médicos (re-login). Gerar + box + restart gateway.
- [ ] **INTERNAL_API_TOKEN** — auth entre serviços; trocar em TODOS ao mesmo tempo (gateway+3 py).
- [ ] **TURN_SECRET** — teleconsulta; gerar + gateway + coturn.
- [ ] **VAPID** (`VAPID_PRIVATE_KEY` + `NEXT_PUBLIC_VAPID_PUBLIC_KEY`) — rotacionar quebra subscriptions
      de push existentes (clientes re-inscrevem). Atualiza build do web também.

## Pós-rotação

- [ ] Confirmar nenhum serviço com segredo velho (logs/health).
- [ ] Avaliar `git filter-repo`/BFG p/ limpar histórico (opcional; clones já podem ter copiado).
- [ ] Garantir `.env` no `.gitignore` (já está) e que ninguém re-adiciona.
