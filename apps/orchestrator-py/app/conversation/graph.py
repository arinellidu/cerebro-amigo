"""Definição do grafo conversacional.

Topologia:

    START
      ↓
    load_context   (carrega clientes+pacientes, abre/reusa conversa,
      ↓             insere mensagem do paciente, lê checkin pendente)
      ↓
    [se automacao_pausada | conversa_status != 'aberta']  → END
      ↓
    detect_crisis
      ↓
    [se crise] → crisis_protocol → END
      ↓
    classify_medication
      ↓
    [se eh_resposta] → update_medication_intake →
                       medication_acknowledgment → finalize → END
      ↓
    extract_symptoms → generate_response → audit_response
                                              ↓
                              ┌─ reescrever (retry < max) → generate_response
                              ├─ enviar    → finalize → END
                              └─ bloquear | retry estourado → escalate_to_human → END
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Literal

from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from langgraph.graph import END, START, StateGraph
from psycopg_pool import AsyncConnectionPool

from app.config import get_settings
from app.conversation.nodes.context import load_context
from app.conversation.nodes.crisis import crisis_protocol, degraded_response, detect_crisis
from app.conversation.nodes.finalize import finalize
from app.conversation.nodes.medication import (
    classify_medication,
    medication_acknowledgment,
    update_medication_intake,
)
from app.conversation.nodes.response import (
    audit_response,
    escalate_to_human,
    generate_response,
)
from app.conversation.nodes.symptoms import extract_symptoms
from app.conversation.state import ConversaState
from app.db import checkpoint_dsn

# ─── Edges condicionais ────────────────────────────────────────────────────


def _route_after_context(state: ConversaState) -> Literal["detect_crisis", "__end__"]:
    if state.get("automacao_pausada") or state.get("conversa_status") != "aberta":
        return "__end__"
    return "detect_crisis"


def _route_after_crisis(
    state: ConversaState,
) -> Literal["crisis_protocol", "degraded_response", "classify_medication"]:
    if state["crise"]["detectada"]:
        return "crisis_protocol"
    if state.get("modo_degradado"):
        return "degraded_response"
    return "classify_medication"


def _route_after_medication(
    state: ConversaState,
) -> Literal["update_medication_intake", "extract_symptoms"]:
    if state["medicacao"].get("eh_resposta"):
        return "update_medication_intake"
    return "extract_symptoms"


def _route_after_audit(
    state: ConversaState,
) -> Literal["generate_response", "finalize", "escalate_to_human"]:
    audit = state["audit"]
    settings = get_settings()

    if audit["decisao"] == "bloquear":
        return "escalate_to_human"
    if audit["decisao"] == "reescrever":
        if state.get("retry_count", 0) > settings.max_retry_audit:
            return "escalate_to_human"
        return "generate_response"
    return "finalize"


# ─── Construção ────────────────────────────────────────────────────────────


def build_graph() -> StateGraph:
    g: StateGraph = StateGraph(ConversaState)

    g.add_node("load_context", load_context)
    g.add_node("detect_crisis", detect_crisis)
    g.add_node("crisis_protocol", crisis_protocol)
    g.add_node("degraded_response", degraded_response)
    g.add_node("classify_medication", classify_medication)
    g.add_node("update_medication_intake", update_medication_intake)
    g.add_node("medication_acknowledgment", medication_acknowledgment)
    g.add_node("extract_symptoms", extract_symptoms)
    g.add_node("generate_response", generate_response)
    g.add_node("audit_response", audit_response)
    g.add_node("escalate_to_human", escalate_to_human)
    g.add_node("finalize", finalize)

    g.add_edge(START, "load_context")
    g.add_conditional_edges(
        "load_context", _route_after_context, {"detect_crisis": "detect_crisis", "__end__": END}
    )

    g.add_conditional_edges("detect_crisis", _route_after_crisis)
    g.add_edge("crisis_protocol", END)
    g.add_edge("degraded_response", END)

    g.add_conditional_edges("classify_medication", _route_after_medication)
    g.add_edge("update_medication_intake", "medication_acknowledgment")
    g.add_edge("medication_acknowledgment", "finalize")

    g.add_edge("extract_symptoms", "generate_response")
    g.add_edge("generate_response", "audit_response")
    g.add_conditional_edges("audit_response", _route_after_audit)

    g.add_edge("escalate_to_human", END)
    g.add_edge("finalize", END)

    return g


# ─── Compilação com checkpointer Postgres ──────────────────────────────────


_compiled_app = None
_pool: AsyncConnectionPool | None = None


async def get_compiled_app() -> Callable[..., Awaitable]:
    global _compiled_app, _pool
    if _compiled_app is not None:
        return _compiled_app

    _pool = AsyncConnectionPool(
        conninfo=checkpoint_dsn(),
        max_size=6,  # ADR-043 item D: orçamento de conexões (checkpointer LangGraph)
        open=False,
        kwargs={"autocommit": True, "prepare_threshold": 0},
    )
    await _pool.open()

    saver = AsyncPostgresSaver(_pool)  # type: ignore[arg-type]
    await saver.setup()

    graph = build_graph()
    _compiled_app = graph.compile(checkpointer=saver)
    return _compiled_app


async def shutdown_graph() -> None:
    global _compiled_app, _pool
    _compiled_app = None
    if _pool is not None:
        await _pool.close()
        _pool = None
