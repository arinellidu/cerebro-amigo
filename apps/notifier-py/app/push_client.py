"""Cliente VAPID/Web Push.

Wrapper fino sobre `pywebpush` que:

1. Encapsula a config VAPID (lê settings uma vez).
2. Mapeia respostas HTTP do endpoint do navegador para tipos discretos:
   `Delivered`, `Gone`, `TransientError`.
3. Loga estruturado, sem expor a subscription completa (PII).

`Gone` (HTTP 404/410) é importante: significa que o navegador desinstalou
ou revogou a subscription, e o caller deve persistir `revogada_em=NOW()`
para parar de tentar nesse device.
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from typing import Literal

import structlog
from pywebpush import WebPushException, webpush

from app.core.config import get_settings

logger = structlog.get_logger(__name__)


@dataclass(frozen=True)
class Subscription:
    """Subscription minimal (mesmos campos que `push_subscriptions`)."""

    id: str
    endpoint: str
    p256dh_key: str
    auth_key: str

    def to_pywebpush(self) -> dict:
        return {
            "endpoint": self.endpoint,
            "keys": {"p256dh": self.p256dh_key, "auth": self.auth_key},
        }


@dataclass(frozen=True)
class PushResult:
    status: Literal["delivered", "gone", "transient_error"]
    detail: str | None = None


async def send_push(sub: Subscription, *, titulo: str, corpo: str, url: str = "/") -> PushResult:
    """Envia push para uma subscription (não bloqueante — roda em thread pool).

    Retorna `PushResult` discriminado. Não levanta exceções pra erros
    esperados (Gone, TransientError) — o caller decide o que fazer.
    """
    settings = get_settings()
    log = logger.bind(sub_id=sub.id, endpoint_host=_redact_endpoint(sub.endpoint))

    payload = json.dumps({"titulo": titulo, "corpo": corpo, "url": url}, ensure_ascii=False)

    def _send() -> None:
        webpush(
            subscription_info=sub.to_pywebpush(),
            data=payload,
            vapid_private_key=settings.vapid_private_key,
            vapid_claims={"sub": settings.vapid_subject},
            ttl=settings.push_ttl_seconds,
            headers={"Urgency": settings.push_urgency},
        )

    try:
        await asyncio.to_thread(_send)
        log.info("push.delivered")
        return PushResult(status="delivered")

    except WebPushException as exc:
        code = exc.response.status_code if exc.response is not None else 0
        # 404/410 = subscription morta. Caller deve revogar.
        if code in (404, 410):
            log.info("push.gone", code=code)
            return PushResult(status="gone", detail=f"HTTP {code}")
        # Outros erros (rate limit, falha de TLS, etc.) — não revogar
        log.warning("push.transient_error", code=code, error=str(exc))
        return PushResult(status="transient_error", detail=f"HTTP {code}: {exc}")

    except Exception as exc:
        log.exception("push.unexpected_error", error=str(exc))
        return PushResult(status="transient_error", detail=f"unexpected: {exc}")


def _redact_endpoint(endpoint: str) -> str:
    """Não loga endpoint completo (contém token único do device). Só o host
    pra correlacionar problemas por provedor (FCM, APNs, Mozilla, etc.)."""
    try:
        from urllib.parse import urlparse

        return urlparse(endpoint).hostname or "<unknown>"
    except Exception:
        return "<unparseable>"
