"""Fallback de e-mail quando push falha em TODOS os devices.

Envia o mesmo texto do push de check-in por e-mail quando o dispatcher detecta
que nenhuma subscription ativa recebeu o push — o paciente não perde o lembrete.

O transporte vai pelo client unificado `app.core.email.send_email` (provider
escolhido por `EMAIL_PROVIDER`; ver ADR-073). Sem provider configurado, o envio
degrada graciosamente (loga e retorna False). Pode ser desligado por inteiro
com `EMAIL_FALLBACK_ENABLED=false`.
"""

from __future__ import annotations

import structlog

from app.core.config import get_settings
from app.core.email import send_email

logger = structlog.get_logger(__name__)


async def enviar_email_fallback(
    destinatario: str,
    *,
    titulo: str,
    corpo: str,
    paciente_id: str,
    checkin_id: str,
) -> bool:
    """Envia e-mail de fallback pelo provider ativo.

    Args:
        destinatario: Email do paciente (de clientes.email).
        titulo: Assunto do email.
        corpo: Corpo do email (texto plano).
        paciente_id: UUID do paciente (para tracing).
        checkin_id: UUID do checkin (para tracing).

    Returns:
        True se o e-mail foi aceito pelo provider.
    """
    if not get_settings().email_fallback_enabled:
        logger.info(
            "email_fallback.disabled",
            paciente_id=paciente_id,
            checkin_id=checkin_id,
        )
        return False

    ok, detalhe = await send_email(to=destinatario, subject=titulo, text=corpo)
    if ok:
        logger.info(
            "email_fallback.sent",
            paciente_id=paciente_id,
            checkin_id=checkin_id,
            email_id=detalhe,
        )
    else:
        logger.warning(
            "email_fallback.failed",
            paciente_id=paciente_id,
            checkin_id=checkin_id,
            detalhe=detalhe,
        )
    return ok
