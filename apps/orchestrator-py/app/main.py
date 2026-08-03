"""FastAPI entrypoint do orchestrator-py."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from uuid import UUID

import structlog
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel
from structlog.tracebacks import ExceptionDictTransformer

from app.api.portal import router as portal_router
from app.config import get_settings
from app.conversation import process_message
from app.conversation.graph import get_compiled_app, shutdown_graph
from app.db import acquire, close_pool, init_pool
from app.observability import configure_observability, configure_sentry, redact_pii_processor


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
    log.info("app.startup.begin", env=get_settings().app_env)

    configure_observability()
    configure_sentry()
    await init_pool()
    await get_compiled_app()  # pré-compila grafo + checkpointer

    log.info("app.startup.done")
    try:
        yield
    finally:
        log.info("app.shutdown.begin")
        await shutdown_graph()
        await close_pool()
        log.info("app.shutdown.done")


app = FastAPI(
    title="Cérebro Amigo · Orchestrator (Python)",
    version="0.2.0",
    lifespan=lifespan,
)

app.include_router(portal_router)


# ─── Health checks ─────────────────────────────────────────────────────────


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/ready")
async def ready() -> dict[str, str]:
    async with acquire() as conn:
        await conn.execute("SELECT 1")
    return {"status": "ready"}


# ─── Endpoint interno SÍNCRONO (testes / LangSmith evals) ──────────────────


class RunConversationRequest(BaseModel):
    paciente_id: UUID
    mensagem: str
    idempotency_key: str
    canal: str = "pwa"


def _check_internal_token(authorization: str | None = Header(None)) -> None:
    import hmac

    settings = get_settings()
    expected = f"Bearer {settings.internal_api_token.get_secret_value()}"
    if not hmac.compare_digest(authorization or "", expected):
        raise HTTPException(status_code=401, detail="invalid internal token")


@app.post(
    "/internal/conversation/run",
    dependencies=[Depends(_check_internal_token)],
)
async def run_conversation(req: RunConversationRequest) -> dict:
    """Útil para testes/evals/shadow mode — roda o grafo síncrono, sem SSE."""
    final_state = await process_message(
        paciente_id=req.paciente_id,
        mensagem=req.mensagem,
        idempotency_key=req.idempotency_key,
        canal=req.canal,
    )
    return {
        "enviado": final_state.get("enviado"),
        "resposta_final": final_state.get("resposta_final"),
        "crise": final_state.get("crise"),
        "medicacao": final_state.get("medicacao"),
        "sintomas": final_state.get("sintomas"),
        "audit": final_state.get("audit"),
        "conversa_id": str(final_state.get("conversa_id")) if final_state.get("conversa_id") else None,
        "conversa_status": final_state.get("conversa_status"),
        "trace_id": final_state.get("trace_id"),
    }


# ─── Rascunho de comunicação ADMINISTRATIVA ─────────────────────────────────
# clinical-safety #1: a IA NUNCA gera conteúdo clínico. Este guard é uma
# constante imutável (não vive na tabela de prompts editáveis, de propósito —
# não pode ser alterado para permitir conteúdo clínico). O médico revisa e
# edita o rascunho antes de qualquer envio.

_GUARD_ADMIN = (
    "Você redige APENAS comunicação ADMINISTRATIVA de uma clínica de psiquiatria "
    "para o paciente, em nome da equipe.\n"
    "Permitido: remarcar/confirmar consulta, lembrar de comparecer, instruções "
    "logísticas (endereço, horário, documentos), confirmar recebimento.\n"
    "PROIBIDO ABSOLUTAMENTE qualquer conteúdo clínico — diagnóstico, sintoma, "
    "medicação, dose, conduta, interpretação de humor/exame, orientação de saúde "
    "ou aconselhamento emocional. Se o pedido exigir conteúdo clínico, responda "
    "EXATAMENTE com: [NÃO ADMINISTRATIVO]\n"
    "Tom cordial, claro, breve, em pt-BR. Não invente datas/horários — use só os "
    "fornecidos. Não assine como médico; assine 'Equipe Cérebro Amigo'."
)

_TIPOS_ADMIN = {"remarcar", "confirmar", "lembrete_logistico"}


class RascunhoAdminRequest(BaseModel):
    tipo: str
    nome_paciente: str = ""
    contexto: str = ""


@app.post(
    "/internal/comunicacao/rascunho-admin",
    dependencies=[Depends(_check_internal_token)],
)
async def rascunho_admin(req: RascunhoAdminRequest) -> dict:
    """Gera rascunho de comunicação ADMINISTRATIVA (nunca clínico). O médico
    revisa e edita antes de enviar — a IA não decide nada clínico."""
    from langchain_core.messages import HumanMessage, SystemMessage

    from app.conversation.llm import haiku

    if req.tipo not in _TIPOS_ADMIN:
        raise HTTPException(status_code=400, detail="tipo inválido")

    human = (
        f"Tipo: {req.tipo}\n"
        f"Paciente: {req.nome_paciente or '(não informado)'}\n"
        f"Dados administrativos fornecidos pelo médico: {req.contexto or '(nenhum)'}\n\n"
        "Redija a mensagem administrativa."
    )
    resp = await haiku().ainvoke(
        [SystemMessage(content=_GUARD_ADMIN), HumanMessage(content=human)]
    )
    texto = (
        resp.content if isinstance(resp.content, str) else str(resp.content)
    ).strip()
    administrativo = "[NÃO ADMINISTRATIVO]" not in texto
    return {"rascunho": texto if administrativo else "", "administrativo": administrativo}
