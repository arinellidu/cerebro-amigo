"""Testes do structlog processor de redação de PII.

O processor `redact_pii_processor` é a defesa em profundidade que protege os
logs de aplicação (structlog/stdout) mesmo que um desenvolvedor futuro logue
conteúdo clínico ou dados de identificação sem redigir manualmente.
"""

from __future__ import annotations

from app.observability import redact_pii_processor


def test_processor_redacts_cpf_in_event_dict():
    event = {"event": "msg", "mensagem": "Meu CPF é 123.456.789-00"}
    result = redact_pii_processor(None, "info", event)
    assert "[CPF_REDACTED]" in result["mensagem"]


def test_processor_redacts_email_in_nested_dict():
    event = {"event": "login", "user": {"email": "joao@example.com"}}
    result = redact_pii_processor(None, "info", event)
    assert result["user"]["email"] == "[EMAIL_REDACTED]"


def test_processor_redacts_phone_in_list():
    # números formatados (com separadores) — CPF regex não alcança estes
    event = {"phones": ["21 99999-8888", "(11) 98888-7777"]}
    result = redact_pii_processor(None, "info", event)
    assert all("[PHONE_REDACTED]" in p for p in result["phones"])


def test_processor_preserves_non_pii():
    event = {"event": "heartbeat", "status": "ok", "count": 42}
    result = redact_pii_processor(None, "info", event)
    assert result == event


def test_processor_preserves_event_key_but_redacts_pii_in_it():
    event = {"event": "user said: liga pra mim 21 99999-8888"}
    result = redact_pii_processor(None, "info", event)
    assert "[PHONE_REDACTED]" in result["event"]
