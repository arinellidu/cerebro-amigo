# Client LLM unificado — provider-switchável (ADR-015 + ADR-044)

> **Nota:** o arquivo mantém o nome `bedrock-client.md` por compatibilidade de
> referências, mas documenta o **client unificado** dos serviços Python. O LLM é
> **provider-switchável** por `LLM_PROVIDER`; o **vigente é Anthropic API direta**
> (ADR-044). O Bedrock é um caminho **reservado atrás da flag**, hoje inativo.
> A versão anterior deste doc (SDK `AnthropicBedrock`, "Bedrock-only", ADR-008)
> está **obsoleta** — o ADR-015 supersedeu o ADR-008, que está suspenso.

Leia ao mexer no client de LLM, no roteamento de modelo, em auth/região, ou ao
cogitar trocar de provider. Código real: `orchestrator-py/app/conversation/llm.py`,
`agents-py/app/core/llm.py`, `app/config.py`, `app/conversation/pricing.py`.

## Decisão (ADR-015, reafirmada pelo ADR-044)

- **`LLM_PROVIDER` ∈ {`anthropic`, `bedrock`}**, default/vigente `anthropic`. Trocar
  de provider é mudar **uma env var**, não reescrever — prompts, thresholds clínicos
  e lógica de grafo/agentes ficam **inalterados**.
- **Por que Anthropic é o vigente:** a residência LGPD que justificaria Bedrock-in-region
  **não se concretiza** em `sa-east-1` — os model-ids que funcionam no Converse são perfis
  `global.` (`global.anthropic.claude-*`), que roteiam para fora do BR; on-demand puro
  (`anthropic.*`) dá `ValidationException`. Logo Anthropic API e Bedrock-global são
  **equivalentes em residência** (ambos processam fora do BR) e vence a **simplicidade**
  (uma key, sem quota/Marketplace/perfil/IAM). Soma-se que o acesso aos modelos Anthropic
  no Bedrock **não foi aprovado pela AWS** (quota zerada) — por isso o ADR-044 mantém `anthropic`.
- 🔒 **Não reverter para Bedrock sem um novo ADR aprovado.** O caminho Bedrock segue
  suportado atrás da flag e **não pode ser quebrado** em refactors — mas flipar o default
  é decisão de arquitetura, não de código.

## A factory (o que os call-sites usam)

Os call-sites **nunca** instanciam SDK direto. Chamam helpers que escondem o provider:

```python
from app.conversation.llm import haiku, sonnet, with_schema  # orchestrator-py
# from app.core.llm import haiku, sonnet, with_schema, ainvoke_structured  # agents-py

llm = sonnet(temperature=0.3)          # BaseChatModel (LangChain)
resp = await llm.ainvoke(messages)     # ou .astream_events(...) p/ SSE
parsed = await with_schema(haiku(), MeuSchema).ainvoke(messages)
```

Por baixo, `build_chat_model(tier, *, temperature, max_tokens)` despacha pelo
`LLM_PROVIDER` (lido 1× da config) com **import lazy** — só o provider ativo precisa
estar instalado:

```python
def build_chat_model(tier, *, temperature, max_tokens):
    s = get_settings()
    provider = LLMProvider(s.llm_provider)
    model_id = resolve_model_id(provider, tier)   # id por provider+tier, lido da config

    if provider is LLMProvider.ANTHROPIC:
        from langchain_anthropic import ChatAnthropic
        return ChatAnthropic(
            model=model_id,
            api_key=s.anthropic_api_key.get_secret_value() if s.anthropic_api_key else None,
            temperature=temperature, max_tokens=max_tokens,
        )

    from langchain_aws import ChatBedrockConverse
    return ChatBedrockConverse(
        model_id=model_id, region_name=s.bedrock_region,
        temperature=temperature, max_tokens=max_tokens,
    )
```

`agents-py` ainda expõe `ainvoke_structured(llm, schema, messages) -> StructuredCall`,
que captura `usage_metadata` (tokens) + custo e **falha alto** se o output não validar
contra o schema.

## Mapeamento de modelos (exatos — ADR-015)

| Tier | `anthropic` (vigente) | `bedrock` (reservado) |
|---|---|---|
| HAIKU | `claude-haiku-4-5-20251001` | `global.anthropic.claude-haiku-4-5-20251001-v1:0` |
| SONNET | `claude-sonnet-4-6` | `global.anthropic.claude-sonnet-4-6` |
| OPUS | `claude-opus-4-8` | `global.anthropic.claude-opus-4-8` |

Não chumbe IDs no call-site — `resolve_model_id` lê da config. Os defaults vivem em
`config.py`; sobrescreva por env se a conta exigir.

## Variáveis de ambiente

```
LLM_PROVIDER=anthropic              # vigente. bedrock = reservado, atrás da flag

# LLM_PROVIDER=anthropic (vigente)
ANTHROPIC_API_KEY=...              # SSM SecureString — NUNCA em código/imagem/log
ANTHROPIC_MODEL_HAIKU=claude-haiku-4-5-20251001
ANTHROPIC_MODEL_SONNET=claude-sonnet-4-6
ANTHROPIC_MODEL_OPUS=claude-opus-4-8

# LLM_PROVIDER=bedrock (reservado — auth via IAM role, sem key)
AWS_REGION=sa-east-1
BEDROCK_REGION=sa-east-1
BEDROCK_MODEL_HAIKU=global.anthropic.claude-haiku-4-5-20251001-v1:0
BEDROCK_MODEL_SONNET=global.anthropic.claude-sonnet-4-6
BEDROCK_MODEL_OPUS=global.anthropic.claude-opus-4-8
```

**Auth fail-fast** (validator no startup): `anthropic` exige `ANTHROPIC_API_KEY`;
`bedrock` exige `BEDROCK_REGION`. O app **não sobe** sem a auth do provider ativo.

**NÃO existem mais:** `MODEL_HAIKU`/`MODEL_SONNET` (nomenclatura V2), nenhum `AZURE_*`.

## Custo (provider-aware — pricing.py)

`PRICE_MAP[(provider, tier)]` em USD/Mtoken; `compute_cost(provider, model_id,
tokens_in, tokens_out)` estima e grava `custo_usd` em `mensagens`/`agente_execucoes`.
É **estimativa** (list-price) — confirme nas páginas de preço antes de tratar como exato.
Custo é telemetria: `compute_cost` nunca levanta exceção (tier desconhecido / tokens
ausentes → `None`).

> **Teto de custo (ADR-011):** o `custo_usd` que o price map popula alimenta o gate diário
> do `agents-py` (`cost_gate.py`, `MAX_DAILY_LLM_USD`), que pausa **apenas agentes batch
> não-críticos** ao atingir o teto. **Crise/conversa** (orchestrator) e o agente
> `risco_silencioso` **nunca** são gateados; o gate é **fail-open** (erro de contagem →
> prossegue). A trava de dinheiro de fato é o limite mensal no Console da Anthropic.

## Se algum dia flipar para Bedrock (precisa de ADR)

1. Novo ADR aprovado revertendo/ajustando o ADR-044.
2. AWS aprovar o acesso aos modelos Anthropic + quota em `sa-east-1` (hoje zerada).
3. `pip install langchain-aws` no serviço; IAM role com `bedrock:InvokeModel*` na EC2.
4. `LLM_PROVIDER=bedrock` + `BEDROCK_MODEL_*` no ambiente. Sem mudança de call-site.
5. Validar streaming/SSE do caminho de crise ponta a ponta.

## Invariantes clinical-safety (preservadas nos dois providers)

- **Streaming/SSE do caminho de crise** idêntico (LangChain normaliza chunks).
- **Redação de PII** (ADR-004) é hook de trace do LangSmith — provider-agnóstica.
- **Protocolo de crise** com texto fixo (`crisis_copy.py`) e detecção fail-safe (ADR-006)
  inalterados — só o transporte do classificador muda.
- **Structured output** via `with_structured_output` funciona nos dois.
