# ADR-071: Manter o api-gateway em .NET 10 e decomissionar o Scala (supersede ADR-067)

**Status:** Accepted
**Data:** 2026-06-21
**Decisores:** Patrick Arinelli, Adonai Arinelli
**Categoria:** Stack / Arquitetura
**Supersede:** ADR-067 (migração .NET→Scala via strangler)
**Reafirma:** ADR-007 / ADR-001 (gateway transacional em .NET, não Go)
**Relaciona:** ADR-042 (RLS de tenant), ADR-035 (trava server-side de prompts), ADR-018 (cifragem em repouso), ADR-041 (entrega garantida do alerta de crise)

## Contexto

O **ADR-067** (2026-06-18) decidiu migrar o `api-gateway` de **.NET 10 → Scala 3/JVM** via *strangler* — um endpoint por vez, com o BFF flipando por rota após paridade, e o .NET aposentado por último. Motivos: fluência do dev que sustenta o gateway em Scala e modelagem tipada do estado de pagamento.

Avaliação em 2026-06-21, com o sistema **vivo, multi-tenant e já cobrando (MRR)**:

- O strangler chegou a **1 de 62 famílias de rota** — apenas `GET /api/v1/auth/me`.
- Essa única fatia **nunca foi flipada no BFF**: `API_GATEWAY_URL` aponta para o .NET, e o serviço Scala rodava **ocioso** ao lado (fora do caminho de request). Inclusive a paridade do `auth/me` estava incompleta (faltava `fotoUrl` via S3 presigned que o .NET serve).
- Restavam **61 famílias** — incluindo clínico (`/crise`, `/pacientes`, `/mensagens`, `/prescricoes`, portal do paciente) e dinheiro (`/asaas/webhook`, `/minha-assinatura`), cada uma exigindo revisão `clinical-safety` dedicada antes do flip.
- O gateway .NET **funciona**: em produção, testado (suíte `api-gateway-tests` de isolamento de tenant no CI), com RLS (ADR-042), cifragem (ADR-018) e dinheiro fluindo. **Não é gargalo do produto nem do lançamento.**
- A coexistência tinha custo recorrente: ~192 MB de JVM ociosa no box clínico e **bloqueio do rightsizing** da EC2 (não dava para descer de `t3.large` com os dois gateways).

## Decisão

**Manter o api-gateway em .NET 10 como gateway único e decomissionar o Scala.**

1. O `api-gateway` (.NET 10, ASP.NET Core) é o **gateway primário e único** em produção. Já estava na porta pública (`API_GATEWAY_URL` sempre apontou para ele) — não há promoção a fazer.
2. **Paridade:** verificado que **nada existe só no Scala**. Rotas: .NET = 62 famílias, Scala = 1 (`auth/me`), e a versão .NET é superset (mais rica). Middlewares/regras de segurança (JWT, tenant/GUC, RLS, cifragem) já vivem no .NET — o Scala os **portou a partir** do .NET, nunca o inverso. **Zero lacunas a implementar no .NET.**
3. **Remoção do Scala** do `docker-compose.yml`, do `docker-bake.hcl` e do `deploy.yml` (executado no PR #122). O container ocioso sai do box no deploy clínico (`up -d --remove-orphans`) e a imagem é limpa pelo prune pós-deploy.
4. A **source** `apps/api-gateway-scala/` é preservada no histórico do git. O **repo ECR `cerebro-amigo/api-gateway-scala` foi DELETADO** (`aws ecr delete-repository --force`, 21 imagens) — recuperável apenas reconstruindo a imagem a partir da source. Decomissionamento permanente da execução; o histórico de código fica no git. _(Atualização 2026-07-26: a source foi removida da árvore ativa; o snapshot completo está na tag git `archive/api-gateway-scala` — `git checkout archive/api-gateway-scala -- apps/api-gateway-scala` restaura.)_

## Racional

- **Custo × benefício não fecha** num sistema vivo e cobrando: reescrever 61 endpoints regulados (clínico + dinheiro), cada um com risco e revisão `clinical-safety`, por ganho de type-safety que o .NET também modela e que **não move produto nem lançamento**.
- **Risco**: todo flip de rota viva é chance de quebrar clínico/dinheiro em produção, com poucos médicos e margem zero para incidente no caminho de crise.
- **Foco**: o esforço de engenharia vale mais em produto/lançamento do que em trocar a linguagem de um gateway que já funciona.
- **Reversível-na-medida-certa**: a source e a imagem ficam guardadas; reativar exige novo ADR e "go" explícito.

## Consequências aceitas

- **Perde-se** o trabalho de execução do Scala como gateway vivo (a source fica como referência recuperável).
- O `Money` tipado / máquina de estados de pagamento em Scala, que motivou o ADR-067, **não acontece** por ora. Gatilho para reabrir: bug real recorrente dessa classe que justifique o investimento, com time e folga.
- O gateway segue com as características conhecidas do .NET 10 (EF Core, etc.) — sem mudança de stack.
- **Não reintroduzir Go** no gateway (ADR-007 segue válido em espírito): a decisão é **.NET 10**, ponto.

## Notas de execução

- ADR-067 passa a **Superseded by ADR-071**.
- `CLAUDE.md` e `docs/CONTEXT.md` atualizados: gateway de produção = **.NET 10**, ADR-067 superseded.
- Suíte `api-gateway-tests` (xUnit/Testcontainers) segue como gate de RLS/tenant no CI — sem mudança.
