"""Testes do structlog processor de redação de PII (notifier-py)."""

from __future__ import annotations

from app.core.observability import redact_pii_processor


def test_processor_redacts_cpf_in_event_dict():
    event = {"event": "msg", "mensagem": "Meu CPF é 123.456.789-00"}
    result = redact_pii_processor(None, "info", event)
    assert "[CPF_REDACTED]" in result["mensagem"]


def test_processor_redacts_email_in_nested_dict():
    event = {"event": "login", "user": {"email": "joao@example.com"}}
    result = redact_pii_processor(None, "info", event)
    assert result["user"]["email"] == "[EMAIL_REDACTED]"


def test_processor_preserves_non_pii():
    event = {"event": "heartbeat", "status": "ok", "count": 42}
    result = redact_pii_processor(None, "info", event)
    assert result == event
