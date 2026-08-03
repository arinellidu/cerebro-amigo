"""Lembretes de consulta (push + fallback de e-mail).

Para cada antecedência configurada (24h e 1h antes), encontra consultas
agendadas/confirmadas que entram na janela e ainda não receberam o lembrete
daquele tipo, e envia push aos devices do paciente (fallback e-mail se nenhum
device receber). Dedup por (consulta_id, tipo) em `consulta_lembretes`.

Conteúdo 100% administrativo e estático (`consulta_copy.py`) — sem LLM, sem
detalhe clínico (LGPD). O log não inclui PII (só ids/contagem).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID
from zoneinfo import ZoneInfo

import asyncpg
import structlog

from app.consulta_copy import get_lembrete_copy
from app.core.config import get_settings
from app.core.db import acquire
from app.email_fallback import enviar_email_fallback
from app.push_client import Subscription, send_push

logger = structlog.get_logger(__name__)

# (tipo, antecedência em minutos). Ordem só afeta o log.
LEMBRETE_OFFSETS: list[tuple[str, int]] = [("24h", 24 * 60), ("1h", 60)]


@dataclass
class LembreteStats:
    consultas_processed: int = 0
    lembretes_delivered: int = 0
    lembretes_failed: int = 0

    def as_dict(self) -> dict[str, int]:
        return {
            "consultas_processed": self.consultas_processed,
            "lembretes_delivered": self.lembretes_delivered,
            "lembretes_failed": self.lembretes_failed,
        }


def _formatar_quando(inicia_em: datetime, tz_name: str | None) -> str:
    try:
        tz = ZoneInfo(tz_name or "America/Sao_Paulo")
    except Exception:
        tz = ZoneInfo("America/Sao_Paulo")
    return inicia_em.astimezone(tz).strftime("%d/%m às %H:%M")


async def despachar_lembretes_consultas() -> dict:
    """Roda um ciclo de lembretes. Chamado pelo APScheduler periodicamente."""
    settings = get_settings()
    if not settings.consulta_lembretes_enabled:
        logger.info("lembrete.disabled")
        return LembreteStats().as_dict()

    stats = LembreteStats()
    log = logger.bind(operation="despachar_lembretes_consultas")

    for tipo, offset_min in LEMBRETE_OFFSETS:
        async with acquire() as conn:
            pendentes = await conn.fetch(
                """
                SELECT co.id, co.paciente_id, co.inicia_em, m.timezone AS medico_tz
                FROM consultas co
                JOIN pacientes p ON p.cliente_id = co.paciente_id
                JOIN medicos m ON m.id = p.medico_responsavel_id
                WHERE co.status IN ('agendada', 'confirmada')
                  AND co.inicia_em > NOW()
                  AND co.inicia_em <= NOW() + make_interval(mins => $1::int)
                  AND NOT EXISTS (
                      SELECT 1 FROM consulta_lembretes l
                      WHERE l.consulta_id = co.id AND l.tipo = $2
                  )
                ORDER BY co.inicia_em
                LIMIT 200
                """,
                offset_min,
                tipo,
            )

        for c in pendentes:
            stats.consultas_processed += 1
            entregue = await _enviar_lembrete(c, tipo)
            if entregue:
                stats.lembretes_delivered += 1
                await _marcar_enviado(c["id"], tipo)
            else:
                stats.lembretes_failed += 1
                log.warning("lembrete.nao_entregue", consulta_id=str(c["id"]), tipo=tipo)

    log.info("lembrete.done", **stats.as_dict())
    return stats.as_dict()


async def _enviar_lembrete(row: asyncpg.Record, tipo: str) -> bool:
    """Push para todos os devices do paciente; fallback e-mail se nenhum receber.
    True se pelo menos um canal entregou."""
    paciente_id: UUID = row["paciente_id"]
    copy = get_lembrete_copy(tipo)
    titulo = copy.titulo
    corpo = copy.corpo(_formatar_quando(row["inicia_em"], row["medico_tz"]))

    async with acquire() as conn:
        subs_rows = await conn.fetch(
            """
            SELECT id, endpoint, p256dh_key, auth_key
            FROM push_subscriptions
            WHERE paciente_id = $1 AND revogada_em IS NULL
            """,
            paciente_id,
        )

    any_delivered = False
    for s in subs_rows:
        sub = Subscription(
            id=str(s["id"]),
            endpoint=s["endpoint"],
            p256dh_key=s["p256dh_key"],
            auth_key=s["auth_key"],
        )
        result = await send_push(sub, titulo=titulo, corpo=corpo)
        if result.status == "delivered":
            any_delivered = True
            async with acquire() as conn:
                await conn.execute(
                    "UPDATE push_subscriptions SET ultimo_uso_em = NOW() WHERE id = $1",
                    s["id"],
                )
        elif result.status == "gone":
            async with acquire() as conn:
                await conn.execute(
                    "UPDATE push_subscriptions SET revogada_em = NOW() WHERE id = $1",
                    s["id"],
                )

    if any_delivered:
        return True

    # Nenhum device recebeu → tenta e-mail
    async with acquire() as conn:
        email = await conn.fetchval("SELECT email FROM clientes WHERE id = $1", paciente_id)
    if not email:
        return False
    return await enviar_email_fallback(
        email,
        titulo=titulo,
        corpo=corpo,
        paciente_id=str(paciente_id),
        checkin_id=str(row["id"]),
    )


async def _marcar_enviado(consulta_id: UUID, tipo: str) -> None:
    async with acquire() as conn:
        await conn.execute(
            """
            INSERT INTO consulta_lembretes (consulta_id, tipo, enviado_em)
            VALUES ($1, $2, NOW())
            ON CONFLICT (consulta_id, tipo) DO NOTHING
            """,
            consulta_id,
            tipo,
        )
