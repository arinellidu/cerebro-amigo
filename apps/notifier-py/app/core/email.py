"""Envio de e-mail unificado e provider-switchável (`EMAIL_PROVIDER`).

Espelha o padrão do client LLM (`LLM_PROVIDER`): os call-sites chamam só
`send_email(...)` e **não sabem** qual provider está ativo. Troca por env:

  EMAIL_PROVIDER=resend  (vigente / PRIMÁRIO — ADR-073) — Resend REST API,
                         auth por `RESEND_API_KEY`. Domínio cerebroamigo.com.br
                         verificado no Resend (DKIM + SPF do subdomínio `send`).
  EMAIL_PROVIDER=ses     (ALTERNATIVA atrás da flag) — Amazon SES v2 in-region
                         (`sa-east-1`, LGPD), auth por IAM role do EC2/ASG.
                         HOJE BLOQUEADO: conta SES em sandbox + domínio não
                         verificado (CK-4). Não promover sem novo ADR.

Contrato: `send_email(...) -> (ok: bool, detalhe: str)`. `detalhe` é SEM PII —
id da mensagem em sucesso, código de status em falha (ex.: "http_502",
"sem_api_key", "ses_MessageRejected"). É consumido pela escada de crise
(ADR-041) e pelo fallback de push.

LGPD: NUNCA logar destinatário, assunto ou corpo (PII / possível conteúdo
clínico). Só metadados e código de status sem PII.

Degradação graciosa (difere do client LLM, que é fail-fast no startup): e-mail é
canal best-effort — push é o primário; o e-mail é fallback/alerta. Config
ausente ou SDK faltando NÃO derruba o serviço — retorna (False, "<codigo>") e
loga. A escada de crise (ADR-041) já trata a falha de e-mail escalando por TEMPO.
"""

from __future__ import annotations

import asyncio

import structlog

from app.core.config import get_settings

logger = structlog.get_logger(__name__)

_RESEND_URL = "https://api.resend.com/emails"


async def send_email(*, to: str, subject: str, text: str) -> tuple[bool, str]:
    """Envia um e-mail pelo provider ativo (`EMAIL_PROVIDER`).

    Retorna (ok, detalhe_sem_pii). Não levanta — falha vira (False, codigo).
    """
    provider = get_settings().email_provider
    if provider == "resend":
        return await _send_resend(to=to, subject=subject, text=text)
    if provider == "ses":
        return await _send_ses(to=to, subject=subject, text=text)
    logger.error("email.provider_desconhecido", provider=provider)
    return False, "provider_desconhecido"


# ─── Resend (REST) — primário ────────────────────────────────────────────────


async def _send_resend(*, to: str, subject: str, text: str) -> tuple[bool, str]:
    settings = get_settings()
    if not settings.resend_api_key:
        logger.info("email.resend.sem_key")
        return False, "sem_api_key"
    try:
        import httpx
    except ImportError:
        logger.error("email.resend.sem_httpx")
        return False, "sem_httpx"

    api_key = settings.resend_api_key.get_secret_value()
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                _RESEND_URL,
                headers={"Authorization": f"Bearer {api_key}"},
                json={
                    "from": settings.email_from,
                    "to": [to],
                    "subject": subject,
                    "text": text,
                },
            )
        if resp.status_code == 200:
            return True, resp.json().get("id") or "ok"
        # body do Resend não contém PII do nosso lado (eco do nosso payload);
        # logamos só o status para o diagnóstico sem vazar destinatário/corpo.
        logger.warning("email.resend.failed", status=resp.status_code)
        return False, f"http_{resp.status_code}"
    except Exception as exc:
        logger.exception("email.resend.error", error=str(exc))
        return False, "excecao"


# ─── Amazon SES v2 (in-region) — alternativa atrás da flag (bloqueado: CK-4) ──


async def _send_ses(*, to: str, subject: str, text: str) -> tuple[bool, str]:
    settings = get_settings()
    try:
        import boto3
        from botocore.exceptions import BotoCoreError, ClientError
    except ImportError:
        logger.error("email.ses.sem_boto3")
        return False, "sem_boto3"

    def _do() -> tuple[bool, str]:
        # botocore é síncrono — roda em thread p/ não bloquear o event loop.
        client = boto3.client("sesv2", region_name=settings.ses_region)
        try:
            resp = client.send_email(
                FromEmailAddress=settings.email_from,
                Destination={"ToAddresses": [to]},
                Content={
                    "Simple": {
                        "Subject": {"Data": subject, "Charset": "UTF-8"},
                        "Body": {"Text": {"Data": text, "Charset": "UTF-8"}},
                    }
                },
            )
            return True, resp.get("MessageId") or "ok"
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code", "ClientError")
            logger.warning("email.ses.failed", code=code)
            return False, f"ses_{code}"
        except BotoCoreError as exc:
            logger.exception("email.ses.error", error=str(exc))
            return False, "ses_excecao"

    return await asyncio.to_thread(_do)
