"""Roteamento determinístico do grafo (sem chamar LLM)."""

from __future__ import annotations

from uuid import uuid4

from app.conversation.graph import (
    _route_after_audit,
    _route_after_context,
    _route_after_crisis,
    _route_after_medication,
)


def _base_state(**overrides) -> dict:
    state: dict = {
        "paciente_id": uuid4(),
        "medico_responsavel_id": uuid4(),
        "idempotency_key": "test-key-001",
        "mensagem": "oi",
        "canal": "pwa",
        "automacao_pausada": False,
        "conversa_status": "aberta",
        "conversa_id": uuid4(),
        "mensagem_db_id": uuid4(),
        "nome_paciente": "Teste",
        "prescricoes_ativas": [],
        "retry_count": 0,
        "enviado": False,
    }
    state.update(overrides)
    return state


# ─── load_context → ... ───
def test_context_ends_when_pausada():
    state = _base_state(automacao_pausada=True)
    assert _route_after_context(state) == "__end__"


def test_context_ends_when_conversa_humano():
    state = _base_state(conversa_status="humano")
    assert _route_after_context(state) == "__end__"


def test_context_ends_when_conversa_encerrada():
    state = _base_state(conversa_status="encerrada")
    assert _route_after_context(state) == "__end__"


def test_context_continues_when_aberta_and_active():
    state = _base_state()
    assert _route_after_context(state) == "detect_crisis"


# ─── detect_crisis → ... ───
def test_crisis_routes_to_protocol_when_detected():
    state = _base_state(
        crise={"detectada": True, "confianca": 0.9, "nivel": "alto", "gatilhos": []}
    )
    assert _route_after_crisis(state) == "crisis_protocol"


def test_crisis_routes_to_medication_when_not_detected():
    state = _base_state(
        crise={"detectada": False, "confianca": 0.1, "nivel": "nenhum", "gatilhos": []}
    )
    assert _route_after_crisis(state) == "classify_medication"


# ─── classify_medication → ... ───
def test_medication_routes_to_intake_when_response():
    state = _base_state(
        medicacao={"eh_resposta": True, "tomada_id": uuid4(), "status": "tomado",
                   "nota_paciente": None}
    )
    assert _route_after_medication(state) == "update_medication_intake"


def test_medication_routes_to_symptoms_when_general():
    state = _base_state(
        medicacao={"eh_resposta": False, "tomada_id": None, "status": None,
                   "nota_paciente": None}
    )
    assert _route_after_medication(state) == "extract_symptoms"


# ─── audit_response → ... ───
def test_audit_routes_to_finalize_on_enviar():
    state = _base_state(audit={"decisao": "enviar", "motivo": "", "flags": []})
    assert _route_after_audit(state) == "finalize"


def test_audit_routes_to_generate_on_reescrever_within_budget():
    state = _base_state(
        retry_count=0, audit={"decisao": "reescrever", "motivo": "tom", "flags": []}
    )
    assert _route_after_audit(state) == "generate_response"


def test_audit_routes_to_escalate_when_retry_budget_exhausted():
    state = _base_state(
        retry_count=99,
        audit={"decisao": "reescrever", "motivo": "tom", "flags": []},
    )
    assert _route_after_audit(state) == "escalate_to_human"


def test_audit_routes_to_escalate_on_bloquear():
    state = _base_state(
        audit={"decisao": "bloquear", "motivo": "conselho", "flags": ["dose"]}
    )
    assert _route_after_audit(state) == "escalate_to_human"
