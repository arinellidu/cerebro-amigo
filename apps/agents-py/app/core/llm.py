"""Factory de clientes LLM — provider-switchável (ADR-015).

`LLM_PROVIDER` decide o transporte: `anthropic` (ChatAnthropic, API direta) ou
`bedrock` (ChatBedrockConverse, AWS). Troca = uma env var; os agentes só chamam
`haiku()` / `sonnet()` / `ainvoke_structured()`.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from typing import Any, TypeVar

from langchain_core.language_models import BaseChatModel
from langchain_core.runnables import Runnable
from pydantic import BaseModel

from app.core.config import get_settings
from app.core.pricing import LLMProvider, ModelTier, compute_cost

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
    """Constrói o cliente conforme `LLM_PROVIDER`. Import do SDK é lazy."""
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
    return build_chat_model(ModelTier.HAIKU, temperature=0.0, max_tokens=1024)


@lru_cache(maxsize=4)
def sonnet(temperature: float = 0.2) -> BaseChatModel:
    return build_chat_model(ModelTier.SONNET, temperature=temperature, max_tokens=2048)


def with_schema(llm: BaseChatModel, schema: type[T]) -> Runnable[Any, T]:  # noqa: UP047
    """Saída estruturada simples (sem trilha de uso)."""
    return llm.with_structured_output(schema, include_raw=False)  # type: ignore[return-value]


@dataclass(frozen=True)
class StructuredCall:
    """Resultado de uma chamada estruturada com métricas de uso."""

    parsed: BaseModel
    tokens_in: int | None
    tokens_out: int | None
    model_id: str | None
    custo_usd: float | None


def _extract_model_id(raw: Any, llm: BaseChatModel) -> str | None:
    """Model-id provider-aware: Bedrock põe em response_metadata.model_id;
    Anthropic em response_metadata.model. Fallback: o id configurado no cliente.
    """
    rm = getattr(raw, "response_metadata", {}) or {}
    return (
        rm.get("model_id")
        or rm.get("model")
        or rm.get("model_name")
        or getattr(llm, "model", None)
        or getattr(llm, "model_id", None)
    )


async def ainvoke_structured(  # noqa: UP047
    
    llm: BaseChatModel,
    schema: type[T],
    messages: list,
) -> StructuredCall:
    """Chama o modelo com structured output E captura usage metadata + custo.

    Falha alto: se o LLM responder mas o output não validar contra o
    schema, levantamos com o conteúdo bruto truncado nos logs.
    """
    import structlog as _structlog
    _log = _structlog.get_logger(__name__)

    runnable = llm.with_structured_output(schema, include_raw=True)
    result = await runnable.ainvoke(messages)

    raw = result.get("raw") if isinstance(result, dict) else None
    parsed = result.get("parsed") if isinstance(result, dict) else result
    parsing_error = (
        result.get("parsing_error") if isinstance(result, dict) else None
    )

    usage = getattr(raw, "usage_metadata", None) or {}
    model_id = _extract_model_id(raw, llm)

    if parsing_error is not None or parsed is None:
        raw_content = getattr(raw, "content", None)
        raw_preview = (
            str(raw_content)[:800] if raw_content else "<no raw content>"
        )
        _log.error(
            "structured_output.parsing_failed",
            schema=schema.__name__,
            parsing_error=str(parsing_error) if parsing_error else "parsed=None",
            raw_preview=raw_preview,
            tokens_in=usage.get("input_tokens"),
            tokens_out=usage.get("output_tokens"),
        )
        raise ValueError(
            f"LLM output failed schema validation for {schema.__name__}: "
            f"{parsing_error or 'parsed=None'}"
        )

    tokens_in = usage.get("input_tokens")
    tokens_out = usage.get("output_tokens")
    provider = LLMProvider(get_settings().llm_provider)
    custo_usd = compute_cost(provider, model_id, tokens_in, tokens_out)

    return StructuredCall(
        parsed=parsed,  # type: ignore[arg-type]
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        model_id=model_id,
        custo_usd=custo_usd,
    )
