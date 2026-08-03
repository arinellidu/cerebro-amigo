---
name: cerebro-architecture
description: >-
  Referência de arquitetura do Cérebro Amigo V3. Use sempre ao planejar ou
  modificar fronteiras entre frontend, BFF, gateway, serviços Python, banco e
  cloud, ou ao avaliar trade-offs de stack e hosting.
---

# Arquitetura — Cérebro Amigo V3

SaaS de psiquiatria multi-tenant apresentado publicamente como portfólio com
dados exclusivamente fictícios.

> Fontes da verdade: `docs/CURRENT-PORTFOLIO-RUNTIME.md` para hosting e região;
> `docs/CONTEXT.md` para o mapa completo; ADR-080 para a decisão.

## Current portfolio runtime

```
Vercel
├── apps/web (Next.js + BFF) ───────────────┐
└── apps/checkup                            │
                                             ▼
Azure eastus2 — somente dados fictícios
├── api-gateway (.NET 10 · ingress externo)
├── orchestrator-py (Container Apps · interno) ──► Anthropic API
├── agents-py (Container Apps · interno)
├── notifier-py (Container Apps · interno)
└── Azure PostgreSQL Flexible Server · RLS · pgvector · pgcrypto
```

O runtime atual não promete residência de dados no Brasil. AWS é deployment
anterior ou arquitetura de referência e está fora do request path público.
Qualquer dado real exige novo ADR com residência, rede privada, HA, RPO/RTO,
segurança e validação LGPD.

## Regra de fronteira

| Tipo de trabalho | Serviço dono |
|---|---|
| Chamar Claude / LLM | Apenas Python (`orchestrator-py`, `agents-py`) via Anthropic API direta |
| CRUD transacional, JWT, e-mail, proxy SSE | `api-gateway` (.NET 10; ADR-071) |
| Cookies, sessão, agregação e render | `web` / BFF (`app/api/*`) |
| Push de check-in | `notifier-py` |
| Jobs analíticos | `agents-py` |

Nunca: LLM no gateway ou no frontend clínico; CRUD direto do frontend no
PostgreSQL; lógica clínica no BFF.

## Decisões fechadas

- Gateway ativo: .NET 10. Scala foi descomissionado; Go continua descartado.
- LLM: Anthropic API direta via client unificado em Python (ADR-044).
- Frontend: Vercel. Backend: Azure Container Apps. Banco: Azure PostgreSQL.
- Ambiente público: `eastus2`, dados fictícios, sem promessa de residência no Brasil.
- Protocolo de crise e regras de auditoria não mudam com o provedor de cloud.

## Mapa de superfícies

| Rota | Domínio |
|---|---|
| `/` | portfólio e arquitetura |
| `/medico` | entrada pública do médico |
| `/paciente` | entrada pública do paciente |
| `/dashboard/*` | workspace médico autenticado |
| `/p/*` | portal paciente autenticado |
| `/privacy`, `/terms` | limites legais do portfólio |

## Skills relacionadas

- Resposta ao paciente, crise ou dado clínico: `clinical-safety`.
- Endpoint/EF Core/SSE: `dotnet-gateway`.
- LLM/LangGraph/agentes: `python-ai-services`.
- BFF/cookies/PWA: `nextjs-bff`.

Ao concluir mudança estrutural, atualize o ADR aplicável e mantenha o runtime
canônico coerente em README, CONTEXT e superfícies públicas.
