# ADR-067: Migração do api-gateway de .NET 10 para Scala (JVM) via strangler

**Status:** ❌ **Superseded by [ADR-071](ADR-071-manter-dotnet-remover-scala.md)** (era Accepted 2026-06-18 → Paused 2026-06-21 → Superseded 2026-06-21)
**Data:** 2026-06-18 · **Superseded:** 2026-06-21
**Decisores:** Patrick Arinelli, Adonai Arinelli
**Categoria:** Stack / Arquitetura
**Supersede:** ADR-007 (gateway = .NET 10, não Go) — **suspenso enquanto pausado: o gateway segue .NET 10 em prod**
**Relaciona:** ADR-042 (RLS de tenant), ADR-035 (trava server-side de prompts), ADR-018 (cifragem em repouso), ADR-041 (entrega garantida do alerta de crise)

> ## ❌ SUPERSEDED por ADR-071 (2026-06-21)
>
> Decisão final: **manter o gateway em .NET 10 e decomissionar o Scala** — ver **[ADR-071](ADR-071-manter-dotnet-remover-scala.md)**. O que estava como "pausa" virou decisão formal de não migrar. O texto abaixo fica como registro histórico do plano do strangler.
>
> Migração **abandonada** após avaliação de custo/benefício. O strangler chegou a **1 de 62 famílias de rota** (só `GET /api/v1/auth/me`, e mesmo essa **nunca foi flipada** no BFF — produção 100% no .NET). Conclusão: alto esforço (61 rotas restantes, cada clínica/dinheiro exige revisão `clinical-safety`) + alto risco (sistema vivo, cobrando) + valor de negócio imediato ~zero. O gateway .NET funciona, está testado, com RLS e dinheiro fluindo — não é gargalo do lançamento.
>
> **Decisão:** **opção B** — o serviço `api-gateway-scala` foi **removido do box** (docker-compose), do pipeline (docker-bake/deploy.yml) e parou de ser buildado. Libera ~192 MB de JVM ociosa e **destrava o rightsizing da EC2** (a coexistência impedia descer de `t3.large`). A **source fica em `apps/api-gateway-scala/`** (recuperável via git). _(Atualização ADR-071: o repo ECR do Scala foi posteriormente **deletado** — recuperável só reconstruindo da source. Atualização 2026-07-26: a source saiu da árvore ativa; snapshot na tag git `archive/api-gateway-scala`.)_
>
> **Reativar exige:** novo "go" + restaurar o serviço no compose, religar o target no `docker-bake.hcl`/`deploy.yml`, e retomar o roadmap abaixo. Gatilho razoável: bug real da classe "máquina de estados de pagamento" que justifique o Scala tipado, OU o time abraçar Scala com folga.
>
> O `auth/me` em Scala **nem estava em paridade total** (faltava `fotoUrl` via S3 presigned). O roadmap abaixo fica como registro do plano, não como trabalho em curso.

## Contexto

O ADR-007 fixou o gateway transacional em **.NET 10 (ASP.NET Core)** e rejeitou Go,
com três motivos: reuso do gateway do V2, EF Core no CRUD-pesado e ser o stack mais
forte do time. Esse último ponto mudou: o desenvolvedor que sustenta o gateway tem
fluência em **Scala**, não em F#/C#. Em time de duas pessoas (projeto de família),
**fluência do dev é input de engenharia de primeira classe** — sustentabilidade e
velocidade de manutenção pesam tanto quanto as propriedades da linguagem.

Além da ergonomia, há um motivo estrutural de médio prazo: quando o **Fluxo B**
(pagamento médico↔paciente com split, hoje estacionado — ver `project-monetizacao`)
sair do papel, o sistema vai ganhar um **bounded context de pagamento/fraude**. Para
correção de máquina de estados de pagamento (ADTs, `Money` tipado, match exaustivo,
effect systems para exactly-once/saga) e, em escala, detecção de fraude em stream
(Flink CEP), o ecossistema **JVM/Scala** é forte. Padronizar a plataforma na JVM
agora dá acesso natural a Scala/Kotlin/Java sem reescrita futura.

A decisão precisa equilibrar isso contra um fato inegociável: o gateway é **sistema
clínico vivo, multi-tenant, com dinheiro e LGPD categoria especial**. Reescrita
big-bang exporia, de uma vez, todas as superfícies reguladas (RLS de tenant,
cifragem, webhook de pagamento, trava de prompt de crise).

## Decisão

**Migrar o api-gateway de .NET 10 para Scala 3 na JVM, incrementalmente, via
strangler pattern. Nunca big-bang.**

Stack do novo serviço (`apps/api-gateway-scala`):
**cats-effect 3 + http4s (Ember) + Tapir (endpoints tipados) + Doobie (Postgres) +
testcontainers-scala** (gate de isolamento de tenant no CI).

Regras da migração (todas obrigatórias):

1. **Os dois gateways coexistem.** O serviço Scala sobe ao lado do .NET. O BFF
   (`apps/web/app/api/*`) só passa a apontar para um endpoint Scala **depois** que
   aquele endpoint tem paridade de contrato comprovada e os testes verdes.
2. **Ordem: do mais barato ao mais regulado.** Endpoints **não-clínicos read-only**
   primeiro (ex.: `GET /api/v1/auth/me`, `GET /api/v1/minha-assinatura`). Os
   endpoints **clínicos e de dinheiro migram POR ÚLTIMO** (prescrições, mensagens,
   crise, prontuário, conversas, Asaas/cobrança).
3. **Gate de tenant antes de qualquer superfície regulada.** A suíte de isolamento
   de tenant (`apps/api-gateway-tests`, Testcontainers) é **portada para
   testcontainers-scala e tem de estar verde** antes de o BFF flipar qualquer
   endpoint que leia tabela com RLS. Regressão de IDOR é falha de release.
4. **Invariantes de segurança preservados verbatim** (ver abaixo).

### Invariantes de segurança que o serviço Scala reproduz (não pode regredir)

- **Role de banco:** conecta como `cerebro_gateway` (**NOBYPASSRLS**) — a RLS da
  ADR-042/migration 0037-0038 vale por baixo. Workers Python seguem `cerebro_workers`.
- **Tenant por sessão (RLS):** o .NET seta a GUC `app.current_medico` via
  `SELECT set_config('app.current_medico', <id>, false)` (escopo de sessão) e
  limpa no fim do request. O Scala reproduz a **mesma GUC e a mesma semântica**,
  porém com `set_config(..., true)` **transaction-local**: o `set_config` e a query
  do endpoint rodam na **mesma transação Doobie**, e a GUC **auto-reseta no commit/
  rollback**. Mesma propriedade de RLS, sem reset manual e sem risco de vazamento
  entre requests pelo pool. (Melhoria, não desvio.)
- **Resolução de tenant:** o JWT `sub` é o **`usuario_id`, não `medicos.id`**
  (pitfall conhecido). Resolve sempre via `SELECT id FROM medicos WHERE usuario_id = $sub`.
- **JWT:** HS256 com o **mesmo `JWT_SECRET`**, `issuer = cerebro-amigo`, audiences
  `["dashboard", "portal-paciente"]`, claims `sub` + `role`. Tokens emitidos pelo
  fluxo atual continuam válidos nos dois gateways.
- **Fail-closed:** sem role conhecido → nenhuma GUC setada (a RLS barra tudo).
- **Não regride** ADR-035 (trava de prompt de crise), ADR-018 (cifragem em repouso)
  nem ADR-041 (entrega do alerta de crise): esses endpoints são clínicos → migram
  por último, com revisão de `clinical-safety` dedicada.

### Primeira fatia (entregue com este ADR)

`GET /api/v1/auth/me` — perfil do médico logado (health-check de sessão).
Não-clínico, read-only, naturalmente tenant-scopado por `usuario_id`. Reusa a
lógica pura portada de `AssinaturaGate` (ADR-055) e `PlanCatalog` (ADR-059). O
avatar via presigned S3 (`fotoUrl`) fica como **TODO antes do flip do BFF** — não
afeta a coexistência porque o BFF ainda aponta para o `/me` do .NET.

## Alternativas consideradas

- **Ficar no .NET (manter ADR-007).** Menor risco operacional, zero migração. Rejeitado
  pelo custo de sustentação de longo prazo (fluência do time) e por não posicionar a
  plataforma na JVM para o futuro bounded context de pagamento/fraude.
- **F# no .NET (funcional sem trocar runtime).** Entrega ADTs/match exaustivo e interop
  nativo com o C# existente. Rejeitado: o time não tem fluência em F#; aprender F# para
  evitar aprender F# não se justifica quando já há fluência em Scala.
- **Kotlin.** Língua-irmã do C# (mesma classe de runtime, mesma memory safety). Não
  agrega capacidade nova sobre o que já existe. Rejeitado como alvo principal (segue
  disponível na JVM se um serviço específico pedir).
- **Big-bang rewrite .NET→Scala.** Rejeitado: reescreveria de uma vez RLS de tenant,
  cifragem, webhook de pagamento e trava de prompt de crise — janela de regressão
  LGPD/segurança/dinheiro inaceitável num sistema vivo, em pleno período de cobrança.
- **Go (gin/fiber/chi).** Já rejeitado no ADR-007; a única vantagem (RAM ociosa) ataca
  não-gargalo, e CRUD-pesado é fraco no ecossistema Go.

## Consequências aceitas

- **Período de coexistência.** Dois gateways em produção até a migração terminar:
  mais uma imagem no compose/ECR, mais uma lane de CI (sbt), JVM (heap/startup) a
  tunar. O box clínico ganha um serviço; checkup segue isolado (ADR-045).
- **Perda do EF Core.** CRUD vira Doobie (SQL explícito). Trade aceito — SQL explícito
  combina com a disciplina de filtro de tenant.
- **Re-porte cuidadoso de toda superfície regulada.** Cada endpoint clínico/dinheiro é
  reescrito e re-testado com a suíte de isolamento antes do flip. Custo real, pago
  incrementalmente, com rollback trivial (contrato BFF estável → volta ao .NET).
- **DSN.** O `POSTGRES_DSN` do .NET é formato Npgsql (key-value), não JDBC. O serviço
  Scala aceita `POSTGRES_JDBC_URL`/`POSTGRES_USER`/`POSTGRES_PASSWORD` e, na falta,
  converte o `POSTGRES_DSN` para URL JDBC. Deploy provê a forma JDBC.

## Gatilhos de revisão

- A suíte de isolamento de tenant em Scala **não conseguir** reproduzir a paridade de
  RLS do .NET → **pausa a migração**, fica no .NET até resolver.
- A coexistência estourar custo/RAM do box clínico além do aceitável.
- O Fluxo B ser cancelado de vez **e** a ergonomia não justificar sozinha → reavaliar
  se vale terminar a migração ou congelar no estado híbrido.
- Qualquer regressão de IDOR/tenant detectada em produção atribuível ao serviço Scala.

## Plano de execução (strangler)

1. **Fundação (este ADR):** projeto Scala, transactor Doobie como `cerebro_gateway`,
   middleware JWT, middleware de tenant (GUC), `GET /api/v1/auth/me`, teste de
   isolamento de tenant em testcontainers-scala. Serviço sobe em paralelo; BFF intocado.
2. **CI:** adicionar lane sbt (`sbt test`) — o teste de isolamento vira gate, igual ao
   xUnit atual.
3. **Migrar endpoints não-clínicos read-only** um a um; flip do BFF por endpoint após
   paridade + verde. Completar `fotoUrl` (S3) do `/me` antes do seu flip.
4. **Endpoints transacionais não-clínicos** (escrita de perfil, catálogo, etc.).
5. **Por último, clínico e dinheiro** — cada um com revisão `clinical-safety` e a suíte
   de tenant verde antes do flip. Cifragem (ADR-018) e crise (ADR-035/041) reauditadas.
6. **Desligar o gateway .NET** só quando 100% dos endpoints estiverem em Scala e estáveis.

## Referências

- ADR-007 (superseded) — gateway .NET, não Go
- ADR-042 — RLS de tenant (17+ tabelas, `cerebro_gateway` NOBYPASSRLS)
- ADR-035 — trava server-side dos prompts de crise/auditoria
- ADR-018 — cifragem em repouso de `mensagens.conteudo`
- ADR-055 — `AssinaturaGate` (gate de assinatura do médico)
- ADR-059 — `PlanCatalog` (planos e features de IA por tier)
- `apps/api-gateway-scala/README.md` — build, run, test e estado da migração
