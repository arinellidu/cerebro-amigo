# ADR-007: Gateway transacional em .NET 10, não Go

**Status:** Accepted
**Data:** 2026-05-29
**Decisores:** Patrick Arinelli, Adonai Arinelli
**Categoria:** Stack
**Supersede:** Complementa ADR-001 com contexto específico do V3

## Contexto

No início do V3, o monorepo foi reconstruído do zero. Isso criou uma janela
de oportunidade percebida para reconsiderar a linguagem do backend transacional.

O padrão de mercado para "API gateway" de alta performance aponta para Go
(kong, traefik, krakend, e frameworks como gin/fiber têm adoção forte). A
palavra "gateway" no nome `apps/api-gateway/` amplificou essa discussão.

Adicionalmente, o time considerou que um fresh start tornaria a migração
menos custosa do que seria em projeto maduro — argumento válido, mas que
precisa ser pesado contra o custo real da reescrita e o risco introduzido.

O serviço `apps/api-gateway/` **não é um API Gateway no sentido técnico
estrito** (proxy de roteamento, rate-limiting, plugin-based). É o backend
transacional do produto: JWT, CRUD clínico-administrativo, prescrições,
e-mail via Resend, proxy SSE para o orchestrator-py. O nome é herança de
nomenclatura do V2 — ver ADR-001 § Decisão.

## Decisão

**Manter o backend transacional em .NET 10 (ASP.NET Core). Não reescrever
em Go.**

## Alternativas consideradas

### Alternativa A — Go (gin / fiber / chi)

**Argumento principal a favor:** Go é excelente para proxies e serviços de
alta concorrência I/O. Binário pequeno (~30 MB), startup instantâneo,
goroutines mais eficientes que threads do .NET em throughput I/O puro.
Fresh start em V3 reduziria o custo de migração.

**Por que rejeitamos:**

1. **O domínio não é I/O puro.** O backend faz CRUD relacional pesado
   (EF Core + Postgres), lógica de negócio clínico, emissão de e-mail,
   proxy SSE. O gargalo é Postgres e Anthropic/Bedrock, não o throughput
   do servidor HTTP. Go venceria numa carga que não é a nossa.

2. **EF Core é vantagem real neste domínio.** O schema tem ~20 tabelas
   com relacionamentos complexos (multi-tenant, timeline, prescrições,
   agendamentos). EF Core + migrations LINQ reduz drasticamente o risco
   de bug SQL em queries multi-join com filtros de tenant. Go requereria
   sqlc ou GORM — ambos maduros, mas sem LINQ; queries complexas voltam
   a ser SQL string com risco de injeção ou erro de tenant.

3. **O domínio fiscal brasileiro favorece .NET.** NFE.io, Mercado Pago e
   integrações tributárias têm bibliotecas mais maduras e com mais
   exemplos em .NET. Go tem opções, mas menor base de uso em SaaS B2B
   brasileiro.

4. **Custo de RAM não é gargalo.** Argumento clássico a favor do Go é
   footprint de memória (Go ~30 MB vs .NET ~200 MB em idle). Na EC2
   atual (`t3.small`/`t3.medium`), o gargalo de RAM são os 3 serviços
   Python + Next.js, não o gateway. Antes de reescrever em Go para
   economizar RAM, a alavanca certa é `DOTNET_gcServer=0` +
   `DOTNET_GCHeapHardLimit` (reduz .NET para ~80-100 MB) ou Native AOT
   (~30-50 MB), mantendo .NET.

5. **Risco de regressão clínica.** Reescrever em V3 o mesmo domínio
   que funciona em .NET no V2 significa reescrever auth (JWT + magic
   link), isolamento de tenant, trilhas de auditoria append-only, proxy
   SSE. Qualquer bug nesses mecanismos em sistema de saúde mental tem
   impacto clínico e regulatório. O custo de introduzir esse risco
   supera o benefício de RAM ociosa economizada.

## Consequências aceitas

1. **Stack heterogêneo mantido.** .NET + Python + TypeScript. Ver
   ADR-001 § Consequências para argumentação completa.

2. **Nome `apps/api-gateway/` permanece.** Semântica incorreta mas
   mudar o diretório é cosmético e seria commit barulhento.

3. **RAM em produção precisa de tuning.** Se o footprint .NET em idle
   virar problema real, aplicar `DOTNET_gcServer=0` e
   `DOTNET_GCHeapHardLimit` antes de considerar reescrita.

## Gatilhos de revisão

- **RAM em EC2 se tornar gargalo sustentado** (p.ex., necessidade de
  aumentar instância exclusivamente por causa do .NET, não do Python)
  **E** Native AOT não resolver o problema.
- **Equipe perder competência .NET** de forma permanente (contratação
  impossível, rotatividade que zera o conhecimento).
- **Decisão de remover domínio fiscal** do serviço (faturamento/NF
  migrando para SaaS externo), tornando o backend um CRUD simples onde
  a vantagem do EF Core é menos decisiva.

## Referências

- ADR-001: argumentação completa sobre .NET vs Python vs Go vs microserviços.
- ADR-008: decisão de LLM via Bedrock (não Go tampouco envolve o gateway).
- `apps/api-gateway/` skill `dotnet-gateway`: convenções de implementação.
