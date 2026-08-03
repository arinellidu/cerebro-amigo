"""Fixtures globais."""

from __future__ import annotations

import asyncio
import os

import pytest


@pytest.fixture(scope="session", autouse=True)
def _required_env_vars():
    """Injeta variáveis de ambiente mínimas para testes unitários (sem DB real).

    Muitos testes chamam get_settings() para ler thresholds configuráveis
    (padroes, adesao, risco_silencioso). As vars abaixo satisfazem os campos
    obrigatórios do Settings sem precisar de DB real.
    """
    required = {
        "POSTGRES_DSN_URL": "postgresql://test:test@localhost:5432/test",
        "INTERNAL_API_TOKEN": "test-token-unit-tests-only",
        # LLM_PROVIDER default = anthropic → o @model_validator exige a key.
        "ANTHROPIC_API_KEY": "sk-ant-test-unit-tests-only",
    }
    previous = {k: os.environ.get(k) for k in required}
    for k, v in required.items():
        if k not in os.environ:
            os.environ[k] = v

    try:
        from app.core.config import get_settings
        get_settings.cache_clear()
    except Exception:
        pass

    yield

    for k, v in previous.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v
    try:
        from app.core.config import get_settings
        get_settings.cache_clear()
    except Exception:
        pass


@pytest.fixture(scope="session")
def event_loop_policy():
    return asyncio.DefaultEventLoopPolicy()
