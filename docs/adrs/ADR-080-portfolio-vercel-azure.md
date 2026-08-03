# ADR-080 — Ambiente de portfólio na Vercel + Azure

- **Status:** aceito (2026-07-25)
- **Decisor:** Patrick Arinelli
- **Escopo:** ambiente público de demonstração com dados exclusivamente fictícios
- **Supersede no ambiente de portfólio:** ADR-076, ADR-078 e ADR-079
- **Não altera:** ADR-018 (cifragem), ADR-035/041/063 (crise), ADR-042 (RLS),
  ADR-044 (Anthropic direta) e ADR-071 (.NET 10)

## Current portfolio runtime

| Camada | Runtime atual |
|---|---|
| Frontend | Vercel (`apps/web` e `apps/checkup`) |
| Backend | Azure Container Apps |
| Banco | Azure Database for PostgreSQL Flexible Server |
| Região | `eastus2` (Estados Unidos) |
| Dados | Exclusivamente fictícios e reproduzíveis |

Este é um ambiente público de portfólio, não um serviço médico ativo. Ele não
promete residência de dados no Brasil. AWS é deployment anterior ou arquitetura
de referência e está fora do request path público atual. A declaração canônica
curta fica em `docs/CURRENT-PORTFOLIO-RUNTIME.md`.

## Contexto

O projeto é apresentado principalmente a recrutadores internacionais. A topologia
AWS pós-teardown mantém duas EC2 e PostgreSQL self-hosted, com custo mensal próximo
de R$ 500 mesmo sem pacientes reais. O frontend pode operar na Vercel Pro já
contratada, e a subscription Azure `Cerebro` está disponível para hospedar o
backend de demonstração.

O Savings Plan AWS permanece comprometido até 2027-06-18. Por isso, AWS e Azure
coexistirão durante a validação. Nenhum recurso AWS será removido por este ADR;
teardown exige autorização posterior e um gate de cutover verde.

## Decisão

### Topologia

1. `apps/web` e `apps/checkup` rodam como dois projetos Vercel independentes.
2. O backend roda em Azure Container Apps Consumption, região `eastus2`:
   - `api-gateway`: ingress externo, escala 0..1;
   - `orchestrator-py`, `agents-py` e `notifier-py`: ingress interno, escala 0..1.
3. PostgreSQL 16 roda em Azure Database for PostgreSQL Flexible Server, SKU
   Burstable `Standard_B1ms`, 32 GiB, sem HA e com backup operacional de 7 dias.
4. `vector`, `pgcrypto` e `uuid-ossp` continuam habilitados. Migrations SQL em
   `infra/migrations` permanecem a fonte da verdade.
5. Imagens ficam em Azure Container Registry Basic. Segredos ficam no Azure Key
   Vault e são consumidos por Managed Identity. Binários efêmeros usam Azure Blob.
6. O LLM continua na Anthropic API direta. Gateway e front não passam a chamar LLM.
7. O Check-up inicia sem persistência e sem chave Anthropic na Vercel: escalas,
   crise estática, devolutivas de fallback e PDF continuam funcionais; tracking,
   envio de e-mail e métricas que exigem banco permanecem desligados.

### Postura de demonstração

- Não restaurar o snapshot histórico da AWS. O banco Azure nasce das migrations e
  recebe apenas um seed ficcional, reproduzível e identificável como demo.
- `agents-py` inicia em `AGENTS_MODE=manual` e `SHADOW_MODE=true`.
- `notifier-py` inicia em `NOTIFIER_MODE=manual`; endpoints internos continuam
  disponíveis sob `INTERNAL_API_TOKEN`.
- `CRISIS_RESILIENCE_ENABLED=false` permanece até os gates clínicos existentes
  serem atestados. A cópia fixa de crise não muda.
- Traces de IA mantêm inputs e outputs ocultos e PII redatada.

### Teto de custo

- Teto do Azure: **US$ 30/mês**.
- Teto Vercel + Azure: **US$ 50/mês**, considerando Vercel Pro de US$ 20.
- Budget Azure com alertas em 70%, 85%, 95% e 100%.
- Container Apps com `minReplicas=0`, Log Analytics com quota diária e sem recursos
  de rede dedicados no primeiro estágio.
- Não entram inicialmente: NAT Gateway, Azure Firewall, Application Gateway,
  Private Endpoint, HA do PostgreSQL, Azure OpenAI, Azure AI Speech ou ACS TURN.

O PostgreSQL usa endpoint público aceitando tráfego de serviços Azure, TLS,
credenciais fortes e roles least-privilege. Essa concessão só é aceitável porque o
ambiente contém dados fictícios. Qualquer dado real ou cliente pagante exige novo
ADR com rede privada, residência, HA, RPO/RTO e validação LGPD.

## Dependências AWS durante a transição

Funcionalidades ainda acopladas a S3, Amazon Transcribe ou Bedrock ficam desligadas
no primeiro cutover ou atrás de provider explícito. Não criar fallback silencioso:
feature indisponível deve responder de forma clara. A migração para Blob/Azure AI
é uma fase separada, com testes, antes de remover o recurso AWS correspondente.

Teleconsulta mantém sinalização WebSocket, mas TURN não roda no Container Apps
(sem UDP genérico). Até existir Azure Communication Services Network Traversal ou
VM TURN dedicada, a demo usa STUN apenas e informa a limitação.

## Gates de cutover

AWS só pode ser removida depois de todos os itens abaixo:

1. CI verde nas áreas alteradas.
2. Migrations aplicadas e testes de RLS/IDOR verdes no PostgreSQL Azure.
3. `/health` e `/ready` verdes nos quatro serviços.
4. Login médico e paciente, dashboard, portal e SSE validados pela Vercel.
5. Check-up completo, crise estática e PDF validados pelo domínio público.
6. Seed ficcional e rotina de reset documentados.
7. Budget/alertas de custo ativos.
8. Janela de observação mínima de 48 horas.
9. Autorização explícita do responsável para o teardown AWS.

## Consequências

### Positivas

- Frontend global e previews por PR na Vercel.
- Backend escala a zero e cabe no orçamento de portfólio.
- Demonstração usa API, banco, RLS e migrations reais, sem mocks de runtime.
- Infraestrutura reproduzível por Bicep e segredos fora do repositório.

### Aceitas

- Cold start no primeiro acesso.
- Banco sem HA e com endpoint público restrito ao plano Azure.
- Schedulers não ficam residentes; jobs agendados serão adicionados após o core.
- Algumas integrações caras ficam desligadas até ganharem provider Azure.
- O compromisso AWS continua sendo cobrado durante a coexistência.

## Amendment operacional — 2026-07-26

O workflow `.github/workflows/deploy.yml` ainda disparava em todo push para
`main` e tentava publicar em ECR, uma instância SSM e ASGs já ausentes ou
inativos. O problema foi observado em produção: o build ECR terminou, mas o
deploy falhou com instância inválida e ASG inexistente, embora o domínio público
continuasse atendido pela Vercel.

Para alinhar a automação a este ADR:

- o workflow AWS órfão foi removido;
- o restore drill agendado do antigo RDS também foi removido, pois seu banco e
  box de validação não pertencem ao runtime atual;
- `apps/web` e `apps/checkup` continuam promovidos pela Git Integration da
  Vercel;
- o backend permanece em Azure Container Apps/ACR conforme `infra/azure/`, com
  promoção deliberada até que um workflow Azure específico seja aprovado.

Os arquivos em `infra/aws/` permanecem somente como material histórico ou de
referência. Nenhum workflow ativo deve tratar AWS como destino do portfólio sem
novo ADR.
