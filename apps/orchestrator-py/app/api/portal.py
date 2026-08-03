"""Endpoint do portal do paciente.

`POST /internal/portal/conversation/message`

Chamado pelo gateway .NET após autenticar o paciente via JWT/cookie e
extrair `cliente_id`. Aqui não há auth de paciente — só o token interno.

Streaming via Server-Sent Events (SSE). Cada evento do grafo é emitido
conforme acontece. Formato:

    event: node
    data: {"name":"detect_crisis","status":"started"}

    event: token
    data: {"delta":"Olá"}

    event: complete
    data: {"resposta_final":"...","crise":{...},...}

Idempotência: a tabela `inbound_messages` registra cada
(idempotency_key, cliente_id). Segunda chamada com mesma chave → 409.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.config import get_settings
from app.conversation import stream_conversation
from app.db import acquire

logger = structlog.get_logger(__name__)
router = APIRouter(prefix="/internal/portal", tags=["portal"])

# Heartbeat de transporte do SSE da conversa: comentario SSE (`: ping`) a cada N s
# enquanto o LLM processa. Inerte — EventSource ignora comentario; nao altera
# evento/conteudo, nao toca crise/auditoria/PII. Sobrevive a proxy/LB/CloudFront que
# derrubam SSE ocioso (>60s sem byte).
_SSE_HEARTBEAT_SECS = 20


# ─── Auth ──────────────────────────────────────────────────────────────────


def _check_internal_token(authorization: str | None = Header(None)) -> None:
    settings = get_settings()
    expected = f"Bearer {settings.internal_api_token.get_secret_value()}"
    if authorization != expected:
        raise HTTPException(status_code=401, detail="invalid internal token")


# ─── Payload ───────────────────────────────────────────────────────────────


class PortalMessageRequest(BaseModel):
    paciente_id: UUID = Field(
        ..., description="UUID em clientes.id; gateway resolve do JWT do paciente."
    )
    mensagem: str = Field(..., min_length=1, max_length=4000)
    idempotency_key: str = Field(
        ...,
        min_length=8,
        max_length=128,
        description="UUID v4 ou hash gerado no cliente. Mesma chave = mesma "
        "mensagem; retentativas devem reusar a chave.",
    )
    canal: str = Field(default="pwa", pattern=r"^(pwa|whatsapp)$")


# ─── Dedup / status ────────────────────────────────────────────────────────


async def _claim_message(req: PortalMessageRequest) -> None:
    """Reserva a mensagem para processamento.

    Insere com ON CONFLICT DO NOTHING. Se já existe, sobe 409 com info do
    status anterior — o cliente decide se faz polling ou desiste.
    """
    async with acquire() as conn:
        inserted = await conn.fetchval(
            """
            INSERT INTO inbound_messages
                (idempotency_key, cliente_id, canal, status)
            VALUES ($1, $2, $3, 'in_progress')
            ON CONFLICT (idempotency_key) DO NOTHING
            RETURNING idempotency_key
            """,
            req.idempotency_key,
            req.paciente_id,
            req.canal,
        )
        if inserted is None:
            existing = await conn.fetchrow(
                """
                SELECT status, criada_em, completada_em
                FROM inbound_messages WHERE idempotency_key = $1
                """,
                req.idempotency_key,
            )
            raise HTTPException(
                status_code=409,
                detail={
                    "error": "duplicate_idempotency_key",
                    "status": existing["status"] if existing else "unknown",
                },
            )


async def _mark_status(idempotency_key: str, status: str) -> None:
    async with acquire() as conn:
        await conn.execute(
            """
            UPDATE inbound_messages
            SET status = $1,
                completada_em = CASE
                    WHEN $1 IN ('completed', 'failed') THEN NOW()
                    ELSE completada_em
                END
            WHERE idempotency_key = $2
            """,
            status,
            idempotency_key,
        )


# ─── SSE helpers ───────────────────────────────────────────────────────────


def _sse_format(event: str, data: dict) -> bytes:
    """Formato bruto SSE: `event: NAME\\ndata: JSON\\n\\n`."""
    payload = json.dumps(data, ensure_ascii=False, default=str)
    return f"event: {event}\ndata: {payload}\n\n".encode()


# ─── Endpoint ──────────────────────────────────────────────────────────────


@router.post(
    "/conversation/message",
    dependencies=[Depends(_check_internal_token)],
)
async def portal_conversation_message(req: PortalMessageRequest):
    await _claim_message(req)

    # Padrao queue+task de proposito: o `wait_for` so expira no queue.get, nunca
    # cancela o passo em-voo do grafo (cancelar __anext__ corromperia o stream do
    # LangGraph). Heartbeat (`: ping`) emitido nos gaps. Ver _SSE_HEARTBEAT_SECS.
    async def event_generator():
        final_status = "failed"
        queue: asyncio.Queue = asyncio.Queue()

        async def _pump():
            try:
                async for ev in stream_conversation(
                    paciente_id=req.paciente_id,
                    mensagem=req.mensagem,
                    idempotency_key=req.idempotency_key,
                    canal=req.canal,
                ):
                    await queue.put(("event", ev))
            except Exception as exc:  # pragma: no cover
                await queue.put(("exc", exc))
            finally:
                await queue.put(("done", None))

        pump_task = asyncio.create_task(_pump())
        try:
            while True:
                try:
                    kind, payload = await asyncio.wait_for(
                        queue.get(), timeout=_SSE_HEARTBEAT_SECS
                    )
                except TimeoutError:
                    yield ": ping\n\n"  # keepalive inerte; sem dado/PII
                    continue
                if kind == "event":
                    ev = payload
                    yield _sse_format(ev["event"], ev["data"])
                    if ev["event"] == "complete":
                        final_status = "completed"
                    elif ev["event"] == "error":
                        final_status = "failed"
                elif kind == "exc":
                    raise payload
                else:  # done
                    break
        except Exception as exc:  # pragma: no cover
            logger.exception(
                "portal.stream.failed",
                error=str(exc),
                error_type=exc.__class__.__name__,
            )
            yield _sse_format(
                "error",
                {
                    "message": (
                        "Tive um probleminha para responder agora. Sua "
                        "mensagem foi registrada e sua psiquiatra pode ser "
                        "avisada se precisar. Pode tentar de novo daqui a pouco."
                    )
                },
            )
            final_status = "failed"
        finally:
            pump_task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await pump_task
            await _mark_status(req.idempotency_key, final_status)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # respeita nginx/proxies
        },
    )
