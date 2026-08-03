"""Factory de clientes LLM — provider-switchável (ADR-015).

`LLM_PROVIDER` decide o transporte: `anthropic` (ChatAnthropic, API direta) ou
`bedrock` (ChatBedrockConverse, AWS). A troca é UMA env var — os call-sites só
chamam `haiku()` / `sonnet()` / `with_schema()` e não sabem qual provider está
ativo. Streaming, structured output e usage_metadata são normalizados pelo
LangChain nos dois providers.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Any, TypeVar

from langchain_core.language_models import BaseChatModel
from langchain_core.runnables import Runnable
from pydantic import BaseModel

from app.config import get_settings
from app.conversation.pricing import LLMProvider, ModelTier

T = TypeVar("T", bound=BaseModel)


def resolve_model_id(provider: LLMProvider, tier: ModelTier) -> str:
    """Model-id por provider+tier, lido da config (sem mágica de string)."""
    s = get_settings()
    if provider is LLMProvider.ANTHROPIC:
        return {
            ModelTier.HAIKU: s.anthropic_model_haiku,
            ModelTier.SONNET: s.anthropic_model_sonnet,
            ModelTier.OPUS: s.anthropic_model_opus,
        }[tier]
    return {
        ModelTier.HAIKU: s.bedrock_model_haiku,
        ModelTier.SONNET: s.bedrock_model_sonnet,
        ModelTier.OPUS: s.bedrock_model_opus,
    }[tier]


def build_chat_model(
    tier: ModelTier, *, temperature: float, max_tokens: int
) -> BaseChatModel:
    """Constrói o cliente conforme `LLM_PROVIDER`. Import do SDK é lazy: só o
    provider ativo precisa estar instalado."""
    s = get_settings()
    provider = LLMProvider(s.llm_provider)
    model_id = resolve_model_id(provider, tier)

    if provider is LLMProvider.ANTHROPIC:
        from langchain_anthropic import ChatAnthropic

        return ChatAnthropic(
            model=model_id,  # type: ignore[call-arg]
            api_key=s.anthropic_api_key.get_secret_value() if s.anthropic_api_key else None,
            temperature=temperature,
            max_tokens=max_tokens,
        )

    from langchain_aws import ChatBedrockConverse

    return ChatBedrockConverse(
        model_id=model_id,
        region_name=s.bedrock_region,
        temperature=temperature,
        max_tokens=max_tokens,
    )


@lru_cache(maxsize=4)
def haiku() -> BaseChatModel:
    """Modelo leve para classificação/auditoria."""
    return build_chat_model(ModelTier.HAIKU, temperature=0.0, max_tokens=512)


@lru_cache(maxsize=4)
def sonnet(temperature: float = 0.3) -> BaseChatModel:
    """Modelo médio para extração e geração de resposta.

    Streaming é controlado pelo método de invocação (astream/astream_events)
    — não requer flag na inicialização, nos dois providers.
    """
    return build_chat_model(ModelTier.SONNET, temperature=temperature, max_tokens=1024)


def with_schema(llm: BaseChatModel, schema: type[T]) -> Runnable[Any, T]:  # noqa: UP047
    """Atalho para saída estruturada via JSON schema."""
    return llm.with_structured_output(schema, include_raw=False)  # type: ignore[return-value]
