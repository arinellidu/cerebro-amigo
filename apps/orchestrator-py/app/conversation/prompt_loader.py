"""Carregamento dinâmico de prompts com cache TTL + fallback para builtin.

Editor de prompts (Tier 4.2): os prompts não são mais hardcoded — são lidos
 da tabela `prompts` do Postgres. Cada nó do grafo chama `get_prompt(agente, nome)`
 em vez de importar a constante diretamente.

Cache: TTL de 60 segundos para evitar query a cada mensagem. Em dev, o cache
 é pequeno; em prod, pode ser aumentado (prompts mudam raramente).

Fallback: se não houver prompt ativo no banco, usa o builtin (hardcoded em
 `prompts.py`). Isso garante que o sistema funcione mesmo que a migration 0009
 ainda não tenha sido aplicada ou que nenhum prompt tenha sido editado.
"""

from __future__ import annotations

import time

import asyncpg
import structlog

from app.conversation import prompts as builtin
from app.db import acquire

logger = structlog.get_logger(__name__)

# Cache in-memory: chave → (conteúdo, timestamp)
_cache: dict[str, tuple[str, float]] = {}
_CACHE_TTL_SECONDS = 60

# Mapeamento de (agente, nome) → constante builtin
_BUILTIN_MAP: dict[tuple[str, str], str] = {
    ("orchestrator", "crisis_detection"): builtin.CRISIS_DETECTION_SYSTEM_V1,
    ("orchestrator", "medication_classification"): builtin.MEDICATION_CLASSIFICATION_SYSTEM_V1,
    ("orchestrator", "symptom_extraction"): builtin.SYMPTOM_EXTRACTION_SYSTEM_V1,
    ("orchestrator", "response_generation"): builtin.RESPONSE_GENERATION_SYSTEM_V1,
    ("orchestrator", "audit"): builtin.AUDIT_SYSTEM_V1,
}


def _cache_key(agente: str, nome: str) -> str:
    return f"{agente}:{nome}"


def _get_cached(agente: str, nome: str) -> str | None:
    key = _cache_key(agente, nome)
    now = time.monotonic()
    entry = _cache.get(key)
    if entry is None:
        return None
    conteudo, ts = entry
    if now - ts > _CACHE_TTL_SECONDS:
        _cache.pop(key, None)
        return None
    return conteudo


def _set_cached(agente: str, nome: str, conteudo: str) -> None:
    _cache[_cache_key(agente, nome)] = (conteudo, time.monotonic())


async def _fetch_from_db(agente: str, nome: str) -> str | None:
    """Busca o prompt ativo do banco. Retorna None se não houver — seja por
    não existir linha ativa, seja porque a tabela ``prompts`` ainda não foi
    criada (migration 0009 não aplicada). Nos dois casos o builtin assume,
    como promete o docstring do módulo — inclusive o prompt pré-aprovado de
    detecção de crise (``CRISIS_DETECTION_SYSTEM_V1``). A ausência de schema é
    logada (observável) para não mascarar uma migration faltante.
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


async def get_prompt(agente: str, nome: str) -> str:
    """Retorna o prompt ativo para (agente, nome), com cache e fallback builtin.

    Ordem de resolução:
      1. Cache in-memory (TTL 60s)
      2. Banco de dados (tabela `prompts`)
      3. Builtin hardcoded (migration ainda não aplicada ou nenhum prompt editado)
    """
    cached = _get_cached(agente, nome)
    if cached is not None:
        return cached

    db_prompt = await _fetch_from_db(agente, nome)
    if db_prompt is not None:
        _set_cached(agente, nome, db_prompt)
        return db_prompt

    fallback = _BUILTIN_MAP.get((agente, nome))
    if fallback is not None:
        # Não cacheia o builtin — se alguém criar um prompt no banco, queremos
        # pegar na próxima request (depois do TTL ou quando o cache limpar).
        return fallback

    raise KeyError(f"Prompt desconhecido: agente={agente!r}, nome={nome!r}")


def invalidate_cache(agente: str | None = None, nome: str | None = None) -> None:
    """Invalida o cache de prompts. Útil após edição via dashboard.

    Se agente e nome forem None, limpa TODO o cache.
    """
    global _cache
    if agente is None and nome is None:
        _cache.clear()
        return

    key = _cache_key(agente or "", nome or "")
    # Se só um dos dois for fornecido, remove todas as chaves que combinam
    if agente and nome:
        _cache.pop(key, None)
    elif agente:
        for k in list(_cache.keys()):
            if k.startswith(f"{agente}:"):
                _cache.pop(k, None)
    elif nome:
        for k in list(_cache.keys()):
            if k.endswith(f":{nome}"):
                _cache.pop(k, None)
