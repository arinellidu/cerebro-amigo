"""Tradutor de eventos do LangGraph em eventos SSE limpos para a PWA.

`app.astream_events(version='v2')` emite eventos granulares:
* `on_chain_start` / `on_chain_end` para cada nó
* `on_chat_model_start` / `on_chat_model_stream` / `on_chat_model_end` para
  cada chamada Claude
* `on_chain_end` final do grafo "LangGraph" com o estado final no `data.output`

Aqui filtramos só o que interessa pra UI e emitimos:
* `node`: começo/fim de cada nó com status e dados resumidos
* `token`: deltas de texto SOMENTE durante `generate_response` (único nó cuja
  saída é texto livre apresentável; demais nós usam structured output)
* `complete`: estado final do grafo
* `error`: falha não tratada
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any
from uuid import UUID

# Nós do grafo cujo start/end queremos expor à UI
_NODE_NAMES = frozenset(
    {
        "load_context",
        "detect_crisis",
        "crisis_protocol",
        "classify_medication",
        "update_medication_intake",
        "medication_acknowledgment",
        "extract_symptoms",
        "generate_response",
        "audit_response",
        "escalate_to_human",
        "finalize",
    }
)

# Apenas o generate_response gera texto livre que vale streamear ao paciente.
# Os outros nós (detect_crisis, classify_medication etc.) usam
# `with_structured_output` — chunks de tool-call não fazem sentido na UI.
_STREAMABLE_NODE = "generate_response"


def _json_default(obj: Any) -> Any:
    if isinstance(obj, UUID):
        return str(obj)
    if hasattr(obj, "isoformat"):
        return obj.isoformat()
    return str(obj)


def _serializable(value: Any) -> Any:
    """Tenta deixar o valor serializável por json.dumps; fallback para repr."""
    try:
        json.dumps(value, default=_json_default)
        return value
    except (TypeError, ValueError):
        return str(value)


def _summary_for_node(node_name: str, output: dict[str, Any]) -> dict[str, Any]:
    """Resumo do que o nó produziu, sem vazar PII em campos de UI.

    Só campos que a UI precisa mostrar. Estado completo vai no `complete`.
    """
    if node_name == "load_context":
        return {
            "conversa_id": _serializable(output.get("conversa_id")),
            "conversa_status": output.get("conversa_status"),
            "automacao_pausada": output.get("automacao_pausada"),
            "tem_checkin_pendente": bool(output.get("checkin_pendente")),
        }
    if node_name == "detect_crisis":
        crise = output.get("crise") or {}
        return {
            "detectada": crise.get("detectada"),
            "nivel": crise.get("nivel"),
            "confianca": crise.get("confianca"),
        }
    if node_name == "classify_medication":
        med = output.get("medicacao") or {}
        return {
            "eh_resposta": med.get("eh_resposta"),
            "status": med.get("status"),
        }
    if node_name == "extract_symptoms":
        return {"has_sintomas": output.get("sintomas") is not None}
    if node_name == "audit_response":
        audit = output.get("audit") or {}
        return {
            "decisao": audit.get("decisao"),
            "motivo": audit.get("motivo"),
        }
    if node_name == "crisis_protocol":
        return {"acionado": True}
    if node_name == "escalate_to_human":
        return {"escalado": True}
    if node_name == "finalize":
        return {"enviado": output.get("enviado")}
    return {}


def _final_state_payload(state: dict[str, Any]) -> dict[str, Any]:
    """Compacta o estado final do grafo num payload seguro para o cliente."""
    return {
        "conversa_id": _serializable(state.get("conversa_id")),
        "conversa_status": state.get("conversa_status"),
        "resposta_final": state.get("resposta_final"),
        "enviado": state.get("enviado"),
        "crise": state.get("crise"),
        "medicacao": state.get("medicacao"),
        "sintomas": state.get("sintomas"),
        "audit": state.get("audit"),
        "trace_id": state.get("trace_id"),
    }


async def translate_events(
    raw_events: AsyncIterator[dict[str, Any]],
) -> AsyncIterator[dict[str, Any]]:
    """Consome eventos brutos do LangGraph e emite eventos SSE-friendly."""
    async for ev in raw_events:
        kind = ev.get("event", "")
        name = ev.get("name", "")
        data = ev.get("data", {}) or {}
        # tags não usado; guardado aqui para referência futura

        # ─── Eventos de nó ──────────────────────────────────────────────
        if kind == "on_chain_start" and name in _NODE_NAMES:
            yield {
                "event": "node",
                "data": {"name": name, "status": "started"},
            }
            continue

        if kind == "on_chain_end" and name in _NODE_NAMES:
            output = data.get("output", {}) or {}
            if not isinstance(output, dict):
                output = {}
            yield {
                "event": "node",
                "data": {
                    "name": name,
                    "status": "completed",
                    "summary": _summary_for_node(name, output),
                },
            }
            continue

        # ─── Streaming de tokens (apenas no generate_response) ──────────
        if kind == "on_chat_model_stream":
            # LangGraph injeta `langgraph_node` no metadata de eventos de
            # chat model que ocorrem dentro de um nó. Mais confiável que
            # tags (que podem variar entre versões do LangChain).
            metadata = ev.get("metadata", {}) or {}
            if metadata.get("langgraph_node") != _STREAMABLE_NODE:
                continue
            chunk = data.get("chunk")
            if chunk is None:
                continue
            content = getattr(chunk, "content", None)
            if not content:
                continue
            # Bedrock stream envia content como string ou lista de blocos
            delta = content if isinstance(content, str) else "".join(
                part.get("text", "") if isinstance(part, dict) else str(part)
                for part in content
            )
            if delta:
                yield {"event": "token", "data": {"delta": delta}}
            continue

        # ─── Fim do grafo ───────────────────────────────────────────────
        # O evento on_chain_end com name="LangGraph" carrega o estado final.
        if kind == "on_chain_end" and name == "LangGraph":
            output = data.get("output", {}) or {}
            if isinstance(output, dict):
                yield {
                    "event": "complete",
                    "data": _final_state_payload(output),
                }
            continue
