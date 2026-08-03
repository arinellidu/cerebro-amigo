# Runbook — ativação manual de assinatura (paywall ADR-055, sem Asaas)

> Libera o acesso de um médico ao dashboard **sem cobrança automática Asaas** — enquanto
> o Asaas produção não está no ar (runbook `asaas-prod-cutover.md`), ou para pagamento
> offline / cortesia / comodato. É o fallback do paywall (ADR-055).

## Quando o gate bloqueia (contexto)

O gate (`AssinaturaGate.Avaliar`, ADR-055 Fase D) decide pelo `assinaturas.status`:

| status | acesso ao dashboard |
|---|---|
| `ativa` | **liberado** |
| `pendente` + dentro de `prazo_pagamento_ate` | liberado (com banner de aviso) |
| `pendente` + `prazo_pagamento_ate` vencido | **BLOQUEADO** (paywall) |
| `suspensa` / `cancelada` | **BLOQUEADO** |
| `trial` não-vencido (legado) | liberado |
| sem linha em `assinaturas` | liberado (fail-open) |

> **Invariante clínica:** o gate NUNCA bloqueia crise/portal-paciente/notificação. Ativação
> manual é só sobre acesso ao dashboard do médico.

Ativar manualmente = colocar a assinatura em **`status='ativa'`**.

## Passo a passo

### Pré
- O médico já tem uma linha em `assinaturas` (criada no onboarding).
- Você é `owner`/`admin` (endpoints `/api/v1/admin/*`).

### Achar a assinatura
- UI: **`/admin/financeiro`** (lista as assinaturas com plano/valor/status) — ou `/admin/medicos/{id}`.
- API: `GET /api/v1/admin/assinaturas` → pega o `assinatura_id` do médico.

### Opção A (recomendada) — via UI `/admin/financeiro`
1. Abra `/admin/financeiro`, localize o médico.
2. Edite a assinatura: defina **Plano** + **Valor mensal** reais e **Status = `ativa`**.
3. Salvar. (Opcional: registre o pagamento recebido — ver "Trilha" abaixo.)

### Opção B — via API
```bash
# Ativa direto (funciona p/ pendente, trial, suspensa → ativa):
PATCH /api/v1/admin/assinaturas/{assinaturaId}
{ "status": "ativa", "plano": "pro", "valor": 197.00 }
# (campos aceitos: plano ∈ {trial,starter,pro,enterprise}; status ∈ {trial,ativa,suspensa,cancelada};
#  valor; cpf opcional — grava em medicos.cpf, útil p/ futura cobrança Asaas.)
```

### Trilha do pagamento (opcional, recomendável p/ auditoria)
```bash
POST /api/v1/admin/assinaturas/{assinaturaId}/pagamento
{ "valor": 197.00, "metodo": "pix_offline", "pagoEm": "2026-06-15", "notas": "cortesia/lançamento" }
# grava em pagamentos_manuais (status='confirmado'). Aparece no histórico de /dashboard/financeiro.
```
> O `/pagamento` promove a assinatura para `ativa` no 1º pagamento quando ela está em
> **`trial`** (legado) **ou `pendente`** (default dos signups pós-ADR-055) —
> `WHERE status IN ('trial','pendente')`. Ou seja: registrar o pagamento de um médico
> `pendente` **já ativa** + deixa a trilha. (A Opção B / PATCH `status='ativa'` segue valendo
> para casos sem pagamento, ex.: cortesia.)

## Efeito
- `GET /api/v1/auth/me` passa a devolver `bloqueado=false` / `liberado=true`.
- Os endpoints de dashboard (pacientes, prescricoes, evolucao, insights, consultas) saem do 402.
- A UI: o médico sai da tela de paywall. **O `/me` é cacheado por sessão no front** (`use-me.ts`)
  → o médico precisa **recarregar a página** (ou re-logar) para a UI refletir.

## Reverter / suspender
- `PATCH /api/v1/admin/assinaturas/{id} { "status": "suspensa" }` → gate volta a bloquear.
- `status="cancelada"` → encerra; se houver `asaas_subscription_id`, o gateway **cancela no Asaas**
  antes (exige Asaas configurado; senão 503).

## Migrar para cobrança automática (quando o Asaas prod ligar)
- Admin: `POST /api/v1/admin/assinaturas/{id}/cobranca-asaas` (cria customer+subscription, devolve `invoiceUrl`).
- OU médico: self-checkout em `/dashboard/financeiro` ("Ativar e pagar", ADR-055 Fase C).
- A partir daí o **webhook Asaas** gere o `status` (`ativa`/`suspensa`); não mexer manualmente sem necessidade.

## Notas
- Use as `notas` do pagamento para registrar o motivo (cortesia/offline) — `pagamentos_manuais` é
  a trilha; mantenha rastreável (não é trilha de auditoria imutável da regra #5, mas é o registro financeiro).
- Médico em `trial` legado não-vencido **já está liberado** — não precisa ativar.

---

*Cérebro Amigo · paywall ADR-055 · fallback enquanto `asaas-prod-cutover.md` não está concluído.*
