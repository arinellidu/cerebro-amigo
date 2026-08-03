"""FastAPI entrypoint do agents-py."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import structlog
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel
from structlog.tracebacks import ExceptionDictTransformer

from app.agents import AGENT_REGISTRY, AgentPayload
from app.agents.resumidor import ResumidorAgent
from app.core.config import get_settings
from app.core.db import acquire, close_pool, init_pool
from app.core.observability import configure_observability, configure_sentry, redact_pii_processor
from app.jobs.indexador_rag import reindexar_kb, reindexar_paciente
from app.scheduler import (
    run_for_patient,
    run_once,
    shutdown_scheduler,
    start_scheduler,
)
from app.services.crisis import (
    CrisisDetectionOutput,
    acionar_protocolo,
    acionar_protocolo_diario,
    detectar_crise,
)
from app.services.crisis_copy import CRISIS_COPY
from app.services.escriba import gerar_rascunho_consulta, gerar_rascunho_consulta_blob
from app.services.retrieval import buscar as rag_buscar_service
from app.services.transcricao import transcrever_audio


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
    log.info("app.startup.begin", env=settings.app_env, mode=settings.agents_mode)

    configure_observability()
    configure_sentry()
    await init_pool()

    if settings.agents_mode == "scheduled":
        start_scheduler()
        log.info("scheduler.started")
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


app = FastAPI(
    title="Cérebro Amigo · Agents (Python)",
    version="0.1.0",
    lifespan=lifespan,
)


# ─── Health checks ─────────────────────────────────────────────────────────


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/ready")
async def ready() -> dict[str, str]:
    async with acquire() as conn:
        await conn.execute("SELECT 1")
    return {"status": "ready"}


# ─── Endpoints manuais ─────────────────────────────────────────────────────


def _check_internal_token(authorization: str | None = Header(None)) -> None:
    import hmac

    settings = get_settings()
    expected = f"Bearer {settings.internal_api_token.get_secret_value()}"
    if not hmac.compare_digest(authorization or "", expected):
        raise HTTPException(status_code=401, detail="invalid internal token")


@app.get("/internal/agents", dependencies=[Depends(_check_internal_token)])
async def list_agents() -> dict[str, list[str]]:
    return {"agents": sorted(AGENT_REGISTRY.keys())}


@app.post(
    "/internal/agents/{name}/run",
    dependencies=[Depends(_check_internal_token)],
)
async def run_agent_now(name: str) -> dict:
    """Dispara um ciclo do agente agora (varre find_pending, executa,
    respeita dedup window). Útil para forçar processamento sem esperar
    o scheduler."""
    if name not in AGENT_REGISTRY:
        raise HTTPException(status_code=404, detail=f"agente '{name}' desconhecido")
    return await run_once(name)


class RunForPatientRequest(BaseModel):
    paciente_id: UUID


@app.post(
    "/internal/agents/{name}/run-for-patient",
    dependencies=[Depends(_check_internal_token)],
)
async def run_agent_for_patient(name: str, req: RunForPatientRequest) -> dict:
    """Força execução de um agente para um paciente específico, IGNORANDO
    dedup window. Usado quando médico clica 'regenerar' no dashboard.

    Se o agente não considera o paciente elegível agora (sem consulta
    agendada para resumidor, triggers não atingidos para adesão, etc.),
    retorna 200 com `insight_id=null` e mensagem explicativa.
    """
    if name not in AGENT_REGISTRY:
        raise HTTPException(status_code=404, detail=f"agente '{name}' desconhecido")
    return await run_for_patient(name, req.paciente_id)


# ─── Diário de Voz ────────────────────────────────────────────────────────


class TranscreverAudioRequest(BaseModel):
    audio_base64: str   # áudio codificado em base64 (WebM ou MP4, máx ~10MB)
    content_type: str   # "audio/webm" | "audio/mp4"
    paciente_id: UUID


@app.post(
    "/internal/diario/transcrever",
    dependencies=[Depends(_check_internal_token)],
)
async def transcrever_diario(req: TranscreverAudioRequest) -> dict:
    """Transcreve áudio de diário e retorna análise clínica estruturada.

    Fluxo interno (ADR-082): Azure Speech fast transcription (pt-BR, bytes
    direto — sem storage) → Claude Sonnet → resultado. O áudio nunca persiste
    além do ciclo da request (LGPD).
    """
    import base64
    import binascii

    log = structlog.get_logger(__name__)

    try:
        audio_bytes = base64.b64decode(req.audio_base64)
    except (binascii.Error, ValueError) as exc:
        # Falha de validação de entrada (ex.: gravação truncada no celular).
        # Logamos só internamente — sem áudio/PII — e devolvemos 400 acolhedor.
        log.warning(
            "diario.transcrever.audio_base64_invalido",
            paciente_id=str(req.paciente_id),
            erro=type(exc).__name__,
        )
        raise HTTPException(
            status_code=400,
            detail=(
                "Houve um problema ao receber o áudio. Tente gravar novamente, "
                "por favor. Se preferir, você também pode escrever no diário."
            ),
        ) from exc

    if len(audio_bytes) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="áudio maior que 10 MB")

    try:
        result = await transcrever_audio(audio_bytes, req.content_type, req.paciente_id)
    except HTTPException:
        raise
    except Exception as exc:
        # Falha de infraestrutura (Azure Speech/timeout). A triagem de crise
        # acontece DENTRO de transcrever_audio e retorna normalmente (não por
        # exceção), então protocolos_crise_acionados e o acolhimento fixo não
        # são afetados aqui. Logamos o erro real para ops (sem PII e sem corpo
        # de resposta do Speech no detail) e devolvemos copy amigável.
        log.error(
            "diario.transcrever.falha_infra",
            paciente_id=str(req.paciente_id),
            erro=type(exc).__name__,
            exc_info=exc,
        )
        raise HTTPException(
            status_code=503,
            detail=(
                "Não consegui transcrever seu áudio agora. Isso não foi culpa sua. "
                "Você pode tentar de novo em alguns instantes ou registrar como está "
                "se sentindo por texto. Seu médico continua acompanhando você."
            ),
        ) from exc

    return {
        "transcricao": result.transcricao,
        "humor_estimado": result.humor_estimado,
        "emocao_predominante": result.emocao_predominante,
        "tags_sugeridas": result.tags_sugeridas,
        "sintomas_detectados": result.sintomas_detectados,
        "crise": result.crise,
        "crise_texto": result.crise_texto,
    }


# ─── Escriba clínico (Ambient Scribe, ADR-040) ──────────────────────────────


class EscribaRequest(BaseModel):
    # Teleconsulta: áudio pequeno via base64. Presencial (ADR-075): chave de um
    # blob que o browser já subiu via SAS PUT no container efêmero (o campo
    # mantém o nome legado s3_key no wire — ADR-082).
    # Exatamente um dos dois é enviado.
    content_type: str                    # "audio/webm" | "audio/mp4"
    paciente_id: UUID
    audio_base64: str | None = None      # caminho teleconsulta
    s3_key: str | None = None            # caminho presencial (chave no Blob)


@app.post(
    "/internal/escriba/transcrever",
    dependencies=[Depends(_check_internal_token)],
)
async def transcrever_escriba(req: EscribaRequest) -> dict:
    """Transcreve o áudio de uma consulta (diarizado) e gera um rascunho FACTUAL
    para o médico (ADR-040/ADR-075). NÃO gera diagnóstico/conduta (regra #1).
    Doctor-facing: não aciona protocolo de crise patient-facing (regra #2) — só marca
    mencao_risco. Transcrição via Azure Speech (ADR-082); no caminho presencial o
    blob efêmero é deletado logo após a transcrição (LGPD).

    Dois caminhos, exatamente um por request:
      • s3_key  → presencial: chave do blob que o browser já subiu (SAS).
      • audio_base64 → teleconsulta: áudio pequeno inline (cap 25 MB), sem storage."""
    import base64

    if req.s3_key:
        result = await gerar_rascunho_consulta_blob(
            req.s3_key, req.content_type, req.paciente_id
        )
    elif req.audio_base64:
        audio_bytes = base64.b64decode(req.audio_base64)
        if len(audio_bytes) > 25 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="áudio maior que 25 MB")
        result = await gerar_rascunho_consulta(
            audio_bytes, req.content_type, req.paciente_id
        )
    else:
        raise HTTPException(status_code=400, detail="informe s3_key ou audio_base64")

    return {
        "transcricao": result.transcricao,
        "rascunho": result.rascunho,
        "mencao_risco": result.mencao_risco,
    }


class TriarTextoRequest(BaseModel):
    texto: str
    paciente_id: UUID


@app.post(
    "/internal/diario/triar-texto",
    dependencies=[Depends(_check_internal_token)],
)
async def triar_texto_diario(req: TriarTextoRequest) -> dict:
    """Triagem de crise para entradas de diário DIGITADAS (texto).

    O gateway chama isto ANTES de salvar a entrada de texto. Se houver crise,
    aciona o protocolo (texto fixo de acolhimento, trilha, notifica médico,
    pausa automação) e devolve crise=True — o gateway então NÃO salva a entrada
    como nota comum e o front exibe o acolhimento.

    Não faz análise (humor/tags) — só triagem de risco. Fail-safe: erro no
    classificador → tratado como crise (regra #2 clinical-safety).
    """
    crise = await detectar_crise(req.texto)
    if not crise.crise_detectada:
        return {"crise": False, "crise_texto": None}

    async with acquire() as conn:
        texto = await acionar_protocolo_diario(
            conn, req.paciente_id, crise, origem="diario_texto"
        )
    return {"crise": True, "crise_texto": texto}


class TriggerCriseRequest(BaseModel):
    paciente_id: UUID
    motivo: str           # categoria do gatilho (ex.: "ideacao_suicida_phq9")
    nivel: str = "alto"   # nenhum|baixo|moderado|alto|critico


@app.post("/internal/crise/trigger", dependencies=[Depends(_check_internal_token)])
async def trigger_crise(req: TriggerCriseRequest) -> dict:
    """Aciona o protocolo de crise por um gatilho DETERMINÍSTICO (não-conversa):
    ex. item 9 do PHQ-9 (ideação) > 0. NÃO usa LLM — o gatilho já é certo, então
    construímos um CrisisDetectionOutput sintético (confiança 1.0). Reusa o núcleo
    (texto fixo de crisis_copy, trilha append-only, notifica médico, pausa
    automação). Idempotência não é exigida: cada acionamento é um evento de
    auditoria legítimo (append-only).
    """
    crise = CrisisDetectionOutput(
        crise_detectada=True,
        confianca=1.0,
        nivel=req.nivel,  # type: ignore[arg-type]
        gatilhos=[req.motivo],
    )
    titulo = "Protocolo de crise acionado (questionário PHQ-9)"
    mensagem = (
        f"O paciente sinalizou risco no item de ideação do PHQ-9 "
        f"(gatilho: {req.motivo}, nível {req.nivel}). A automação foi suspensa. "
        f"Resposta padrão de crise (v{CRISIS_COPY.versao}) foi exibida ao paciente."
    )
    async with acquire() as conn:
        texto = await acionar_protocolo(
            conn, req.paciente_id, crise, "questionario", titulo, mensagem
        )
    return {"crise": True, "crise_texto": texto}


@app.post(
    "/internal/agents/resumo_pre_consulta/run-on-demand",
    dependencies=[Depends(_check_internal_token)],
)
async def run_resumo_on_demand(req: RunForPatientRequest) -> dict:
    """Forca execucao do ResumidorAgent pra UM paciente, IGNORANDO find_pending.

    Diferente de /run-for-patient (que iteraria find_pending e desistiria se o
    paciente nao tem consulta agendada), este endpoint constroi um payload
    sintetico e dispara `_run_for_payload` direto. Usado pelo botao 'Gerar
    resumo' no dashboard medico, onde o medico decide quando quer o briefing
    independente de elegibilidade.
    """
    agent = ResumidorAgent()

    async with acquire() as conn:
        medico_id = await conn.fetchval(
            "SELECT medico_responsavel_id FROM pacientes WHERE cliente_id = $1",
            req.paciente_id,
        )
    if medico_id is None:
        raise HTTPException(
            status_code=404,
            detail="paciente sem medico_responsavel_id",
        )

    payload = AgentPayload(
        paciente_id=req.paciente_id,
        medico_id=medico_id,
        extra={
            "consulta_id": str(uuid4()),
            "consulta_inicia_em": (datetime.now(UTC) + timedelta(hours=24)).isoformat(),
            "consulta_modalidade": "on_demand",
        },
    )

    insight_id = await agent._run_for_payload(payload)
    return {
        "insight_id": str(insight_id) if insight_id else None,
        "on_demand": True,
    }


# ─── RAG (ADR-028) — indexação ─────────────────────────────────────────────


@app.post("/internal/rag/index/kb", dependencies=[Depends(_check_internal_token)])
async def rag_index_kb() -> dict:
    """Reindexa o catálogo de medicamentos (base de conhecimento global)."""
    return await reindexar_kb()


@app.post(
    "/internal/rag/index/paciente/{paciente_id}",
    dependencies=[Depends(_check_internal_token)],
)
async def rag_index_paciente(paciente_id: UUID) -> dict:
    """Reindexa o prontuário de um paciente (incremental por fonte_hash)."""
    try:
        return await reindexar_paciente(paciente_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


class RagBuscarRequest(BaseModel):
    # medico_id DEVE vir do JWT validado no gateway (tenant), NUNCA do browser.
    medico_id: UUID
    query: str
    paciente_id: UUID | None = None
    k: int | None = None
    fontes: list[str] | None = None
    incluir_kb: bool = True


@app.post("/internal/rag/buscar", dependencies=[Depends(_check_internal_token)])
async def rag_buscar(req: RagBuscarRequest) -> dict:
    """Busca semântica doctor-facing: devolve trechos citados (sem conduta gerada).

    Retrieval-only (regra #1). Tenant (`medico_id`) é a primeira cláusula do filtro
    e é responsabilidade do gateway derivá-lo do JWT — este endpoint é interno.
    """
    trechos = await rag_buscar_service(
        req.medico_id,
        query=req.query,
        paciente_id=req.paciente_id,
        k=req.k,
        fontes=req.fontes,
        incluir_kb=req.incluir_kb,
    )
    return {"trechos": [t.as_dict() for t in trechos]}
