"""Extração estruturada de sintomas.

Persiste UM snapshot por mensagem na tabela `sintomas`, alinhado às colunas
fixas (humor, ansiedade, sono_horas, sono_qualidade, energia, apetite,
irritabilidade, nota). Pula INSERT se o LLM não detectou nada.
"""

from __future__ import annotations

import structlog
from langchain_core.messages import HumanMessage, SystemMessage

from app.conversation.llm import sonnet, with_schema
from app.conversation.prompt_loader import get_prompt
from app.conversation.schemas import SymptomExtractionOutput
from app.conversation.state import ConversaState
from app.db import acquire

logger = structlog.get_logger(__name__)


async def extract_symptoms(state: ConversaState) -> dict:
    llm = with_schema(sonnet(temperature=0.0), SymptomExtractionOutput)

    try:
        result: SymptomExtractionOutput = await llm.ainvoke(
            [
                SystemMessage(content=await get_prompt("orchestrator", "symptom_extraction")),
                HumanMessage(content=state["mensagem"]),
            ]
        )
    except Exception as exc:  # pragma: no cover
        logger.exception("symptoms.extract.failed", error=str(exc))
        return {"sintomas": None}

    if not result.has_any_signal():
        logger.info("symptoms.extract.no_signal")
        return {"sintomas": None}

    async with acquire() as conn:
        await conn.execute(
            """
            INSERT INTO sintomas
                (paciente_id, humor, ansiedade, sono_horas, sono_qualidade,
                 energia, apetite, irritabilidade, nota)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            """,
            state["paciente_id"],
            result.humor,
            result.ansiedade,
            result.sono_horas,
            result.sono_qualidade,
            result.energia,
            result.apetite,
            result.irritabilidade,
            result.nota,
        )

    logger.info(
        "symptoms.extract.done",
        humor=result.humor,
        ansiedade=result.ansiedade,
        sono_horas=result.sono_horas,
    )

    return {"sintomas": result.model_dump()}
