"""Testes da redação de PII brasileiras."""

from __future__ import annotations

from app.observability import redact_pii


def test_redacts_cpf():
    assert "[CPF_REDACTED]" in redact_pii("Meu CPF é 123.456.789-00.")


def test_redacts_cpf_sem_pontuacao():
    assert "[CPF_REDACTED]" in redact_pii("CPF 12345678900")


def test_redacts_email():
    assert "[EMAIL_REDACTED]" in redact_pii("Meu email é joao@example.com")


def test_redacts_phone_br():
    assert "[PHONE_REDACTED]" in redact_pii("Liga pra mim 21 99999-8888")


def test_redacts_date():
    assert "[DATE_REDACTED]" in redact_pii("Nasci em 12/05/1990")


def test_preserves_non_pii():
    assert redact_pii("Estou cansado hoje") == "Estou cansado hoje"


def test_handles_empty_string():
    assert redact_pii("") == ""
