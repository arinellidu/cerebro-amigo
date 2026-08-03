# ADR-072: Deploy do box clínico — stop-then-start do gateway (downtime curto × footprint)

**Status:** Accepted
**Data:** 2026-06-21
**Decisores:** Patrick Arinelli, Adonai Arinelli
**Categoria:** Infra / Deploy
**Relaciona:** ADR-071 (gateway = .NET 10, Scala removido), `docs/infra-baseline.md` (rightsizing), ADR-041 (entrega garantida do alerta de crise)

## Contexto

O deploy clínico (SSM no box EC2 `i-057860cd97edafefb`) faz `docker compose pull` + `docker compose up -d --no-build --remove-orphans`. O pico de memória de deploy medido no baseline (até **5,8 GB**) vinha sobretudo de:

1. **Build cache do Docker** (chegou a 11 GB) — resolvido (prune manual + automático no deploy, ver `docs/runbooks/ec2-disk-hygiene.md`).
2. **JVM do gateway Scala** em coexistência — resolvido (Scala decomissionado, ADR-071).
3. **Recriação simultânea de todos os serviços** durante o `up` + warmup.

Restava garantir o invariante pedido: **nunca dois processos do gateway .NET ao mesmo tempo** durante o deploy, e cortar o footprint do gateway da janela de recriação.

> Nota técnica: o `docker compose up` v2 recria um serviço como `stop → rm → create → start` (não há blue-green; um serviço **não** se sobrepõe a si mesmo por padrão). Esta decisão **torna explícito e garante** o comportamento, independente da versão do compose, e libera a memória do gateway **antes** da janela em que os demais serviços recriam.

## Decisão

No deploy clínico, **parar o gateway antes de subir o novo** — `docker compose stop api-gateway` imediatamente após o `docker compose pull` e antes do `docker compose up -d`.

- **Garante** que o processo .NET antigo está morto antes de o novo iniciar (zero sobreposição).
- **Libera** os ~130 MB do gateway antes da recriação dos demais serviços → menor pico concorrente.
- **Health checks pós-subida mantidos** (loop em `:5050/health`+`/ready`, e nos 3 Python).
- **Escopo: só o gateway.** Os serviços do caminho de crise (`orchestrator-py`, `notifier-py`) **não** são parados deliberadamente — seguem a recriação padrão do compose, preservando o processamento/entrega de alerta de crise (ADR-041).

## Trade-off aceito

**Downtime de deploy trocado por footprint menor.** O gateway fica indisponível da parada até o novo passar no health check (alguns segundos a ~1-2 min no pior caso de warmup). Aceitável: **piloto de ~1 usuário**, sem SLA de zero-downtime. Requests ao gateway durante a janela falham (BFF devolve 502/`erro_conexao`; o médico re-tenta). Detecção/entrega de crise não depende do gateway estar de pé (orchestrator/notifier seguem rodando; ADR-041 tem retry+backoff).

## Consequências

- Pico de deploy menor → **destrava o rightsizing** da EC2 (`t3.large → t3.medium`, ver `docs/infra-baseline.md` §7). Re-medir o pico pós-mudança antes de descer a classe.
- Rollback inalterado: re-puxa imagem do SHA anterior do ECR.
- Se um dia houver SLA de zero-downtime (mais usuários), revisar: blue-green/2ª instância atrás de proxy, ou ALB com 2 targets — fora de escopo agora.
