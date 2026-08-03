"""Nó terminal: persiste a mensagem do bot.

Não há "envio" aqui — a resposta volta para o paciente via SSE no endpoint
do portal. Este nó garante que a mensagem do bot fica no histórico
persistente em `mensagens`, com os tokens/modelo usados para billing/audit.

SHADOW_MODE: ainda persistimos a mensagem (para conferir output do grafo
contra outros sistemas), mas o `enviado` fica False para o consumidor
poder decidir não exibir/transmitir.
"""

from __future__ import annotations

import structlog

from app.config import get_settings
from app.conversation.state import ConversaState
from app.core.crypto import encrypt
from app.db import acquire

logger = structlog.get_logger(__name__)


async def finalize(state: ConversaState) -> dict:
    settings = get_settings()
    texto = state.get("resposta_final")
    if not texto:
        logger.warning("finalize.no_response")
        return {"enviado": False}

    key = settings.encryption_key
    key_str = key.get_secret_value() if key else None

    async with acquire() as conn:
        await conn.execute(
            """
            INSERT INTO mensagens
                (conversa_id, papel, conteudo, modelo_usado,
                 tokens_in, tokens_out, custo_usd)
            VALUES ($1, 'assistant', $2, $3, $4, $5, $6)
            """,
            state["conversa_id"],
            encrypt(texto, key_str),
            state.get("modelo_resposta"),
            state.get("tokens_in"),
            state.get("tokens_out"),
            state.get("custo_usd"),
        )

    logger.info(
        "finalize.persisted",
        paciente_id=str(state["paciente_id"]),
        shadow_mode=settings.shadow_mode,
        len_chars=len(texto),
    )
    return {"enviado": not settings.shadow_mode}
