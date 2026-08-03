"""Carregamento dinâmico de prompts com cache TTL + fallback para builtin (T4-1).

Espelho do ``prompt_loader.py`` do orchestrator-py: os agentes analíticos leem
o prompt ativo da tabela ``prompts`` (editado no painel, convenção
``agents:<nome>``) em vez da constante hardcoded. Sem linha no banco, o builtin
de cada agente vale — comportamento idêntico ao anterior.

O builtin é resolvido por import tardio (os módulos dos agentes importam este
loader; importar de volta no topo criaria ciclo).
"""

from __future__ import annotations

import importlib
import time

import asyncpg
import structlog

from app.core.db import acquire

logger = structlog.get_logger(__name__)

# Cache in-memory: chave → (conteúdo, timestamp)
_cache: dict[str, tuple[str, float]] = {}
_CACHE_TTL_SECONDS = 60

# (agente, nome) → (módulo, constante builtin) — import tardio, sem ciclo.
_BUILTIN_MAP: dict[tuple[str, str], tuple[str, str]] = {
    ("agents", "adesao"): ("app.agents.adesao", "ADESAO_SYSTEM_V1"),
    ("agents", "diario"): ("app.agents.diario", "DIARIO_SYSTEM_V1"),
    ("agents", "padroes"): ("app.agents.padroes", "PADROES_SYSTEM_V1"),
    ("agents", "resumidor"): ("app.agents.resumidor", "RESUMIDOR_SYSTEM_V1"),
    ("agents", "risco_silencioso"): (
        "app.agents.risco_silencioso",
        "RISCO_SILENCIOSO_SYSTEM_V1",
    ),
}


def _cache_key(agente: str, nome: str) -> str:
    return f"{agente}:{nome}"


def _get_cached(agente: str, nome: str) -> str | None:
    entry = _cache.get(_cache_key(agente, nome))
    if entry is None:
        return None
    conteudo, ts = entry
    if time.monotonic() - ts > _CACHE_TTL_SECONDS:
        _cache.pop(_cache_key(agente, nome), None)
        return None
    return conteudo


def _set_cached(agente: str, nome: str, conteudo: str) -> None:
    _cache[_cache_key(agente, nome)] = (conteudo, time.monotonic())


async def _fetch_from_db(agente: str, nome: str) -> str | None:
    """Busca o prompt ativo do banco. Retorna None se não houver — seja por
    não existir linha ativa, seja porque a tabela ``prompts`` ainda não foi
    criada (migration 0009 não aplicada). Nos dois casos o builtin assume,
    como promete o docstring do módulo. A ausência de schema é logada
    (observável, nunca silenciosa) para não mascarar uma migration faltante.
    """
    try:
        async with acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT conteudo FROM prompts
                WHERE agente = $1 AND nome = $2 AND ativo = TRUE
                LIMIT 1
                """,
                agente,
                nome,
            )
        return row["conteudo"] if row else None
    except (
        asyncpg.exceptions.UndefinedTableError,
        asyncpg.exceptions.UndefinedColumnError,
    ) as exc:
        logger.warning(
            "prompt_loader.schema_missing",
            agente=agente,
            nome=nome,
            error=str(exc),
            hint="tabela 'prompts' ausente (migration 0009) — usando builtin",
        )
        return None


def _builtin(agente: str, nome: str) -> str | None:
    ref = _BUILTIN_MAP.get((agente, nome))
    if ref is None:
        return None
    modulo, constante = ref
    return getattr(importlib.import_module(modulo), constante)


async def get_prompt(agente: str, nome: str) -> str:
    """Retorna o prompt ativo para (agente, nome), com cache e fallback builtin.

    Ordem de resolução:
      1. Cache in-memory (TTL 60s)
      2. Banco de dados (tabela ``prompts``)
      3. Builtin hardcoded (nenhum prompt editado no painel)
    """
    cached = _get_cached(agente, nome)
    if cached is not None:
        return cached

    db_prompt = await _fetch_from_db(agente, nome)
    if db_prompt is not None:
        _set_cached(agente, nome, db_prompt)
        return db_prompt

    fallback = _builtin(agente, nome)
    if fallback is not None:
        # Não cacheia o builtin — se alguém criar um prompt no banco, queremos
        # pegar na próxima request (depois do TTL ou quando o cache limpar).
        return fallback

    raise KeyError(f"Prompt desconhecido: agente={agente!r}, nome={nome!r}")


def invalidate_cache() -> None:
    """Invalida o cache de prompts (útil em teste/edição)."""
    _cache.clear()
