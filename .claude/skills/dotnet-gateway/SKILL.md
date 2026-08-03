---
name: dotnet-gateway
description: >-
  Convenções do api-gateway do Cérebro Amigo V3 em .NET 10 (ASP.NET Core). Use ao
  criar ou alterar qualquer coisa no gateway: endpoint REST, controller/minimal
  API, entidade ou migration EF Core, autenticação JWT, validação do
  INTERNAL_API_TOKEN entre serviços, envio de e-mail (Resend), proxy SSE para o
  orchestrator-py, health checks, ou config de DI/Program.cs. Use também quando o
  usuário pedir "porta o gateway do V2", discutir performance/RAM do gateway, ou
  cogitar trocar a linguagem do gateway — a decisão é .NET 10 (não Go).
---

# api-gateway — .NET 10 (ASP.NET Core)

Camada transacional do V3. Dono de: REST CRUD, JWT, EF Core sobre Postgres, e-mail via Resend, proxy SSE para a IA. **Nunca chama LLM** (isso é Python).

## Decisão de linguagem (não reabrir sem ADR)

Gateway é **.NET 10**, não Go (ADR-007). Se o pedido for migrar para Go, explique o trade-off (reaproveitamento do V2, EF Core, stack mais forte do time; RAM ociosa é o único ponto de Go e não é o gargalo) e proponha alternativas de RAM antes de reescrever: `t3.small`/`t3.medium`, `DOTNET_gcServer=0`, `DOTNET_GCHeapHardLimit`, ou **Native AOT** (~30-50 MB). Só reescreva se houver ADR revertendo a decisão.

## Estrutura esperada

```
apps/api-gateway/
  Program.cs              # DI, auth, health, pipeline
  Endpoints/ ou Controllers/
  Domain/                 # entidades (multi-tenant)
  Data/                   # DbContext (EF Core) + Migrations/
  Services/               # ResendEmailService, SseProxy, etc.
  appsettings*.json
```

## Autenticação — dois planos

1. **JWT** para requisições de usuário (médico/paciente), validado no pipeline. `JWT_SECRET` do ambiente.
2. **INTERNAL_API_TOKEN** para chamadas serviço-a-serviço (orchestrator/agents/notifier → gateway, e gateway → Python). Header `Authorization: Bearer ${INTERNAL_API_TOKEN}`. Endpoints internos exigem esse token; não exponha endpoint interno sem checá-lo.

## Multi-tenant (obrigatório)

Toda query a dado de paciente filtra por tenant. Aplique via query filter global no EF Core (`HasQueryFilter`) e/ou resolva o tenant do JWT no início da requisição. Nunca exponha endpoint que vaze dado entre tenants.

## EF Core / migrations

- Convenção de migration: `dotnet ef migrations add <NomeDescritivo>` → revise o SQL gerado → `dotnet ef database update`.
- Postgres com **pgvector** e **pgcrypto** habilitados (DDL base vive em `infra/migrations/`).
- **Tabelas de auditoria são append-only**: `protocolos_crise_acionados`, `notificacoes_medico`, `agente_execucoes`. Nunca gere migration que as torne editáveis/deletáveis em massa, nem código com `DELETE`/`UPDATE` nelas. (Ver skill `clinical-safety`.)
- Connection string via `ConnectionStrings__Postgres` (ou `POSTGRES_DSN` traduzida).

## Proxy SSE

A conversa paciente↔IA usa Server-Sent Events: o gateway **faz proxy** do stream do orchestrator-py para o cliente, sem bufferizar a resposta inteira. Use `IAsyncEnumerable`/streaming do ASP.NET; não acumule o corpo. Repasse o `INTERNAL_API_TOKEN` na chamada ao orchestrator.

## E-mail (Resend)

`RESEND_API_KEY` + `EMAIL_FROM`. Há webhook de bounce/complaint/delivery (Lambda `resend-webhook`). E-mails são administrativos (magic link, confirmação) — nunca conteúdo clínico.

## Health

Exponha `GET /health` (liveness) e `GET /ready` (readiness: confere Postgres). O docker-compose e o deploy dependem disso.

## URLs entre serviços

`API_GATEWAY_URL`: dev `http://localhost:5050`; dentro do docker `http://api-gateway:5000`. `ORCHESTRATOR_PY_URL` para o proxy SSE. Container escuta `:5000`, exposto no host como `:5050`.

## Ao portar do V2

O domínio é idêntico (multi-tenant, pacientes, prescrições, timeline, auth). Reaproveite quase tudo. **Remova** qualquer resíduo Azure (Key Vault / `DefaultAzureCredential`) — V3 não usa Azure; segredos vêm de ambiente/IAM. **Remova** qualquer chamada a `ANTHROPIC_API_KEY` (gateway não fala com LLM).
