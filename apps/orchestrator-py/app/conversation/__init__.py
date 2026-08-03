"""Camada de conversa.

API pública:

    from app.conversation import process_message, stream_conversation

    # Síncrono (para testes/eval, modo internal)
    state = await process_message(
        paciente_id=..., mensagem=..., idempotency_key=..., canal="pwa"
    )

    # Streaming (para endpoint SSE da PWA)
    async for event in stream_conversation(
        paciente_id=..., mensagem=..., idempotency_key=..., canal="pwa"
    ):
        ...  # event é um dict pronto para serialização SSE
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from typing import Any
from uuid import UUID

import structlog

from app.conversation.graph import get_compiled_app
from app.conversation.state import ConversaState
from app.conversation.streaming import translate_events

logger = structlog.get_logger(__name__)


def _thread_id(paciente_id: UUID, idempotency_key: str) -> str:
    """Idempotência via checkpointer do LangGraph."""
    return f"{paciente_id}:{idempotency_key}"


def _initial_state(
    paciente_id: UUID, mensagem: str, idempotency_key: str, canal: str, trace_id: str
) -> ConversaState:
    return {  # type: ignore[return-value]
        "paciente_id": paciente_id,
        "idempotency_key": idempotency_key,
        "mensagem": mensagem,
        "canal": canal,  # type: ignore[typeddict-item]
        "trace_id": trace_id,
        "retry_count": 0,
        "enviado": False,
    }


def _config(paciente_id: UUID, idempotency_key: str, canal: str, trace_id: str) -> dict:
    return {
        "configurable": {"thread_id": _thread_id(paciente_id, idempotency_key)},
        "metadata": {
            "paciente_id": str(paciente_id),
            "canal": canal,
            "trace_id": trace_id,
        },
        "tags": ["cerebro-amigo", "conversation", canal],
    }


async def process_message(
    *,
    paciente_id: UUID,
    mensagem: str,
    idempotency_key: str,
    canal: str = "pwa",
) -> dict[str, Any]:
    """Roda o grafo sem streaming. Retorna o estado final completo."""
    app = await get_compiled_app()
    trace_id = str(uuid.uuid4())

    initial = _initial_state(paciente_id, mensagem, idempotency_key, canal, trace_id)
    config = _config(paciente_id, idempotency_key, canal, trace_id)

    logger.info(
        "conversation.start",
        paciente_id=str(paciente_id),
        trace_id=trace_id,
        idempotency_key=idempotency_key,
    )

    final_state = await app.ainvoke(initial, config=config)

    logger.info(
        "conversation.done",
        paciente_id=str(paciente_id),
        trace_id=trace_id,
        enviado=final_state.get("enviado"),
        crise=final_state.get("crise", {}).get("detectada"),
        conversa_status=final_state.get("conversa_status"),
    )

    return final_state


async def stream_conversation(
    *,
    paciente_id: UUID,
    mensagem: str,
    idempotency_key: str,
    canal: str = "pwa",
) -> AsyncIterator[dict[str, Any]]:
    """Streaming de eventos do grafo, prontos para serialização SSE.

    Yields dicts com formato:
        {"event": "node",     "data": {"name": "...", "status": "started"|"completed", ...}}
        {"event": "token",    "data": {"delta": "..."}}
        {"event": "complete", "data": {<final_state>}}
        {"event": "error",    "data": {"message": "..."}}

    O endpoint HTTP transforma cada dict no formato SSE bruto:
        event: <event>\\ndata: <json>\\n\\n
    """
    app = await get_compiled_app()
    trace_id = str(uuid.uuid4())

    initial = _initial_state(paciente_id, mensagem, idempotency_key, canal, trace_id)
    config = _config(paciente_id, idempotency_key, canal, trace_id)

    logger.info(
        "conversation.stream.start",
        paciente_id=str(paciente_id),
        trace_id=trace_id,
        idempotency_key=idempotency_key,
    )

    try:
        raw_events = app.astream_events(initial, config=config, version="v2")
        async for event in translate_events(raw_events):
            yield event
    except Exception as exc:  # pragma: no cover
        logger.exception("conversation.stream.failed", error=str(exc))
        yield {
            "event": "error",
            "data": {"message": "Erro interno ao processar a mensagem", "trace_id": trace_id},
        }

    logger.info(
        "conversation.stream.done",
        paciente_id=str(paciente_id),
        trace_id=trace_id,
    )
