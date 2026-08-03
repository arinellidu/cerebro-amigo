"""FastAPI entrypoint do notifier-py."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from uuid import UUID

import structlog
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel
from structlog.tracebacks import ExceptionDictTransformer

from app.consulta_lembretes import despachar_lembretes_consultas
from app.core.config import get_settings
from app.core.db import acquire, close_pool, init_pool
from app.core.observability import configure_sentry, redact_pii_processor
from app.dispatcher import dispatch_for_patient, dispatch_pending, test_push_to_sub
from app.medico_notify import despachar_crise_medico, despachar_crise_protocolo
from app.scheduler import shutdown_scheduler, start_scheduler


def _configure_logging() -> None:
    settings = get_settings()
    logging.basicConfig(level=settings.log_level)
    structlog.configure(
        processors=[
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            # R4 (clinical-safety): traceback estruturado SEM frame locals — os
            # locals continham conteúdo clínico cru (mensagem do paciente, estado
            # da conversa). Mantém type/value/file/line/função p/ debug.
            structlog.processors.ExceptionRenderer(
                ExceptionDictTransformer(show_locals=False)
            ),
            redact_pii_processor,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(
            logging.getLevelName(settings.log_level)
        ),
        cache_logger_on_first_use=True,
    )


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    _configure_logging()
    log = structlog.get_logger(__name__)
    settings = get_settings()
    log.info("app.startup.begin", env=settings.app_env, mode=settings.notifier_mode)

    configure_sentry()
    await init_pool()
    if settings.notifier_mode == "scheduled":
        start_scheduler()
    else:
        log.info("scheduler.disabled.manual_mode")

    log.info("app.startup.done")
    try:
        yield
    finally:
        log.info("app.shutdown.begin")
        shutdown_scheduler()
        await close_pool()
        log.info("app.shutdown.done")


app = FastAPI(title="Cérebro Amigo · Notifier", version="0.1.0", lifespan=lifespan)


# ─── Health ────────────────────────────────────────────────────────────────


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/ready")
async def ready() -> dict[str, str]:
    async with acquire() as conn:
        await conn.execute("SELECT 1")
    return {"status": "ready"}


# ─── Internal endpoints ────────────────────────────────────────────────────


def _check_token(authorization: str | None = Header(None)) -> None:
    import hmac

    settings = get_settings()
    expected = f"Bearer {settings.internal_api_token.get_secret_value()}"
    if not hmac.compare_digest(authorization or "", expected):
        raise HTTPException(status_code=401, detail="invalid internal token")


@app.post("/internal/checkins/dispatch", dependencies=[Depends(_check_token)])
async def dispatch_now() -> dict:
    """Força um ciclo do dispatcher agora (varre pendentes, envia)."""
    return (await dispatch_pending()).as_dict()


class DispatchForPatientRequest(BaseModel):
    paciente_id: UUID


@app.post(
    "/internal/checkins/dispatch-for-patient",
    dependencies=[Depends(_check_token)],
)
async def dispatch_for_patient_endpoint(req: DispatchForPatientRequest) -> dict:
    """Dispara pendentes apenas do paciente especificado."""
    return (await dispatch_for_patient(req.paciente_id)).as_dict()


class TestPushRequest(BaseModel):
    subscription_id: UUID


@app.post("/internal/medico/notificar-crise", dependencies=[Depends(_check_token)])
async def notificar_crise_medico() -> dict:
    """Watchdog manual: varre crises abertas e avança a escada de cada uma."""
    return await despachar_crise_medico()


class DespacharCriseRequest(BaseModel):
    protocolo_id: UUID


@app.post("/internal/crise/despachar", dependencies=[Depends(_check_token)])
async def despachar_crise(req: DespacharCriseRequest) -> dict:
    """Caminho imediato: despacha o alerta de UM protocolo de crise agora.

    Chamado pelo orchestrator logo após gravar o protocolo, para o médico ser
    avisado em segundos (não no próximo tick do watchdog). O watchdog continua
    como rede durável caso esta chamada falhe (notifier fora no T0)."""
    return await despachar_crise_protocolo(req.protocolo_id)


@app.post("/internal/consultas/lembretes", dependencies=[Depends(_check_token)])
async def disparar_lembretes_consultas() -> dict:
    """Força um ciclo de lembretes de consulta (push/email 24h e 1h antes)."""
    return await despachar_lembretes_consultas()


@app.post("/internal/push/test", dependencies=[Depends(_check_token)])
async def push_test(req: TestPushRequest) -> dict:
    """Envia push de teste para uma subscription específica.

    Útil para validar:
    - VAPID keys corretas
    - Conexão com browser provider (FCM, Mozilla, APNs)
    - Subscription ainda viva no device
    """
    return await test_push_to_sub(req.subscription_id)
