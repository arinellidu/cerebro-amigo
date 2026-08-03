"""Testes da camada LLM provider-switchável (ADR-015) — orchestrator.

Cobre resolução de model-id, custo provider-aware e fail-fast do validator.
Sem chamada real ao LLM. O caminho de crise/streaming é coberto por
test_graph_routing.py (roteamento) — aqui é só transporte/config.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.conversation.pricing import (
    PRICE_MAP,
    LLMProvider,
    ModelTier,
    compute_cost,
    tier_from_model_id,
)


def test_tier_from_model_id_ambos_providers():
    assert tier_from_model_id("claude-sonnet-4-6") == ModelTier.SONNET
    assert (
        tier_from_model_id("global.anthropic.claude-haiku-4-5-20251001-v1:0")
        == ModelTier.HAIKU
    )
    assert tier_from_model_id(None) is None


def test_compute_cost_provider_aware():
    anthropic = compute_cost(LLMProvider.ANTHROPIC, "claude-sonnet-4-6", 1_000_000, 0)
    bedrock = compute_cost(
        LLMProvider.BEDROCK, "global.anthropic.claude-sonnet-4-6", 1_000_000, 0
    )
    assert anthropic == pytest.approx(3.0)
    assert bedrock == pytest.approx(3.0)
    # price map cobre toda combinação (não é no-op)
    assert len(PRICE_MAP) == len(list(LLMProvider)) * len(list(ModelTier))


def test_resolve_model_id():
    from app.conversation.llm import resolve_model_id

    assert resolve_model_id(LLMProvider.ANTHROPIC, ModelTier.SONNET) == "claude-sonnet-4-6"
    assert (
        resolve_model_id(LLMProvider.BEDROCK, ModelTier.HAIKU)
        == "global.anthropic.claude-haiku-4-5-20251001-v1:0"
    )


def test_validator_anthropic_sem_key_falha(monkeypatch):
    from app.config import Settings

    monkeypatch.setenv("POSTGRES_DSN_URL", "postgresql://t:t@localhost:5432/t")
    monkeypatch.setenv("INTERNAL_API_TOKEN", "x")
    monkeypatch.setenv("LLM_PROVIDER", "anthropic")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)

    with pytest.raises(ValidationError, match="ANTHROPIC_API_KEY"):
        Settings(_env_file=None)  # type: ignore[call-arg]


def test_validator_bedrock_ok(monkeypatch):
    from app.config import Settings

    monkeypatch.setenv("POSTGRES_DSN_URL", "postgresql://t:t@localhost:5432/t")
    monkeypatch.setenv("INTERNAL_API_TOKEN", "x")
    monkeypatch.setenv("LLM_PROVIDER", "bedrock")
    monkeypatch.setenv("BEDROCK_REGION", "sa-east-1")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)

    s = Settings(_env_file=None)  # type: ignore[call-arg]
    assert s.llm_provider == "bedrock"
