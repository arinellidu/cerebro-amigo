"""Enums de provider/tier e tabela de preço ciente de provider (ADR-015).

Módulo de baixo nível, sem dependências internas (o `llm.py` importa daqui).

`custo_usd` é uma ESTIMATIVA — a coluna em `mensagens`/`agente_execucoes` é
documentada como "custo estimado". Os valores de `PRICE_MAP` são list-price
em USD por milhão de tokens e DEVEM ser confirmados nas páginas de preço
atuais de Anthropic e AWS Bedrock antes de tratar o custo como exato.
"""

from __future__ import annotations

from enum import StrEnum


class LLMProvider(StrEnum):
    ANTHROPIC = "anthropic"
    BEDROCK = "bedrock"


class ModelTier(StrEnum):
    HAIKU = "haiku"
    SONNET = "sonnet"
    OPUS = "opus"


# Preço por MILHÃO de tokens: (input_usd_por_mtok, output_usd_por_mtok).
# Provider-aware: Anthropic API e Bedrock-global podem divergir; manter
# entradas separadas mesmo quando os números coincidem hoje.
PRICE_MAP: dict[tuple[LLMProvider, ModelTier], tuple[float, float]] = {
    # Anthropic API (list price — confirmar)
    (LLMProvider.ANTHROPIC, ModelTier.HAIKU): (1.00, 5.00),
    (LLMProvider.ANTHROPIC, ModelTier.SONNET): (3.00, 15.00),
    (LLMProvider.ANTHROPIC, ModelTier.OPUS): (15.00, 75.00),
    # AWS Bedrock global inference profiles (list price — confirmar)
    (LLMProvider.BEDROCK, ModelTier.HAIKU): (1.00, 5.00),
    (LLMProvider.BEDROCK, ModelTier.SONNET): (3.00, 15.00),
    (LLMProvider.BEDROCK, ModelTier.OPUS): (15.00, 75.00),
}


def tier_from_model_id(model_id: str | None) -> ModelTier | None:
    """Deriva o tier do model-id por substring.

    Funciona nos dois providers: tanto `claude-sonnet-4-6` quanto
    `global.anthropic.claude-sonnet-4-6` contêm o nome do tier.
    """
    if not model_id:
        return None
    mid = model_id.lower()
    if "haiku" in mid:
        return ModelTier.HAIKU
    if "sonnet" in mid:
        return ModelTier.SONNET
    if "opus" in mid:
        return ModelTier.OPUS
    return None


def compute_cost(
    provider: LLMProvider,
    model_id: str | None,
    tokens_in: int | None,
    tokens_out: int | None,
) -> float | None:
    """Estima o custo em USD de uma chamada. Retorna None se faltar dado.

    Não levanta exceção: custo é telemetria, nunca deve quebrar o caminho
    clínico. Tier desconhecido ou tokens ausentes → None.
    """
    tier = tier_from_model_id(model_id)
    if tier is None:
        return None
    rates = PRICE_MAP.get((provider, tier))
    if rates is None:
        return None
    in_rate, out_rate = rates
    ti = tokens_in or 0
    to = tokens_out or 0
    return round((ti / 1_000_000) * in_rate + (to / 1_000_000) * out_rate, 6)


# Embeddings (ADR-028) — preço por MILHÃO de tokens (list price Bedrock — confirmar).
# Só input (embedding não tem output tokens).
EMBED_PRICE_PER_MTOK: dict[str, float] = {
    "cohere.embed-multilingual-v3": 0.10,
    "cohere.embed-english-v3": 0.10,
    "amazon.titan-embed-text-v2:0": 0.02,
    "cohere.embed-v4:0": 0.12,
}


def compute_embedding_cost(model_id: str | None, tokens: int | None) -> float | None:
    """Estima o custo de uma chamada de embedding. None se faltar dado. Não levanta."""
    if not model_id or not tokens:
        return None
    rate = EMBED_PRICE_PER_MTOK.get(model_id)
    if rate is None:
        return None
    return round((tokens / 1_000_000) * rate, 6)
