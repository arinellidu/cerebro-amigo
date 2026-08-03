# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- Psiquiatras usam o dashboard para acompanhar pacientes, organizar condutas, revisar alertas e preparar consultas.
- Pacientes usam a PWA para registrar humor, diário, medicações, check-ins e conversar entre consultas.
- Recrutadores e hiring managers internacionais avaliam o projeto público como evidência de capacidade full-stack AI, arquitetura cloud, segurança e julgamento de produto.

## Product Purpose

Cérebro Amigo é um SaaS de psiquiatria multi-tenant que reduz a lacuna entre consultas. Ele organiza sinais enviados pelo paciente, automatiza tarefas operacionais e prepara informação para o médico, mantendo a decisão clínica sempre com o profissional.

Para a audiência de recrutamento, sucesso significa tornar o sistema, as decisões de engenharia e o trabalho de Patrick Arinelli compreensíveis e verificáveis, com acesso à arquitetura/case study e à demonstração funcional.

## Positioning

O produto combina um sistema clínico transacional real, acompanhamento assíncrono entre consultas e serviços de IA com guardrails explícitos: a IA organiza, resume e sinaliza; nunca diagnostica, prescreve ou substitui o médico.

## Current portfolio runtime

- **Frontend:** Vercel (`apps/web` e `apps/checkup`).
- **Backend:** Azure Container Apps.
- **Banco:** Azure Database for PostgreSQL Flexible Server.
- **Região atual:** `eastus2` (Estados Unidos).
- **Dados:** exclusivamente fictícios e reproduzíveis.
- **Residência:** o ambiente atual não promete residência de dados no Brasil.
- **AWS:** deployment anterior e arquitetura de referência; fora do request path público atual.

A fonte canônica é `docs/CURRENT-PORTFOLIO-RUNTIME.md`; a decisão está no ADR-080.

## Operating Context

O sistema opera entre o dashboard médico, o portal PWA do paciente, check-ins, mensagens, agenda, notificações e serviços internos de IA. A demonstração pública usa dados exclusivamente fictícios e reproduzíveis.

Para avaliação por recrutadores, `/demo` abre diretamente uma conta médica fictícia read-only e permite alternar para `/demo/patient-app`, sem cadastro ou credenciais. O tour médico conduz por `Dashboard → Patient record → AI briefing → Architecture`; o tour do paciente conduz por `Today → Check-in → Voice journal → Architecture`. Ambos são snapshots frontend do seed ficcional e não dependem do backend clínico; interações ficam na aba, e a voz é simulada sem acessar microfone. O produto autenticado continua usando o runtime completo Vercel + Azure.

O runtime mantém as fronteiras Next.js BFF, gateway .NET 10, serviços Python e PostgreSQL com RLS. Qualquer ambiente com dados reais exige uma nova decisão sobre residência, rede privada, HA, RPO/RTO e validação LGPD.

## Capabilities and Constraints

- Next.js 16, React 19 e TypeScript strict no frontend/BFF.
- API transacional em ASP.NET Core .NET 10.
- Serviços Python FastAPI/LangGraph para orquestração e agentes.
- PostgreSQL com pgvector, pgcrypto e Row-Level Security multi-tenant.
- LLM por Anthropic API direta apenas nos serviços autorizados; nunca diretamente no frontend clínico.
- Protocolo de crise fixo, fail-safe e pré-aprovado; nenhuma copy clínica pode ser improvisada.
- Traces redatam PII e não expõem conteúdo clínico cru.
- Ambiente público de portfólio contém somente dados fictícios.
- A página pública deve manter caminhos para paciente, médico, demo e contato, mesmo priorizando recrutadores.

## Brand Commitments

- Nome: Cérebro Amigo.
- Marca cerebral existente deve permanecer reconhecível.
- Narrativa combina cuidado humano e profundidade técnica, sem hype clínico ou afirmações não comprovadas.
- O fundador/desenvolvedor apresentado publicamente é Patrick Arinelli.
- Contatos públicos autorizados:
  - LinkedIn: https://linkedin.com/in/patrick-arinelli
  - GitHub: https://github.com/arinellidu
  - E-mail: arinpar@gmail.com

## Evidence on Hand

- Arquitetura e mapa do sistema: `docs/CONTEXT.md`.
- Decisões técnicas verificáveis: `docs/adrs/`, especialmente `ADR-080-portfolio-vercel-azure.md`.
- Código dos serviços e frontend no monorepo `apps/`.
- Migrations SQL e políticas de isolamento em `infra/migrations/`.
- História do fundador em `apps/web/app/(landing)/sobre/page.tsx`.
- Demonstração pública resiliente em `/demo`, com perspectivas de médico e paciente, dados sintéticos e tours guiados em inglês.
- Logo em `apps/web/public/brain-logo.png` e componente `apps/web/components/logo.tsx`.
- Não há métricas comerciais, benchmarks públicos ou logos de clientes autorizados; trabalhos futuros não devem fabricá-los.

## Product Principles

1. Demonstrar o sistema em funcionamento, não apenas descrevê-lo.
2. Tornar decisões de arquitetura, segurança e IA verificáveis.
3. Manter o médico no loop e as fronteiras clínicas explícitas.
4. Preservar o acesso rápido de médicos e pacientes sem deixar que ele domine a narrativa pública.
5. Tratar a demonstração como produto real com dados fictícios, não como coleção de mocks.

## Accessibility & Inclusion

A interface web deve preservar semântica, navegação por teclado, foco visível, contraste legível, redução de movimento e responsividade móvel. As superfícies públicas e de acesso serão em inglês para recrutadores e usuários internacionais; o produto clínico autenticado continua em pt-BR.
