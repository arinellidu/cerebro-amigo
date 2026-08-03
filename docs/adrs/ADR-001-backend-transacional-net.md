# ADR-001: Backend transacional em .NET

**Status:** Accepted
**Data:** 2026-05-21
**Decisores:** Equipe de engenharia, com revisão regulatória pendente
**Categoria:** Stack

## Contexto

O Cérebro Amigo é um sistema multi-tenant para prática psiquiátrica brasileira,
combinando responsabilidades transacionais clássicas (autenticação, CRUD,
faturamento, emissão fiscal) com responsabilidades específicas de IA
conversacional. A camada transacional precisa lidar com:

- Autenticação JWT de médicos e portal do paciente (magic link, sessões).
- CRUD sobre o domínio clínico-administrativo (clientes, médicos, pacientes,
  prescrições, consultas, questionários, mensagens diretas).
- Integração com Mercado Pago para processamento de pagamentos recorrentes
  (modelo SaaS por psiquiatra).
- Integração com NFE.io para emissão de NFS-e fiscal por consulta.
- Push subscriptions VAPID (registro de endpoints, opt-out).
- Recebimento de webhooks de Mercado Pago.

Este é o coração transacional, financeiro e fiscal do produto. Falha aqui
afeta receita, conformidade tributária e operação clínica simultaneamente.

A implementação atual é em ASP.NET Core / .NET 10 (Minimal API + EF Core
sobre PostgreSQL), com aproximadamente 13 grupos de rotas REST estabelecidos
e em uso pelo dashboard médico (Next.js).

## Decisão

**Manter a camada de backend transacional em .NET (ASP.NET Core Minimal API
+ EF Core).**

A decisão se aplica especificamente ao serviço atualmente nomeado
`apps/api-gateway/`, que apesar do nome **não é um API Gateway** no sentido
técnico estrito (Kong, Apigee, AWS API Gateway), mas sim a aplicação
backend monolítica do produto. O nome será mantido por inércia mas
preferimos descrevê-lo internamente como "backend transacional" ou
"core API".

## Alternativas consideradas

### Alternativa A — Reescrever em Python (FastAPI + SQLAlchemy)

**Argumento a favor:** Consolida o stack em três linguagens (.NET sai, sobram
.NET... wait — Python + TypeScript + Python = 2 linguagens, o que reduz
ainda mais a superfície de manutenção).

**Argumentos contra que levaram à rejeição:**

1. **Custo de migração elevado.** A camada atual em .NET tem 13+ grupos de
   rotas, fluxos de auth complexos (JWT + magic link + sessões), integrações
   já estabilizadas com Mercado Pago e NFE.io, e está em uso pelo frontend
   Next.js. Reescrever significaria meses de trabalho com risco de regressão
   em fluxos financeiros e fiscais.

2. **Python não tem vantagem técnica neste domínio.** Para CRUD/auth/payment/
   fiscal, .NET 10 + EF Core é estado-da-arte. Não há ganho técnico em
   trocar — apenas redução de heterogeneidade do stack.

3. **Ecossistema fiscal brasileiro em .NET é maduro.** Bibliotecas para
   NFE/NFS-e, SPED e integrações com sistemas tributários brasileiros têm
   tradição forte em .NET (refletindo a base instalada empresarial no
   Brasil). Python tem opções mas menos maduras.

4. **Risco regulatório.** Sistemas que tocam dados de saúde e movimentação
   financeira precisam ser estáveis. Reescritas são fonte de incidente
   conhecida.

### Alternativa B — Reescrever em Go

**Argumento a favor:** Stack consolidado em Go + TypeScript se também
consolidássemos a camada de IA em Go (ver ADR-002).

**Argumentos contra:**

1. Mesmos pontos 1, 2 e 4 da Alternativa A.
2. Go tem ecossistema fiscal brasileiro muito menor que .NET.
3. Go é excelente para serviços de alta concorrência I/O — não é o
   diferencial necessário no backend transacional do Cérebro Amigo
   (escala esperada: dezenas de psiquiatras, milhares de pacientes, baixa
   concorrência por requisição).

### Alternativa C — Microserviços por subdomínio

**Argumento a favor:** Separar fiscal/payment de auth/CRUD em serviços
independentes, possibilitando linguagens diferentes para cada um e escala
independente.

**Argumentos contra:**

1. **Complexidade prematura.** O produto não atingiu escala que justifique
   microserviços. Coordenação entre serviços (transações distribuídas,
   eventos, autenticação cross-service) introduz custo operacional que
   excede o ganho atual.
2. **Domínios fortemente acoplados.** Pagamento e emissão fiscal estão
   ligados ao mesmo bounded context (cobrança); separá-los exige
   coordenação sincronizada que é mais simples como monolito.

Esta alternativa pode ser reconsiderada quando o produto atingir escala
que justifique (centenas de psiquiatras, milhões de transações/mês).

## Consequências aceitas

1. **O stack permanece heterogêneo.** .NET no transacional + Python na
   camada de IA + TypeScript no frontend é três linguagens. Cada
   desenvolvedor mantenedor precisa transitar pelas três. Isto é aceito
   conscientemente porque cada uma está em sua zona de competência clara.

2. **Comunicação entre backend e IA passa por HTTP.** O backend .NET
   chama o serviço Python (orchestrator-py) via HTTP com token interno.
   Adiciona latência (~5ms localnet) e ponto de falha (Python pode estar
   down). Mitigação: circuit breaker no .NET para o orchestrator-py,
   com degradação para "automação temporariamente indisponível" no front.

3. **Renomeação do diretório é cosmética e adiada.** O nome
   `apps/api-gateway/` permanece por inércia. Renomear seria um commit
   grande e propenso a quebrar referências em CI, docker-compose, docs.
   Pode ser feito numa janela de manutenção dedicada se incomodar.

## Gatilhos de revisão

Esta decisão deveria ser reavaliada se:

- A equipe perder competência sustentada em .NET (rotatividade alta,
  contratação difícil em região-alvo).
- A complexidade de manter três linguagens superar o benefício de cada
  estar em sua zona forte (sinal: bugs frequentes em integração entre
  serviços, lentidão para implementar features cross-stack).
- O domínio fiscal brasileiro ganhar ferramentas equivalentes em outra
  linguagem que torne a paridade trivial.
- Decisão futura mover faturamento/fiscal para serviço SaaS externo
  (Iugu, Pagar.me, Asaas com NFE.io plug-in), liberando o backend de
  responsabilidades fiscais e tornando-o um CRUD mais simples — nesse
  caso, vale reconsiderar consolidação de linguagem.

## Referências

- ADR-002: complementa esta decisão definindo a camada de IA em Python.
- ADR-003: complementa esta decisão definindo agentes analíticos em Python.
