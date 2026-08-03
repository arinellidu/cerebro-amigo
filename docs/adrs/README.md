# Architecture Decision Records · Cérebro Amigo

Este diretório registra decisões arquiteturais significativas do produto. Cada
ADR captura **contexto**, **decisão**, **alternativas consideradas** (incluindo
as rejeitadas e por quê), **consequências aceitas** e **gatilhos de revisão**
— condições objetivas que disparariam uma reavaliação.

Padrão seguido: [Michael Nygard, *Documenting Architecture Decisions*](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions).

Em um sistema de saúde mental (LGPD categoria especial) com responsabilidade
clínica delegada à psiquiatra titular, decisões arquiteturais não são apenas
técnicas — elas têm impacto em segurança do paciente, auditabilidade
regulatória e responsabilidade civil. Cada ADR documenta o raciocínio que
fundamentou a decisão para que ela possa ser explicada anos depois, em
contexto regulatório, sem dependência da memória do autor.

## Índice

> Regenerado automaticamente a partir do cabeçalho (título/status) de cada ADR;
> categoria é uma classificação organizacional derivada do tema. Revise ao mexer
> em um ADR. Numeração é única e sem reuso (ver Convenções).

| # | Título | Status | Categoria |
|---|---|---|---|
| [001](ADR-001-backend-transacional-net.md) | Backend transacional em .NET | Accepted | Stack |
| [002](ADR-002-ia-conversacional-python-langgraph.md) | IA conversacional em Python + LangGraph | Accepted | Stack |
| [003](ADR-003-agentes-analiticos-python-vanilla.md) | Agentes analíticos em Python sem LangGraph | Accepted | Stack |
| [004](ADR-004-lgpd-traces-langsmith.md) | Tratamento de LGPD em traces de LangSmith | Accepted | Compliance |
| [005](ADR-005-versionamento-texto-crise.md) | Versionamento e revisão do texto de crise | Accepted | Segurança clínica |
| [006](ADR-006-fail-safe-classificador-crise.md) | Fail-safe do classificador de crise | Accepted | Segurança clínica |
| [007](ADR-007-gateway-net-nao-go.md) | Gateway transacional em .NET 10, não Go | Accepted | Stack |
| [008](ADR-008-llm-bedrock-nao-anthropic-api.md) | LLM via Bedrock In-Region, não ANTHROPIC_API_KEY | Superseded by ADR-015 | Stack / Compliance |
| [009](ADR-009-separacao-plano-interativo-batch.md) | Separação plano interativo (crise) / batch + builds no CI | Accepted | Arquitetura / Segurança clínica |
| [010](ADR-010-crise-no-diario.md) | Triagem de crise no Diário (áudio e texto) | Accepted | Segurança clínica |
| [011](ADR-011-enforcement-custo-llm.md) | Enforcement do teto de custo diário de LLM | Accepted | Operação / Segurança clínica |
| [014](ADR-014-dirty-patients-find-pending.md) | Candidatos incrementais em find_pending ("pacientes sujos") | Proposed | Performance / Arquitetura |
| [015](ADR-015-llm-provider-switchavel.md) | Camada LLM provider-switchável (Anthropic API ⇄ Bedrock) | Accepted | Stack / Compliance |
| [016](ADR-016-agenda-e-revisao-mensagens.md) | Agenda de consultas + console de revisão de mensagens (read-only) | Accepted | Produto / Arquitetura |
| [017](ADR-017-imutabilidade-audit-trail-no-banco.md) | Imutabilidade do audit trail garantida no banco | Accepted | Segurança clínica / Compliance |
| [018](ADR-018-cifragem-em-repouso.md) | Cifragem em repouso de dados clínicos | Accepted | Segurança clínica / Compliance |
| [019](ADR-019-retomada-automacao-pos-crise.md) | Retomada de automação pós-crise (ato do médico, auditado) | Accepted | Segurança clínica |
| [020](ADR-020-motor-conduta-automacao.md) | Motor de conduta de automação por paciente | Accepted | Produto / Arquitetura |
| [021](ADR-021-escopo-administrativo-ia-comunicacao.md) | Escopo administrativo da IA de comunicação | Accepted | Segurança clínica / Produto |
| [022](ADR-022-notificacao-externa-crise-medico.md) | Notificação externa de crise ao médico (e-mail) | Accepted | Segurança clínica |
| [023](ADR-023-jobs-conduta-shadow.md) | Jobs de conduta + gate SHADOW | Accepted | Arquitetura / Segurança clínica |
| [024](ADR-024-integracao-memed.md) | Integração MEMED (prescrição digital) | Accepted | Produto / Integração |
| [025](ADR-025-agenda-scheduling.md) | Agenda — disponibilidade, conflito, lembretes e self-booking | Accepted | Produto |
| [026](ADR-026-teleconsulta-video-p2p.md) | Teleconsulta por vídeo — WebRTC P2P self-hosted | Accepted | Produto / Arquitetura |
| [027](ADR-027-measurement-based-care.md) | Measurement-Based Care — captura, desfecho e agente | Accepted | Produto / Clínico |
| [028](ADR-028-rag-pgvector.md) | RAG com pgvector — busca semântica doctor-facing | Accepted | Arquitetura / IA |
| [029](ADR-029-monitoramento-exames.md) | Monitoramento de exames laboratoriais e segurança farmacológica | Accepted | Produto / Segurança clínica |
| [030](ADR-030-rede-social-medicos.md) | Rede Social Cérebro Amigo (médicos verificados) | Proposed | Produto |
| [031](ADR-031-rede-extensoes-signup-foto-presenca.md) | Extensões da rede social — signup externo, foto, aprovação, presença | Proposed | Produto |
| [032](ADR-032-renovacao-receita-e-interacoes.md) | Renovação de receita controlada (A4) e rede de segurança de interações (A5) | Accepted | Produto / Segurança clínica |
| [033](ADR-033-monetizacao-roi-blindagem.md) | Monetização do médico (Asaas), dashboard ROI, recall e blindagem médico-legal | Accepted | Produto / Negócio |
| [034](ADR-034-cobranca-recorrente-medico.md) | Cobrança recorrente da plataforma ao médico (Fluxo A) via Asaas | Accepted | Produto / Negócio |
| [035](ADR-035-trava-server-side-prompt-crise.md) | Trava server-side dos prompts de salvaguarda clínica | Accepted | Segurança clínica |
| [036](ADR-036-cockpit-receita.md) | Cockpit de receita do admin (Fluxo A) | Accepted | Produto / Negócio |
| [037](ADR-037-sala-supervisao-crise.md) | Sala de supervisão de crise (admin, read-only) | Accepted | Segurança clínica |
| [038](ADR-038-trilha-acesso-dados-sensiveis.md) | Trilha de acesso a dados sensíveis (LGPD art. 37) | Accepted | Compliance |
| [039](ADR-039-console-direitos-titular.md) | Console de direitos do titular (LGPD) | Accepted | Compliance |
| [040](ADR-040-escriba-teleconsulta.md) | Escriba clínico (Ambient Scribe) na teleconsulta | Accepted | Produto / Segurança clínica |
| [041](ADR-041-entrega-garantida-alerta-crise.md) | Entrega garantida e escalonamento do alerta de crise ao médico | Accepted | Segurança clínica |
| [042](ADR-042-rls-isolamento-tenant.md) | Isolamento de tenant em profundidade — least-privilege + RLS | Accepted | Segurança clínica / Compliance |
| [043](ADR-043-ha-spof-plano.md) | Alta disponibilidade e fim do SPOF — plano | Proposed | Infra / Operação |
| [044](ADR-044-llm-anthropic-api-direta.md) | LLM via Anthropic API direta (vigente); Bedrock suspenso (AWS não aprovou) | Accepted | Stack / Compliance |
| [045](ADR-045-checkup-decouple-asg-alb.md) | Desacoplar o Check-up para infra própria (ALB + Auto Scaling Group) | Accepted | Infra / Arquitetura |
| [046](ADR-046-signup-externo-medico-atribuicao-checkup.md) | Signup externo de médico + atribuição do Check-up (motor de aquisição) | Accepted | Produto / Aquisição |
| [047](ADR-047-cloudfront-checkup.md) | CloudFront na frente do checkup.cerebroamigo.com.br | Proposed | Infra / Performance |
| [048](ADR-048-expansao-escalas-checkup.md) | Expansão das escalas do Check-up (AUDIT, MDQ, Fagerström, MSI-BPD) | Accepted | Segurança clínica / Produto |
| [049](ADR-049-assist-ux-proprio.md) | ASSIST com UX próprio no Check-up Mental | Accepted | Segurança clínica / Produto |
| [050](ADR-050-checkup-longitudinal-anonimo.md) | Cockpit de Aquisição + Check-up longitudinal pseudonimizado | Accepted (P1) / Proposed (P2) | Produto / Aquisição / Compliance |
| [051](ADR-051-validacao-escalas-checkup.md) | Validação e fidelidade das escalas do Check-up (PHQ-9, GAD-7, ASRS-18) | Accepted | Segurança clínica / Produto |
| [052](ADR-052-checkup-no-ec2-nao-vercel.md) | Check-up roda no EC2 (não na Vercel): quem conecta direto no RDS vive na VPC | Accepted | Arquitetura / Infra / Compliance |
| [053](ADR-053-sizing-box-clinico-t3xlarge.md) | Vertical scaling do box clínico para t3.xlarge + recalibração de recursos | Accepted | Infra / Operação / Segurança clínica |
| [054](ADR-054-cifragem-em-repouso-rds.md) | Cifragem em repouso do RDS clínico (migração para instância KMS-encrypted via snapshot+restore) | Accepted | Infra / Segurança clínica / LGPD |
| [055](ADR-055-sem-trial-paywall-assinatura.md) | Sem trial — acesso por assinatura com prazo de pagamento (paywall) + cadência mensal/trimestral | Proposed | Produto / Negócio / Segurança clínica |
| [074](ADR-074-web-na-vercel-decommission-aws.md) | `apps/web` volta para a Vercel (Pro, gru1); decomissão da stack EC2 ASG+ALB+CloudFront do web | ❌ Superseded (ADR-076) | Infra / Arquitetura / Compliance |
| [076](ADR-076-web-permanece-no-ec2-lgpd.md) | `apps/web` permanece no EC2 — migração para a Vercel abandonada por LGPD (residência de dado no BR) | ❌ Superseded no portfólio (ADR-080) | Infra / Arquitetura / Compliance |
| [078](ADR-078-checkup-box-unico-relancamento.md) | Relançamento do Check-up em box único EC2 | ❌ Superseded no portfólio (ADR-080) | Infra / Operação |
| [079](ADR-079-clinico-relancado-box-unico.md) | Relançamento do stack clínico em box único EC2 | ❌ Superseded no portfólio (ADR-080) | Infra / Operação |
| [080](ADR-080-portfolio-vercel-azure.md) | Ambiente de portfólio na Vercel + Azure | Accepted | Infra / Arquitetura / Portfólio |
| [081](ADR-081-resilient-public-demo.md) | Demo pública resiliente sem dependência do backend clínico | Accepted | Produto / Portfólio / Segurança |

## Status possíveis

- **Proposed** — decisão tomada mas ainda não validada em produção.
- **Accepted** — decisão em vigor.
- **Deprecated** — substituída por ADR mais recente; manter para histórico.
- **Superseded by ADR-NNN** — substituída e link para a nova decisão.

## Como propor uma mudança

Decisões aqui registradas não são imutáveis, mas mudá-las exige um novo ADR
que cite explicitamente o ADR anterior em "Superseded by". Não edite ADRs
existentes exceto para correções factuais óbvias (typo, link quebrado).

## Convenções

- ADRs são numerados sequencialmente, sem reuso.
- Mudanças significativas geram novos ADRs; pequenos ajustes operacionais
  podem ser registrados como amendments no final do ADR original (com data).
- Cada ADR é autocontido — não pressuponha que o leitor leu os outros.
