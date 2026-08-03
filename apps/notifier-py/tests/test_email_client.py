"""Provider switch do client de e-mail unificado (`EMAIL_PROVIDER`, ADR-073).

Garante que os call-sites (fallback de push, alerta de crise) recebem o mesmo
contrato `(ok, detalhe_sem_pii)` independente do provider, e que a troca por env
roteia para Resend (primário) ou SES (alternativa) — sem rede real.
"""

from __future__ import annotations

import pytest

from app.core import email as email_mod

# ─── fakes ───────────────────────────────────────────────────────────────────


class _Secret:
    def __init__(self, v: str) -> None:
        self._v = v

    def get_secret_value(self) -> str:
        return self._v


class _Settings:
    def __init__(
        self,
        *,
        provider: str = "resend",
        key: str | None = "re_test",
        frm: str = "Cérebro Amigo <noreply@cerebroamigo.com.br>",
        region: str = "sa-east-1",
    ) -> None:
        self.email_provider = provider
        self.resend_api_key = _Secret(key) if key is not None else None
        self.email_from = frm
        self.ses_region = region


def _patch_settings(monkeypatch, **kw) -> None:
    monkeypatch.setattr(email_mod, "get_settings", lambda: _Settings(**kw))


class _Resp:
    def __init__(self, status: int, payload: dict | None = None) -> None:
        self.status_code = status
        self._p = payload or {}
        self.text = "body-sem-pii"

    def json(self) -> dict:
        return self._p


class _Client:
    def __init__(self, resp: _Resp, captured: dict) -> None:
        self._resp = resp
        self._captured = captured

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def post(self, url, headers=None, json=None):
        self._captured.update(url=url, headers=headers, json=json)
        return self._resp


def _patch_httpx(monkeypatch, resp: _Resp, captured: dict) -> None:
    httpx = pytest.importorskip("httpx")
    monkeypatch.setattr(httpx, "AsyncClient", lambda *a, **k: _Client(resp, captured))


# ─── default ───────────────────────────────────────────────────────────────


def test_default_provider_is_resend():
    from app.core.config import Settings

    assert Settings.model_fields["email_provider"].default == "resend"


# ─── Resend (primário) ──────────────────────────────────────────────────────


async def test_resend_success_returns_message_id(monkeypatch):
    captured: dict = {}
    _patch_settings(monkeypatch, provider="resend", key="re_abc")
    _patch_httpx(monkeypatch, _Resp(200, {"id": "eml_123"}), captured)

    ok, detalhe = await email_mod.send_email(to="med@x.com", subject="s", text="t")

    assert ok is True
    assert detalhe == "eml_123"
    assert captured["url"] == "https://api.resend.com/emails"
    assert captured["headers"]["Authorization"] == "Bearer re_abc"
    assert captured["json"]["to"] == ["med@x.com"]
    assert captured["json"]["from"].endswith("cerebroamigo.com.br>")


async def test_resend_http_error_returns_status_code(monkeypatch):
    _patch_settings(monkeypatch, provider="resend")
    _patch_httpx(monkeypatch, _Resp(502), {})

    ok, detalhe = await email_mod.send_email(to="a@b.c", subject="s", text="t")

    assert ok is False
    assert detalhe == "http_502"


async def test_resend_without_key_degrades(monkeypatch):
    _patch_settings(monkeypatch, provider="resend", key=None)

    ok, detalhe = await email_mod.send_email(to="a@b.c", subject="s", text="t")

    assert (ok, detalhe) == (False, "sem_api_key")


async def test_unknown_provider_does_not_raise(monkeypatch):
    _patch_settings(monkeypatch, provider="carrier_pigeon")

    ok, detalhe = await email_mod.send_email(to="a@b.c", subject="s", text="t")

    assert (ok, detalhe) == (False, "provider_desconhecido")


# ─── SES (alternativa atrás da flag) ─────────────────────────────────────────


async def test_ses_success_returns_message_id(monkeypatch):
    boto3 = pytest.importorskip("boto3")
    _patch_settings(monkeypatch, provider="ses", region="sa-east-1")
    sent: dict = {}

    class _SES:
        def send_email(self, **kw):
            sent.update(kw)
            return {"MessageId": "ses-999"}

    monkeypatch.setattr(boto3, "client", lambda svc, region_name=None: _SES())

    ok, detalhe = await email_mod.send_email(to="med@x.com", subject="s", text="t")

    assert ok is True
    assert detalhe == "ses-999"
    assert sent["Destination"]["ToAddresses"] == ["med@x.com"]
    assert sent["Content"]["Simple"]["Subject"]["Data"] == "s"


async def test_ses_client_error_returns_code(monkeypatch):
    boto3 = pytest.importorskip("boto3")
    from botocore.exceptions import ClientError

    _patch_settings(monkeypatch, provider="ses")

    class _SES:
        def send_email(self, **kw):
            raise ClientError({"Error": {"Code": "MessageRejected"}}, "SendEmail")

    monkeypatch.setattr(boto3, "client", lambda svc, region_name=None: _SES())

    ok, detalhe = await email_mod.send_email(to="a@b.c", subject="s", text="t")

    assert ok is False
    assert detalhe == "ses_MessageRejected"
