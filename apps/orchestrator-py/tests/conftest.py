"""Fixtures globais de teste.

Em CI: idealmente subir um Postgres efêmero (testcontainers ou serviço do
GitHub Actions). Aqui deixamos a estrutura para Patrick decidir o setup.
"""

from __future__ import annotations

import asyncio
import os

import pytest


@pytest.fixture(scope="session", autouse=True)
def _required_env_vars():
    """Injeta variáveis de ambiente mínimas para testes unitários (sem DB real).

    Testes de roteamento do grafo (test_graph_routing.py) são puramente
    determinísticos — não fazem I/O. Mas _route_after_audit chama get_settings()
    (que tem @lru_cache) para ler max_retry_audit. As vars abaixo satisfazem
    os campos obrigatórios do Settings sem precisar de DB real.
    """
    required = {
        "POSTGRES_DSN_URL": "postgresql://test:test@localhost:5432/test",
        "INTERNAL_API_TOKEN": "test-token-unit-tests-only",
        # LLM_PROVIDER default = anthropic → o @model_validator exige a key.
        "ANTHROPIC_API_KEY": "sk-ant-test-unit-tests-only",
    }
    # Preserva vars reais se já existirem (ex.: CI com DB real configurado).
    previous = {k: os.environ.get(k) for k in required}
    for k, v in required.items():
        if k not in os.environ:
            os.environ[k] = v

    # Limpa o cache do lru_cache para que get_settings() carregue as vars acima.
    try:
        from app.config import get_settings
        get_settings.cache_clear()
    except Exception:
        pass

    yield

    # Restaura estado original.
    for k, v in previous.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v
    try:
        from app.config import get_settings
        get_settings.cache_clear()
    except Exception:
        pass


@pytest.fixture(scope="session")
def event_loop_policy():
    return asyncio.DefaultEventLoopPolicy()
