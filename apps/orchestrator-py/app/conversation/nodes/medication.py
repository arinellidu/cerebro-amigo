"""Fluxo de medicação.

Modelo do schema real: `tomadas_medicacao` é pré-agendada pelo job de
prescrições. O `checkin` tipo='medicacao' tem em seu `payload` jsonb a
chave `tomada_id` apontando para qual linha de `tomadas_medicacao`
devemos atualizar (essa convenção precisa ser confirmada com o produtor
de check-ins no Go — ver TODO abaixo).

Quando o paciente responde:
* `classify_medication` (Haiku) — eh_resposta_medicacao + status.
* `update_medication_intake` — UPDATE em tomadas_medicacao + checkins.
* `medication_acknowledgment` — resposta-template curta (sem LLM).
"""

from __future__ import annotations

import json
from uuid import UUID

import structlog
from langchain_core.messages import HumanMessage, SystemMessage

from app.conversation.llm import haiku, with_schema
from app.conversation.prompt_loader import get_prompt
from app.conversation.schemas import MedicationResponseOutput
from app.conversation.state import ConversaState
from app.db import acquire

logger = structlog.get_logger(__name__)


def _empty_medicacao() -> dict:
    return {
        "medicacao": {
            "eh_resposta": False,
            "tomada_id": None,
            "status": None,
            "nota_paciente": None,
        }
    }


async def classify_medication(state: ConversaState) -> dict:
    checkin = state.get("checkin_pendente")
    if not checkin:
        return _empty_medicacao()

    checkin_resumo = json.dumps(
        {"agendado_para": checkin["agendado_para"], "payload": checkin["payload"]},
        ensure_ascii=False,
    )
    prescricoes_resumo = json.dumps(
        [
            {"medicamento": p["medicamento"], "dose": p["dose_descricao"]}
            for p in state.get("prescricoes_ativas", [])
        ],
        ensure_ascii=False,
    )

    system = (await get_prompt("orchestrator", "medication_classification")).format(
        checkin_resumo=checkin_resumo,
        prescricoes_resumo=prescricoes_resumo,
    )
    llm = with_schema(haiku(), MedicationResponseOutput)

    try:
        result: MedicationResponseOutput = await llm.ainvoke(
            [SystemMessage(content=system), HumanMessage(content=state["mensagem"])]
        )
    except Exception as exc:  # pragma: no cover
        logger.exception("medication.classify.failed", error=str(exc))
        return _empty_medicacao()

    # TODO: convenção de payload do checkin precisa ser confirmada
    # com o emissor Go. Assumindo `payload.tomada_id` ou `payload.tomada`.
    tomada_id_raw = checkin["payload"].get("tomada_id") or checkin["payload"].get("tomada")
    tomada_id: UUID | None
    try:
        tomada_id = UUID(tomada_id_raw) if tomada_id_raw else None
    except (TypeError, ValueError):
        tomada_id = None
        logger.warning(
            "medication.classify.invalid_tomada_id",
            payload_keys=list(checkin["payload"].keys()),
        )

    logger.info(
        "medication.classify.done",
        eh_resposta=result.eh_resposta_medicacao,
        status=result.status,
        tomada_resolved=bool(tomada_id),
    )

    return {
        "medicacao": {
            "eh_resposta": result.eh_resposta_medicacao,
            "tomada_id": tomada_id,
            "status": result.status,
            "nota_paciente": result.nota_paciente,
        }
    }


async def update_medication_intake(state: ConversaState) -> dict:
    med = state["medicacao"]
    checkin = state.get("checkin_pendente") or {}
    checkin_id = checkin.get("id")
    tomada_id = med.get("tomada_id")
    status = med.get("status") or "outro"

    async with acquire() as conn, conn.transaction():
        # Marca o check-in como respondido (sempre, mesmo se tomada_id ausente)
        if checkin_id:
            resposta_jsonb = json.dumps(
                {"status": status, "nota": med.get("nota_paciente")},
                ensure_ascii=False,
            )
            await conn.execute(
                """
                UPDATE checkins
                SET respondido_em = NOW(), resposta = $1::jsonb
                WHERE id = $2
                """,
                resposta_jsonb,
                UUID(checkin_id),
            )

        # Atualiza a tomada (se tivermos o ID)
        if tomada_id:
            await conn.execute(
                """
                UPDATE tomadas_medicacao
                SET status = $1,
                    horario_real = NOW(),
                    nota_paciente = COALESCE($2, nota_paciente)
                WHERE id = $3
                """,
                status,
                med.get("nota_paciente"),
                tomada_id,
            )

    logger.info(
        "medication.intake.updated",
        checkin_id=checkin_id,
        tomada_id=str(tomada_id) if tomada_id else None,
        status=status,
    )
    return {}


def _ack_text(status: str | None) -> str:
    if status == "tomado":
        return "Anotado, obrigado por confirmar."
    if status == "esquecido":
        return "Anotado. Vou avisar sua psiquiatra."
    if status == "atrasado":
        return "Anotado, obrigado por avisar."
    return "Anotei sua resposta. Sua psiquiatra recebe esses registros."


async def medication_acknowledgment(state: ConversaState) -> dict:
    return {"resposta_final": _ack_text(state["medicacao"].get("status"))}
