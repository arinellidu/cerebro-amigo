"""prompt_loader do orchestrator — DB > builtin, resiliente a schema ausente.

Cobre a promessa do docstring: o sistema funciona mesmo que a migration 0009
(tabela ``prompts``) ainda não tenha sido aplicada. Sem esse fallback, o
``UndefinedTableError`` vazaria e — no caminho de crise — forçaria o fail-safe
a tratar TODA mensagem como crise (inundação de alertas). Determinístico, sem
I/O real.
"""

from __future__ import annotations

import asyncpg
import pytest

from app.conversation import prompt_loader
from app.conversation.prompt_loader import get_prompt, invalidate_cache


def _sem_db(monkeypatch):
    async def none_db(_agente: str, _nome: str) -> None:
        return None

    monkeypatch.setattr(prompt_loader, "_fetch_from_db", none_db)


async def test_fallback_builtin_sem_linha_no_banco(monkeypatch):
    _sem_db(monkeypatch)
    invalidate_cache()

    out = await get_prompt("orchestrator", "crisis_detection")

    from app.conversation.prompts import CRISIS_DETECTION_SYSTEM_V1

    assert out == CRISIS_DETECTION_SYSTEM_V1


class _FakeConnTabelaAusente:
    async def fetchrow(self, *args, **kwargs):
        raise asyncpg.exceptions.UndefinedTableError(
            'relation "prompts" does not exist'
        )


class _FakeAcquireTabelaAusente:
    async def __aenter__(self):
        return _FakeConnTabelaAusente()

    async def __aexit__(self, *exc):
        return False


async def test_tabela_ausente_cai_no_builtin_de_crise(monkeypatch):
    """Migration 0009 não aplicada → UndefinedTableError não pode vazar:
    o prompt PRÉ-APROVADO de detecção de crise assume, em vez de derrubar o
    nó (que só então fail-safe-inundaria toda conversa)."""
    monkeypatch.setattr(prompt_loader, "acquire", lambda: _FakeAcquireTabelaAusente())
    invalidate_cache()

    out = await get_prompt("orchestrator", "crisis_detection")

    from app.conversation.prompts import CRISIS_DETECTION_SYSTEM_V1

    assert out == CRISIS_DETECTION_SYSTEM_V1


def test_prompt_desconhecido_levanta(monkeypatch):
    import asyncio

    _sem_db(monkeypatch)
    invalidate_cache()
    with pytest.raises(KeyError):
        asyncio.run(get_prompt("orchestrator", "nao_existe"))
