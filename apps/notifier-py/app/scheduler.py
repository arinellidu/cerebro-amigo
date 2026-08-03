"""APScheduler para o notifier."""

from __future__ import annotations

import structlog
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

from app.consulta_lembretes import despachar_lembretes_consultas
from app.core.config import get_settings
from app.dispatcher import dispatch_pending
from app.medico_notify import despachar_crise_medico

logger = structlog.get_logger(__name__)

_scheduler: AsyncIOScheduler | None = None


async def _tick() -> None:
    try:
        await dispatch_pending()
    except Exception as exc:
        logger.exception("scheduler.tick.failed", error=str(exc))


async def _tick_medico_crise() -> None:
    try:
        await despachar_crise_medico()
    except Exception as exc:
        logger.exception("scheduler.medico_crise.failed", error=str(exc))


async def _tick_consulta_lembretes() -> None:
    try:
        await despachar_lembretes_consultas()
    except Exception as exc:
        logger.exception("scheduler.consulta_lembretes.failed", error=str(exc))


def start_scheduler() -> AsyncIOScheduler:
    global _scheduler
    if _scheduler is not None:
        return _scheduler

    settings = get_settings()
    sched = AsyncIOScheduler(timezone="UTC")
    sched.add_job(
        _tick,
        trigger=IntervalTrigger(seconds=settings.scheduler_interval_seconds),
        id="tick:dispatch_pending",
        replace_existing=True,
        coalesce=True,
        max_instances=1,
    )
    sched.add_job(
        _tick_medico_crise,
        trigger=IntervalTrigger(seconds=settings.scheduler_interval_seconds),
        id="tick:medico_crise",
        replace_existing=True,
        coalesce=True,
        max_instances=1,
    )
    sched.add_job(
        _tick_consulta_lembretes,
        trigger=IntervalTrigger(seconds=settings.scheduler_interval_seconds),
        id="tick:consulta_lembretes",
        replace_existing=True,
        coalesce=True,
        max_instances=1,
    )
    sched.start()
    _scheduler = sched
    logger.info(
        "scheduler.started", interval_s=settings.scheduler_interval_seconds
    )
    return sched


def shutdown_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
