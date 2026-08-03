"""Testes da camada LLM provider-switchável (ADR-015).

Cobre resolução de model-id por provider, derivação de tier, custo
provider-aware e o fail-fast do validator. Sem chamada real ao LLM.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.core.pricing import (
    PRICE_MAP,
    LLMProvider,
    ModelTier,
    compute_cost,
    tier_from_model_id,
)

# ─── tier_from_model_id ─────────────────────────────────────────────────────

@pytest.mark.parametrize(
    "model_id,esperado",
    [
        ("claude-haiku-4-5-20251001", ModelTier.HAIKU),
        ("global.anthropic.claude-haiku-4-5-20251001-v1:0", ModelTier.HAIKU),
        ("claude-sonnet-4-6", ModelTier.SONNET),
        ("global.anthropic.claude-sonnet-4-6", ModelTier.SONNET),
        ("claude-opus-4-8", ModelTier.OPUS),
        ("global.anthropic.claude-opus-4-8", ModelTier.OPUS),
        ("modelo-desconhecido", None),
        (None, None),
    ],
)
def test_tier_from_model_id(model_id, esperado):
    assert tier_from_model_id(model_id) == esperado


# ─── compute_cost (provider-aware) ──────────────────────────────────────────

def test_compute_cost_anthropic_sonnet():
    # 1M in + 1M out no Sonnet anthropic = 3.00 + 15.00 = 18.00
    custo = compute_cost(
        LLMProvider.ANTHROPIC, "claude-sonnet-4-6", 1_000_000, 1_000_000
    )
    assert custo == pytest.approx(18.0)


def test_compute_cost_bedrock_haiku():
    # 1M in + 1M out no Haiku bedrock = 1.00 + 5.00 = 6.00
    custo = compute_cost(
        LLMProvider.BEDROCK,
        "global.anthropic.claude-haiku-4-5-20251001-v1:0",
        1_000_000,
        1_000_000,
    )
    assert custo == pytest.approx(6.0)


def test_compute_cost_provider_aware_keys_existem():
    # Toda combinacao provider x tier deve ter preco (price map nao e no-op).
    for provider in LLMProvider:
        for tier in ModelTier:
            assert (provider, tier) in PRICE_MAP


def test_compute_cost_none_quando_tier_desconhecido():
    assert compute_cost(LLMProvider.ANTHROPIC, "xpto", 100, 100) is None


def test_compute_cost_trata_tokens_none():
    # tokens None → conta como 0, não levanta.
    custo = compute_cost(LLMProvider.ANTHROPIC, "claude-sonnet-4-6", None, None)
    assert custo == 0.0


# ─── resolve_model_id ───────────────────────────────────────────────────────

def test_resolve_model_id_por_provider():
    from app.core.llm import resolve_model_id

    assert resolve_model_id(LLMProvider.ANTHROPIC, ModelTier.HAIKU) == (
        "claude-haiku-4-5-20251001"
    )
    assert resolve_model_id(LLMProvider.BEDROCK, ModelTier.SONNET) == (
        "global.anthropic.claude-sonnet-4-6"
    )


# ─── Fail-fast do validator ─────────────────────────────────────────────────

def test_validator_anthropic_sem_key_falha(monkeypatch):
    """LLM_PROVIDER=anthropic sem ANTHROPIC_API_KEY → erro no startup."""
    from app.core.config import Settings

    monkeypatch.setenv("POSTGRES_DSN_URL", "postgresql://t:t@localhost:5432/t")
    monkeypatch.setenv("INTERNAL_API_TOKEN", "x")
    monkeypatch.setenv("LLM_PROVIDER", "anthropic")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)

    with pytest.raises(ValidationError, match="ANTHROPIC_API_KEY"):
        Settings(_env_file=None)  # type: ignore[call-arg]


def test_validator_bedrock_ok_sem_anthropic_key(monkeypatch):
    """LLM_PROVIDER=bedrock não exige ANTHROPIC_API_KEY."""
    from app.core.config import Settings

    monkeypatch.setenv("POSTGRES_DSN_URL", "postgresql://t:t@localhost:5432/t")
    monkeypatch.setenv("INTERNAL_API_TOKEN", "x")
    monkeypatch.setenv("LLM_PROVIDER", "bedrock")
    monkeypatch.setenv("BEDROCK_REGION", "sa-east-1")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)

    s = Settings(_env_file=None)  # type: ignore[call-arg]
    assert s.llm_provider == "bedrock"
