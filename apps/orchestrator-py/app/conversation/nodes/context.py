"""Nó load_context: carrega contexto e materializa side effects iniciais.

Faz, NESTA ORDEM (uma transação):
* JOIN clientes+pacientes → nome, medico_responsavel_id, automacao_pausada
* find-or-create conversa aberta (status='aberta' ou 'humano')
* INSERT mensagens (papel='user', conversa_id, conteudo) → mensagem_db_id
* SELECT prescricoes ativas
* SELECT último check-in tipo='medicacao' pendente

Idempotência: o webhook já deduplica WhatsApp via `whatsapp_inbound_dedup`.
A inserção de `mensagens` aqui é nova a cada chamada do grafo, mas o
checkpointer do LangGraph dedup-a chamadas com o mesmo thread_id.
"""

from __future__ import annotations

import structlog

from app.config import get_settings
from app.conversation.state import ConversaState
from app.core.crypto import encrypt
from app.db import acquire

logger = structlog.get_logger(__name__)


async def load_context(state: ConversaState) -> dict:
    paciente_id = state["paciente_id"]

    async with acquire() as conn, conn.transaction():
        # JOIN clientes + pacientes
        row = await conn.fetchrow(
            """
            SELECT
                c.nome,
                p.medico_responsavel_id,
                p.automacao_pausada
            FROM clientes c
            JOIN pacientes p ON p.cliente_id = c.id
            WHERE c.id = $1
            """,
            paciente_id,
        )

        if row is None:
            # Sem pacientes vinculado a esse cliente. Não engaja automação.
            logger.error("context.paciente_not_found", paciente_id=str(paciente_id))
            return {
                "nome_paciente": "",
                "medico_responsavel_id": None,
                "automacao_pausada": True,
                "conversa_status": "encerrada",
                "prescricoes_ativas": [],
                "checkin_pendente": None,
            }

        # Conversa aberta (ou em handover humano)
        conversa_row = await conn.fetchrow(
            """
            SELECT id, status FROM conversas
            WHERE cliente_id = $1 AND status IN ('aberta', 'humano')
            ORDER BY criada_em DESC
            LIMIT 1
            """,
            paciente_id,
        )
        if conversa_row is None:
            conversa_id = await conn.fetchval(
                """
                INSERT INTO conversas (cliente_id, status)
                VALUES ($1, 'aberta')
                RETURNING id
                """,
                paciente_id,
            )
            conversa_status = "aberta"
        else:
            conversa_id = conversa_row["id"]
            conversa_status = conversa_row["status"]

        # Mensagem do paciente vai persistida sempre — mesmo se escalada,
        # médico precisa ver
        key = get_settings().encryption_key
        key_str = key.get_secret_value() if key else None
        mensagem_db_id = await conn.fetchval(
            """
            INSERT INTO mensagens (conversa_id, papel, conteudo)
            VALUES ($1, 'user', $2)
            RETURNING id
            """,
            conversa_id,
            encrypt(state["mensagem"], key_str),
        )

        # Prescrições ativas (resumo leve)
        prescricoes_rows = await conn.fetch(
            """
            SELECT id, medicamento, dose_descricao, horarios
            FROM prescricoes
            WHERE paciente_id = $1 AND ativa = TRUE
            ORDER BY criada_em DESC
            """,
            paciente_id,
        )
        prescricoes_ativas = [
            {
                "id": str(p["id"]),
                "medicamento": p["medicamento"],
                "dose_descricao": p["dose_descricao"],
                "horarios": [str(h) for h in p["horarios"]],
            }
            for p in prescricoes_rows
        ]

        # Último check-in pendente tipo medicação nas últimas 24h
        checkin_row = await conn.fetchrow(
            """
            SELECT id, payload, agendado_para, enviado_em
            FROM checkins
            WHERE paciente_id = $1
              AND tipo = 'medicacao'
              AND respondido_em IS NULL
              AND expirado_em IS NULL
              AND enviado_em IS NOT NULL
              AND enviado_em > NOW() - INTERVAL '24 hours'
            ORDER BY agendado_para DESC
            LIMIT 1
            """,
            paciente_id,
        )
        checkin_pendente = (
            {
                "id": str(checkin_row["id"]),
                "payload": dict(checkin_row["payload"]) if checkin_row["payload"] else {},
                "agendado_para": checkin_row["agendado_para"].isoformat(),
            }
            if checkin_row
            else None
        )

    logger.info(
        "context.loaded",
        paciente_id=str(paciente_id),
        conversa_id=str(conversa_id),
        conversa_status=conversa_status,
        automacao_pausada=row["automacao_pausada"],
        prescricoes_ativas=len(prescricoes_ativas),
        tem_checkin_pendente=bool(checkin_pendente),
    )

    return {
        "nome_paciente": row["nome"] or "",
        "medico_responsavel_id": row["medico_responsavel_id"],
        "automacao_pausada": row["automacao_pausada"],
        "conversa_id": conversa_id,
        "conversa_status": conversa_status,
        "mensagem_db_id": mensagem_db_id,
        "prescricoes_ativas": prescricoes_ativas,
        "checkin_pendente": checkin_pendente,
    }
