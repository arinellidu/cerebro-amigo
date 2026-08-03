"""Dispatcher de check-ins pendentes.

Algoritmo:
  1. SELECT FOR UPDATE SKIP LOCKED em `checkins` onde
       enviado_em IS NULL AND agendado_para <= NOW()
     (SKIP LOCKED evita dupla entrega se rodarmos múltiplas réplicas)
  2. Para cada checkin pendente:
     a. SELECT subscriptions ativas do paciente
     b. Para cada subscription, envia push
     c. Em sucesso → marca `ultimo_uso_em`
        Em `gone`  → marca `revogada_em` (parar de tentar)
        Em erro transiente → log, segue tentando outros devices
     d. Se pelo menos 1 device recebeu → UPDATE checkins.enviado_em
        Se NENHUM device recebeu → log (TODO: email backup) mas NÃO
        marca enviado_em — próximo tick tentará novamente
     e. Registra `notificacoes_medico` para trilha (independente do
        sucesso, para auditoria do médico responsável)

Idempotência: o `WHERE enviado_em IS NULL` no SELECT garante que apenas
checkins ainda não enviados são pegos. Combine com SKIP LOCKED se
escalar para múltiplas réplicas.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from uuid import UUID

import asyncpg
import structlog

from app.checkin_copy import get_copy
from app.core.db import acquire
from app.email_fallback import enviar_email_fallback
from app.push_client import Subscription, send_push

logger = structlog.get_logger(__name__)


@dataclass
class DispatchStats:
    checkins_processed: int = 0
    checkins_delivered: int = 0   # pelo menos 1 device recebeu
    checkins_failed: int = 0      # nenhum device recebeu
    subs_revoked: int = 0
    subs_delivered: int = 0
    subs_transient: int = 0

    def as_dict(self) -> dict[str, int]:
        return {
            "checkins_processed": self.checkins_processed,
            "checkins_delivered": self.checkins_delivered,
            "checkins_failed": self.checkins_failed,
            "subs_revoked": self.subs_revoked,
            "subs_delivered": self.subs_delivered,
            "subs_transient": self.subs_transient,
        }


async def dispatch_pending() -> DispatchStats:
    """Roda um ciclo completo. Chamado pelo APScheduler periodicamente."""
    stats = DispatchStats()
    log = logger.bind(operation="dispatch_pending")

    async with acquire() as conn:
        pending = await conn.fetch(
            """
            SELECT id, paciente_id, tipo, payload, agendado_para
            FROM checkins
            WHERE enviado_em IS NULL
              AND agendado_para <= NOW()
              AND (expirado_em IS NULL OR expirado_em > NOW())
            ORDER BY agendado_para
            LIMIT 200
            FOR UPDATE SKIP LOCKED
            """
        )

    if not pending:
        log.info("dispatch.no_pending")
        return stats

    log.info("dispatch.processing", count=len(pending))

    for c in pending:
        stats.checkins_processed += 1
        sucesso = await _send_for_checkin(c, stats)
        if sucesso:
            stats.checkins_delivered += 1
            await _marcar_checkin_enviado(c["id"])
        else:
            stats.checkins_failed += 1
            log.warning(
                "dispatch.no_device_received",
                checkin_id=str(c["id"]),
                paciente_id=str(c["paciente_id"]),
            )
            # Fallback: envia email se nenhum device recebeu push
            await _tentar_email_fallback(c)

        await _registrar_notificacao_medico(c, sucesso)

    log.info("dispatch.done", **stats.as_dict())
    return stats


async def _send_for_checkin(checkin_row: asyncpg.Record, stats: DispatchStats) -> bool:
    """Envia push para todas as subscriptions ativas do paciente.
    Retorna True se pelo menos uma delas foi entregue."""
    paciente_id: UUID = checkin_row["paciente_id"]
    tipo: str = checkin_row["tipo"]

    copy = get_copy(tipo)

    async with acquire() as conn:
        subs_rows = await conn.fetch(
            """
            SELECT id, endpoint, p256dh_key, auth_key
            FROM push_subscriptions
            WHERE paciente_id = $1 AND revogada_em IS NULL
            """,
            paciente_id,
        )

    if not subs_rows:
        logger.info(
            "dispatch.no_active_subs",
            paciente_id=str(paciente_id),
            checkin_id=str(checkin_row["id"]),
        )
        return False

    any_delivered = False
    for s in subs_rows:
        sub = Subscription(
            id=str(s["id"]),
            endpoint=s["endpoint"],
            p256dh_key=s["p256dh_key"],
            auth_key=s["auth_key"],
        )
        result = await send_push(sub, titulo=copy.titulo, corpo=copy.corpo)

        if result.status == "delivered":
            any_delivered = True
            stats.subs_delivered += 1
            await _marcar_sub_usada(s["id"])
        elif result.status == "gone":
            stats.subs_revoked += 1
            await _revogar_sub(s["id"])
        else:
            stats.subs_transient += 1

    return any_delivered


async def _marcar_checkin_enviado(checkin_id: UUID) -> None:
    async with acquire() as conn:
        await conn.execute(
            "UPDATE checkins SET enviado_em = NOW() WHERE id = $1", checkin_id
        )


async def _marcar_sub_usada(sub_id: UUID) -> None:
    async with acquire() as conn:
        await conn.execute(
            "UPDATE push_subscriptions SET ultimo_uso_em = NOW() WHERE id = $1",
            sub_id,
        )


async def _revogar_sub(sub_id: UUID) -> None:
    async with acquire() as conn:
        await conn.execute(
            "UPDATE push_subscriptions SET revogada_em = NOW() WHERE id = $1",
            sub_id,
        )


async def _registrar_notificacao_medico(
    checkin_row: asyncpg.Record, entregue: bool
) -> None:
    """Trilha de auditoria: cada push registrada em `notificacoes_medico`
    para o médico responsável poder ver no dashboard que tentamos contato.

    Severidade `info` — push de check-in não é evento urgente clinico.
    Se entrega falhou em TODOS devices, vira `baixa` (atenção operacional)."""
    paciente_id: UUID = checkin_row["paciente_id"]
    tipo: str = checkin_row["tipo"]
    copy = get_copy(tipo)

    severidade = "info" if entregue else "baixa"
    metadata: dict[str, Any] = {
        "checkin_id": str(checkin_row["id"]),
        "checkin_tipo": tipo,
        "agendado_para": checkin_row["agendado_para"].isoformat(),
        "copy_versao": copy.versao,
        "copy_hash": copy.hash_sha256,
        "entregue": entregue,
    }

    async with acquire() as conn:
        medico_id = await conn.fetchval(
            "SELECT medico_responsavel_id FROM pacientes WHERE cliente_id = $1",
            paciente_id,
        )
        if medico_id is None:
            logger.warning(
                "notif.sem_medico_responsavel", paciente_id=str(paciente_id)
            )
            return

        await conn.execute(
            """
            INSERT INTO notificacoes_medico
                (medico_id, paciente_id, severidade, tipo, titulo, mensagem, metadata)
            VALUES ($1, $2, $3, 'push', $4, $5, $6::jsonb)
            """,
            medico_id,
            paciente_id,
            severidade,
            copy.titulo,
            ("Notificação push entregue ao paciente."
             if entregue else
             "Notificação push NÃO entregue (nenhum device recebeu)."),
            json.dumps(metadata, ensure_ascii=False, default=str),
        )


async def _tentar_email_fallback(checkin_row: asyncpg.Record) -> None:
    """Busca email do paciente e envia fallback via Resend quando push falhou."""
    paciente_id: UUID = checkin_row["paciente_id"]
    tipo: str = checkin_row["tipo"]
    copy = get_copy(tipo)

    async with acquire() as conn:
        email = await conn.fetchval(
            "SELECT email FROM clientes WHERE id = $1", paciente_id
        )

    if not email:
        logger.warning(
            "email_fallback.no_email",
            paciente_id=str(paciente_id),
            checkin_id=str(checkin_row["id"]),
        )
        return

    await enviar_email_fallback(
        email,
        titulo=copy.titulo,
        corpo=copy.corpo,
        paciente_id=str(paciente_id),
        checkin_id=str(checkin_row["id"]),
    )


# ─── Disparos manuais ──────────────────────────────────────────────────────


async def dispatch_for_patient(paciente_id: UUID) -> DispatchStats:
    """Dispara todos os checkins pendentes do paciente. Usado pelo endpoint
    manual (dashboard 'reenviar')."""
    stats = DispatchStats()
    async with acquire() as conn:
        pending = await conn.fetch(
            """
            SELECT id, paciente_id, tipo, payload, agendado_para
            FROM checkins
            WHERE paciente_id = $1
              AND enviado_em IS NULL
              AND agendado_para <= NOW()
            ORDER BY agendado_para
            """,
            paciente_id,
        )

    for c in pending:
        stats.checkins_processed += 1
        sucesso = await _send_for_checkin(c, stats)
        if sucesso:
            stats.checkins_delivered += 1
            await _marcar_checkin_enviado(c["id"])
        else:
            stats.checkins_failed += 1
            await _tentar_email_fallback(c)
        await _registrar_notificacao_medico(c, sucesso)

    return stats


async def test_push_to_sub(sub_id: UUID) -> dict:
    """Envia um push de teste para uma subscription específica.
    Usado para validar credentials VAPID + conexão com browser provider."""
    async with acquire() as conn:
        s = await conn.fetchrow(
            """
            SELECT id, endpoint, p256dh_key, auth_key, revogada_em
            FROM push_subscriptions WHERE id = $1
            """,
            sub_id,
        )

    if s is None:
        return {"ok": False, "error": "subscription not found"}
    if s["revogada_em"] is not None:
        return {"ok": False, "error": "subscription revogada"}

    sub = Subscription(
        id=str(s["id"]),
        endpoint=s["endpoint"],
        p256dh_key=s["p256dh_key"],
        auth_key=s["auth_key"],
    )
    result = await send_push(
        sub,
        titulo="Cérebro Amigo · teste",
        corpo="Esta é uma notificação de teste do servidor.",
    )

    if result.status == "gone":
        await _revogar_sub(s["id"])
    elif result.status == "delivered":
        await _marcar_sub_usada(s["id"])

    return {"ok": result.status == "delivered", "status": result.status, "detail": result.detail}
