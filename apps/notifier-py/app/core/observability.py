"""Redação de PII brasileiras em logs de aplicação (structlog processor)."""

from __future__ import annotations

import os
import re
from typing import Any

_CPF_RE = re.compile(r"\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b")
_CNPJ_RE = re.compile(r"\b\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2}\b")
_EMAIL_RE = re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b")
_PHONE_RE = re.compile(
    r"(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?9?\d{4}[-\s]?\d{4}",
)
_DATE_RE = re.compile(r"\b\d{2}/\d{2}/\d{4}\b")

# ─── T0-3: heurísticas p/ campos livres (nome/endereço) — sem NER ──────────
# Sem modelo NER (spaCy pt ≈ +500 MB de imagem e RAM no t3.small). Heurísticas
# pt-BR conservadoras (preferimos falso positivo a vazar PII); defesa em
# profundidade junto do hide_inputs/outputs do LangSmith (T0-4).
_NOME = r"[A-ZÀ-Ý][a-zà-ÿ]+"
_CEP_RE = re.compile(r"\b\d{5}-\d{3}\b")
_ADDRESS_RE = re.compile(
    rf"\b(?:Rua|Avenida|Av\.|Travessa|Tv\.|Alameda|Al\.|Rodovia|Rod\.|Estrada|Estr\.|Praça|Largo)"
    rf"\s+(?:d[aeo]s?\s+)?{_NOME}(?:\s+(?:d[aeo]s?\s+)?{_NOME}){{0,5}}"
    rf"(?:,?\s*(?:nº|n[o.]?|número)\s*\d+|,\s*\d+)?"
)
_HONORIFIC_RE = re.compile(
    rf"\b(?:[Dd]r|[Dd]ra|[Ss]r|[Ss]ra|[Ss]rta|[Dd]ona|[Pp]rof|[Pp]rofa)\.?"
    rf"\s+{_NOME}(?:\s+(?:d[aeo]s?\s+|e\s+)?{_NOME}){{0,4}}"
)
_SELF_INTRO_RE = re.compile(
    rf"(\b(?:[Mm]e chamo|[Mm]eu nome é|[Ss]ou [oa])\s+)"
    rf"{_NOME}(?:\s+(?:d[aeo]s?\s+|e\s+)?{_NOME}){{0,4}}"
)
# Nome completo: 3+ palavras capitalizadas seguidas (2 deixaria "Cérebro Amigo",
# títulos etc. — o ganho de recall não compensaria o ruído no log).
_FULLNAME_RE = re.compile(rf"\b{_NOME}(?:\s+(?:d[aeo]s?\s+)?{_NOME}){{2,}}")


def redact_pii(text: str) -> str:
    """Substitui PII brasileiras por placeholders."""
    if not text:
        return text
    text = _CPF_RE.sub("[CPF_REDACTED]", text)
    text = _CNPJ_RE.sub("[CNPJ_REDACTED]", text)
    text = _EMAIL_RE.sub("[EMAIL_REDACTED]", text)
    text = _PHONE_RE.sub("[PHONE_REDACTED]", text)
    text = _DATE_RE.sub("[DATE_REDACTED]", text)
    # T0-3: nome/endereço em campo livre (heurístico — ver nota acima)
    text = _ADDRESS_RE.sub("[ADDRESS_REDACTED]", text)
    text = _CEP_RE.sub("[CEP_REDACTED]", text)
    text = _HONORIFIC_RE.sub("[NAME_REDACTED]", text)
    text = _SELF_INTRO_RE.sub(r"\1[NAME_REDACTED]", text)
    text = _FULLNAME_RE.sub("[NAME_REDACTED]", text)
    return text


def _redact_recursive(obj: Any) -> Any:
    if isinstance(obj, str):
        return redact_pii(obj)
    if isinstance(obj, dict):
        return {k: _redact_recursive(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_redact_recursive(item) for item in obj]
    return obj


def redact_pii_processor(_logger: Any, _method_name: str, event_dict: dict[str, Any]) -> dict[str, Any]:
    """structlog processor que aplica redact_pii em toda string do evento."""
    return _redact_recursive(event_dict)


def configure_sentry() -> None:
    """Inicializa o Sentry para captura de ERROS do backend — LGPD-safe.

    Regra #4 da clinical-safety (PII redatada em traces): `send_default_pii=False`
    + `max_request_body_size='never'` + `before_send` que redige PII de TODO o
    evento (reusa `_redact_recursive`). Sem `SENTRY_DSN` → no-op. Só erros.
    """
    dsn = os.environ.get("SENTRY_DSN")
    if not dsn:
        return
    try:
        import sentry_sdk
    except ImportError:
        return

    def _before_send(event: dict[str, Any], _hint: dict[str, Any]) -> dict[str, Any]:
        return _redact_recursive(event)  # type: ignore[return-value]

    sentry_sdk.init(
        dsn=dsn,
        environment=os.environ.get("APP_ENV", "production"),
        send_default_pii=False,
        max_request_body_size="never",
        traces_sample_rate=0.0,
        before_send=_before_send,
    )
