<p align="center"><strong><a href="https://www.cerebroamigo.com.br">www.cerebroamigo.com.br</a></strong></p>

<p align="center"><strong>The hosted demo has been retired.</strong> · Inspect the system through the <a href="#architecture">architecture</a>, the <a href="./docs/adrs">ADRs</a>, or by running the full stack locally with <code>docker compose up -d --build</code></p>

# Cérebro Amigo V3

A demonstration platform for psychiatric care between appointments, designed to connect the patient's daily routine to the physician's decision-making with safety, context, and traceability.

> Originally built as a commercial product; published here as a sanitized engineering case study — history squashed, credentials rotated, infrastructure decommissioned. The architecture, decisions and code are the artifact.

**🇧🇷 [Versão em português](./README.pt-br.md)**

[![CI](https://img.shields.io/badge/CI-GitHub_Actions-2088FF?logo=githubactions&logoColor=white)](./.github/workflows/ci.yml)
![Next.js](https://img.shields.io/badge/Next.js-16-111111?logo=nextdotjs)
![.NET](https://img.shields.io/badge/.NET-10-512BD4?logo=dotnet)
![Python](https://img.shields.io/badge/Python-3.12+-3776AB?logo=python&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-pgvector-4169E1?logo=postgresql&logoColor=white)

<p align="center">
  <img src="./docs/assets/portfolio/cerebro-amigo-hero.png" alt="Conceptual overview of the Cérebro Amigo ecosystem, with the physician dashboard, AI core, and mobile experience" width="100%" />
</p>

> [!IMPORTANT]
> This is a **portfolio project and a realistic engineering simulation**. It is not an active medical service, contains no real patients, and must not be used for diagnosis, prescription, or emergency care. External integrations require your own credentials and test environments.

## The case in 90 seconds

| | |
|---|---|
| **Problem** | Between appointments, critical information gets scattered: mood, adherence, symptoms, questions, and risk signals. |
| **Product** | A physician dashboard, a patient PWA, and a public anonymous screening experience. |
| **Technical challenge** | Isolate sensitive data per tenant, coordinate services across three stacks, and apply AI without removing the physician from the loop. |
| **Solution** | Next.js for the product and BFF, .NET for the transactional core, Python for the AI flows, and PostgreSQL with Row-Level Security as the last line of isolation. |
| **What this repository demonstrates** | Systems architecture, full-stack development, security by design, product UX, integration testing, and CI/CD. |

The goal is not just to simulate screens. The monorepo implements service boundaries, authentication, auditing, migrations, notifications, asynchronous processing, and clinical safeguards in a public portfolio runtime built only with fictional data.

> [!NOTE]
> Product copy and internal documentation (ADRs, runbooks) are written in Brazilian Portuguese — the product targets the Brazilian market and its data-protection law (LGPD). This README summarizes the key engineering decisions in English.

## Current portfolio runtime

| Layer | Status |
|---|---|
| **Frontend** | **Active** — Vercel (`apps/web` and `apps/checkup`) |
| **Backend** | **Decommissioned** — Azure Container Apps, shut down to stop recurring cost |
| **Database** | **Decommissioned** — Azure Database for PostgreSQL Flexible Server |
| **Azure region** | `eastus2` (United States), while the backend was running |
| **Data** | Fictional, reproducible demonstration data only — no production data ever existed |

The only public runtime still active is the **frontend on Vercel**. The Azure backend and database were decommissioned to stop recurring cost, so any surface that depended on the clinical API — the authenticated patient portal, the physician dashboard, the SSE conversation — no longer answers in the hosted environment.

Inspect the system through the **code**, the **[ADRs](./docs/adrs)**, and a **local run**:

```bash
cp .env.example .env
docker compose up -d --build
```

That brings up the same topology the hosted environment ran: Next.js, the .NET gateway, the three Python services, and PostgreSQL with RLS. See [Running locally](#running-locally).

This was always a portfolio demonstration, not an active medical service. It makes **no claim of data residency in Brazil**, and real patient or clinical data must not be entered. AWS files and runbooks describe the previous deployment or reference architecture. See the [canonical runtime statement](./docs/CURRENT-PORTFOLIO-RUNTIME.md), [ADR-080](./docs/adrs/ADR-080-portfolio-vercel-azure.md), and [ADR-081](./docs/adrs/ADR-081-resilient-public-demo.md) for the design of the demo experience that ran while the backend was live.

## Product

<p align="center">
  <img src="./docs/assets/portfolio/entrada-medico-paciente.png" alt="Cérebro Amigo entry point with separate journeys for physician and patient" width="92%" />
</p>

<p align="center"><sub>One front door, two journeys, and distinct permissions from the very first interaction.</sub></p>

<table>
  <tr>
    <td width="50%">
      <img src="./docs/assets/portfolio/plataforma-medico.png" alt="Physician platform page with a pre-appointment briefing example" />
      <br />
      <sub><strong>Physician experience:</strong> pre-appointment briefing, schedule, medical records, progress notes, and alerts.</sub>
    </td>
    <td width="50%">
      <img src="./docs/assets/portfolio/portal-paciente.png" alt="Patient portal with mood tracking, medication, and voice journaling" />
      <br />
      <sub><strong>Patient experience:</strong> mood tracking, reminders, journaling, check-ins, and assisted conversation.</sub>
    </td>
  </tr>
</table>

<p align="center">
  <img src="./docs/assets/portfolio/checkup-mental.png" alt="Mental Check-up with anonymous screenings based on validated instruments" width="92%" />
</p>

<p align="center"><sub><strong>Mental Check-up:</strong> an anonymous satellite product, fully isolated from the clinical records. All screens use demo content.</sub></p>

## Implemented capabilities

### For the physician

- Dashboard with schedule, patients, messages, check-ins, and progress overview.
- Longitudinal medical record with treatment plans, medications, clinical scales, exams, and a timeline.
- Pre-appointment briefing and an assisted scribe, keeping the physician as the decision-maker.
- Risk alerts with acknowledgment, retry, and a full audit trail.
- Operational views for usage, costs, acquisition, and compliance.

### For the patient

- Responsive PWA with its own session and routine-oriented navigation.
- Mood logging, text or voice journaling, schedule, and medication reminders.
- Check-ins and communication between appointments, supervised and audited.
- Deterministic crisis flow with a static, pre-approved message.

### Mental Check-up

- Public, anonymous screenings based on validated clinical instruments (PHQ-9, GAD-7, ASRS-18).
- Immediate results, never mixed with the clinical records.
- Independent architecture, database schema, and deploy cycle from the clinical product.
- Structured, minimized content at every point that touches an LLM.

## Architecture

```mermaid
flowchart LR
    subgraph V["Vercel · frontend"]
      M["Physician · Web"] --> BFF["Next.js · BFF"]
      P["Patient · PWA"] --> BFF
      C["Anonymous Check-up"]
    end
    subgraph A["Azure eastus2 · fictional demo data only"]
      BFF --> API[".NET 10 · Container Apps"]
      API --> DB[("Azure PostgreSQL · RLS")]
      API --> ORC["Python · Orchestrator"]
      API --> AGT["Python · Agents / RAG"]
      API --> NOT["Python · Notifier"]
      C --> CDB[("Isolated schema")]
    end
    ORC --> LLM["Anthropic API"]
```

Boundaries were drawn by responsibility, not by language preference:

| Layer | Technology | Responsibility |
|---|---|---|
| Product & BFF | Next.js 16, React 19, TypeScript, Tailwind 4 | UI, httpOnly sessions, Route Handlers, and PWA. |
| Transactional core | ASP.NET Core / .NET 10 | REST, JWT, access rules, EF Core, and event proxying. |
| AI & automation | Python 3.12, FastAPI, LangGraph | Orchestration, classification, RAG, jobs, and integrations. |
| Data | PostgreSQL, pgvector, pgcrypto | Relational model, vector search, encryption, and multi-tenant RLS. |
| Delivery | Vercel Git Integration, Azure Container Apps/ACR, GitHub Actions CI | Public portfolio delivery, reproducible builds, and quality gates without an active AWS deploy workflow. |

For the full map, see [docs/CONTEXT.md](./docs/CONTEXT.md). Architectural decisions are recorded in [docs/adrs](./docs/adrs).

## Decisions worth a technical conversation

1. **Tenant isolation in two layers.** Every clinical query keeps an explicit tenant filter, and PostgreSQL enforces the boundary with Row-Level Security. Integration tests against a real Postgres actively try to cross tenants to prove the defense. See [ADR-042](./docs/adrs/ADR-042-rls-isolamento-tenant.md).

2. **AI kept apart from the transactional domain.** The .NET gateway never calls models directly. AI flows live in the Python services and can swap providers without contaminating the main API. See [ADR-044](./docs/adrs/ADR-044-llm-anthropic-api-direta.md) and [ADR-071](./docs/adrs/ADR-071-manter-dotnet-remover-scala.md).

3. **Crisis handling is deterministic and fail-safe.** The LLM never writes the crisis message. The text is static, hash-verified across two services, and a classification failure is treated as risk — never ignored. See [ADR-035](./docs/adrs/ADR-035-trava-server-side-prompt-crise.md), [ADR-041](./docs/adrs/ADR-041-entrega-garantida-alerta-crise.md), and [ADR-063](./docs/adrs/ADR-063-resiliencia-deteccao-crise-failsafe.md).

4. **Privacy drives the design.** Sensitive content is encrypted at rest, PII is redacted before traces, and direct identifiers never travel alongside clinical content to external APIs. See [ADR-018](./docs/adrs/ADR-018-cifragem-em-repouso.md).

5. **The public funnel never becomes a medical record.** The Mental Check-up uses a separate schema, creates no foreign keys into the clinical domain, and exposes only aggregate metrics when needed.

## Security and clinical responsibility

- AI organizes, classifies, and drafts; it **never diagnoses, prescribes, or adjusts dosage**.
- Every response to a patient is auditable and can be escalated to a human.
- The crisis protocol uses fixed content with guaranteed, retried delivery.
- Critical audit records are immutable by domain rule.
- Session cookies are `httpOnly`; internal services authenticate with a dedicated token.
- Secrets come from environment variables and never belong in code, images, or logs.
- The pipeline runs vulnerability scans and blocks fixable critical findings.

This section describes decisions implemented in the case study; it does not represent regulatory certification or validation for real clinical use.

## Verifiable quality

| Area | Main gate | What it protects |
|---|---|---|
| Web | `pnpm build` | Strict TypeScript, React, and Next.js rendering. |
| Check-up | `pnpm test` + `pnpm build` | The scale engine and the public experience. |
| Gateway | `dotnet build` + `dotnet test` | Contracts, authorization, RLS, and integration with a real Postgres via Testcontainers. |
| Python services | `ruff`, `mypy`, `pytest` | AI flows, crisis handling, redaction, and jobs. |
| Repository | Trivy + smoke tests | Critical dependencies and cross-service integration. |

The repository keeps versioned SQL migrations as the single source of truth for the schema, plus a CI suite in [`.github/workflows/ci.yml`](./.github/workflows/ci.yml).

## Monorepo structure

```text
apps/
├── web/                 Next.js — landing, dashboard, PWA, and BFF
├── checkup/             Next.js — public anonymous screening
├── api-gateway/         .NET 10 — transactional API and authorization
├── api-gateway-tests/   xUnit + Testcontainers
├── orchestrator-py/     FastAPI + LangGraph — conversation and crisis
├── agents-py/           FastAPI — analytical agents and RAG
└── notifier-py/         FastAPI — push, e-mail, and retries

infra/
├── migrations/          Versioned PostgreSQL DDL
├── azure/               Current portfolio infrastructure as code
├── aws/                 Previous/reference architecture and automation
└── ci/                  Integration scripts and smoke tests

docs/
├── CONTEXT.md           Technical map of the system
├── DEBT.md              Explicit technical debt
├── adrs/                Architectural decision records
└── runbooks/            Simulated operational procedures
```

The decommissioned Scala gateway experiment (ADR-067/071) was removed from the tree; its source is preserved in an offline archive bundle, available on request. The active gateway is .NET 10.

## Running locally

### Prerequisites

- Node.js 24 and pnpm 10.33.3 via Corepack
- .NET 10 SDK
- Python 3.12+
- Docker with Compose

### Quick look at the interface

```bash
corepack pnpm@10.33.3 install --frozen-lockfile
corepack pnpm@10.33.3 --filter @cerebro-amigo/web dev
```

The web app opens at `http://localhost:3000`. In another terminal, the Mental Check-up can be started at `http://localhost:3001`:

```bash
corepack pnpm@10.33.3 --filter @cerebro-amigo/checkup dev
```

### Full stack

```bash
cp .env.example .env
docker compose up -d --build
```

`.env.example` documents every variable. Use only your own sandbox/development credentials and fictional data. Some flows depend on external providers and will remain unavailable without that configuration.

## Intentional limits of the case study

- No real patient data should ever be entered.
- All screens and scenarios shown use fictional information.
- The hosted backend and database were decommissioned; only the Vercel frontend remains public, and the full system runs locally via Docker Compose.
- AWS infrastructure is retained only as previous/reference architecture.
- Clinical scales and safeguards were treated as controlled artifacts, but real-world use would require independent legal, clinical, security, and privacy validation.
- Open debts and pending decisions are kept explicit in [docs/DEBT.md](./docs/DEBT.md).

## License

Copyright © 2026 Patrick Arinelli. All rights reserved. This repository is
publicly accessible for viewing, evaluation, and portfolio review only. See
the [LICENSE](./LICENSE) file for the complete terms.

---

Built as a product-engineering case study to demonstrate real decisions — including the limits, the risks, and the trade-offs that usually stay out of a UI demo.
