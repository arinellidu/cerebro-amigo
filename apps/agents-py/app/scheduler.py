"""APScheduler — dispara cada agente na sua cadência individual.

Cadências configuráveis por variável de ambiente (ver core/config.py):
  - resumo_pre_consulta / diario: RESUMIDOR_INTERVAL_SECONDS / DIARIO_INTERVAL_SECONDS
    → curtos (5 min default), precisam pegar a janela de consulta rápido.
  - adesao:          ADESAO_INTERVAL_HOURS (default 6h)
  - padroes:         PADROES_INTERVAL_HOURS (default 12h — scipy é pesado)
  - risco_silencioso: RISCO_SILENCIOSO_INTERVAL_HOURS (default 24h)
    NOTA: dedup_window_hours=168 (7 dias). Com cadência de 24h, 6/7 disparos
    escanearão todos os pacientes mas serão descartados pela dedup window.
    Fix real: ADR-014 (dedup-no-SQL em _listar_candidatos). Até lá, as 6 varreduras
    extras são baratas (< N SELECT por paciente, sem LLM) mas não ideais.

Todos os jobs operacionais (gerador_checkins_medicacao, gerador_questionarios) usam
SCHEDULER_INTERVAL_SECONDS para manter frequência alta.

Start dates escalonados (offset por agente) evitam o burst de todos os agentes
disparando no mesmo instante no boot — agentes de hora longa esperam 1-3 min antes
do primeiro tick.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import structlog
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

from app.agents import AGENT_REGISTRY, get_agent
from app.core.config import get_settings
from app.core.cost_gate import should_dispatch
from app.jobs import JOB_REGISTRY, get_job

logger = structlog.get_logger(__name__)

_scheduler: AsyncIOScheduler | None = None


# ─── Definição de cadência por agente ──────────────────────────────────────

@dataclass(frozen=True)
class _Schedule:
    """Cadência de um agente/job no scheduler."""

    # Exatamente um dos dois deve ser fornecido.
    interval_seconds: int | None = None
    interval_hours: int | None = None

    # Segundos de espera após o boot antes do primeiro tick.
    # Usado para escalonar disparos e evitar burst simultâneo no startup.
    start_offset_s: int = 0

    # Jitter (±segundos) para variar execuções entre reinícios consecutivos.
    # Relevante para agentes horários — evita colisões no mesmo segundo.
    jitter_s: int = 0

    def trigger(self) -> IntervalTrigger:
        start = datetime.now(UTC) + timedelta(seconds=self.start_offset_s)
        kwargs: dict = {"start_date": start}
        if self.jitter_s:
            kwargs["jitter"] = self.jitter_s
        if self.interval_hours is not None:
            return IntervalTrigger(hours=self.interval_hours, **kwargs)
        return IntervalTrigger(seconds=self.interval_seconds, **kwargs)

    def describe(self) -> str:
        if self.interval_hours is not None:
            return f"{self.interval_hours}h"
        return f"{self.interval_seconds}s"


def _build_agent_schedules() -> dict[str, _Schedule]:
    """Constrói o mapa agente→cadência a partir das settings.

    Chamado dentro de start_scheduler() para que os start_dates sejam
    relativos ao momento do boot, não ao import do módulo.
    """
    s = get_settings()
    return {
        # Agentes sensíveis à janela de consulta — disparo rápido.
        "resumo_pre_consulta": _Schedule(
            interval_seconds=s.resumidor_interval_seconds,
            start_offset_s=0,
        ),
        "diario": _Schedule(
            interval_seconds=s.diario_interval_seconds,
            start_offset_s=15,    # 15s após resumidor para não coincidir
        ),

        # Agentes analíticos — cadência longa, escalonados no boot.
        "adesao": _Schedule(
            interval_hours=s.adesao_interval_hours,
            start_offset_s=60,    # espera 1 min antes do 1º tick
            jitter_s=60,
        ),
        "padroes": _Schedule(
            interval_hours=s.padroes_interval_hours,
            start_offset_s=120,   # espera 2 min
            jitter_s=60,
        ),
        "risco_silencioso": _Schedule(
            interval_hours=s.risco_silencioso_interval_hours,
            start_offset_s=180,   # espera 3 min
            jitter_s=120,
            # FIXME ADR-014: com dedup_window=168h e cadência de 24h,
            # 6 dos 7 disparos semanais escaneiam todos os pacientes
            # e descartam via dedup. Implementar dedup-no-SQL em
            # _listar_candidatos para eliminar esse desperdício.
        ),
        # Desfecho (Measurement-Based Care, ADR-027): determinístico, sem LLM.
        # Cadência diária; dedup_window=168h limita a 1 insight/paciente/semana.
        "desfecho": _Schedule(
            interval_hours=24,
            start_offset_s=240,   # após os demais analíticos
            jitter_s=120,
        ),
    }


# ─── Tick handlers ─────────────────────────────────────────────────────────

async def _tick_agent(name: str) -> None:
    """Roda um ciclo de um agente, com isolamento de falhas."""
    log = logger.bind(agente=name)

    # Gate de custo diário (ADR-011): pausa batch NÃO-crítico ao estourar o teto.
    # risco_silencioso é isento; fail-open se a contagem falhar. NUNCA afeta o
    # plano interativo (crise/conversa do orchestrator — não passa por aqui).
    settings = get_settings()
    if not await should_dispatch(name, settings.max_daily_llm_usd):
        return

    try:
        agent = get_agent(name)
        stats = await agent.run_once()
        log.info("scheduler.tick.done", **stats)
    except Exception as exc:
        log.exception("scheduler.tick.failed", error=str(exc))


async def _tick_job(name: str) -> None:
    """Roda um ciclo de um job, com isolamento de falhas."""
    log = logger.bind(job=name)
    try:
        job = get_job(name)
        stats = await job.run_once()
        log.info("scheduler.job_tick.done", **stats)
    except Exception as exc:
        log.exception("scheduler.job_tick.failed", error=str(exc))


async def _tick_rag_index() -> None:
    """Reindexação RAG (ADR-028) — cadência longa, fora do JOB_REGISTRY curto."""
    log = logger.bind(job="indexador_rag")
    try:
        from app.jobs.indexador_rag import IndexadorRagJob

        stats = await IndexadorRagJob().run_once()
        log.info("scheduler.rag_tick.done", **stats)
    except Exception as exc:
        log.exception("scheduler.rag_tick.failed", error=str(exc))


# ─── Ciclo de vida ─────────────────────────────────────────────────────────

def start_scheduler() -> AsyncIOScheduler:
    global _scheduler
    if _scheduler is not None:
        return _scheduler

    settings = get_settings()
    agent_schedules = _build_agent_schedules()

    sched = AsyncIOScheduler(timezone="UTC")

    # Agentes analíticos — cadência individual por agente.
    for agent_name in AGENT_REGISTRY:
        schedule = agent_schedules.get(
            agent_name,
            # Fallback: qualquer agente futuro não mapeado usa o intervalo global.
            _Schedule(interval_seconds=settings.scheduler_interval_seconds, start_offset_s=0),
        )
        sched.add_job(
            _tick_agent,
            trigger=schedule.trigger(),
            args=[agent_name],
            id=f"tick:{agent_name}",
            replace_existing=True,
            coalesce=True,       # se atrasar, não acumular execuções
            max_instances=1,     # nunca dois ticks paralelos do mesmo agente
        )
        logger.info(
            "scheduler.agent.registered",
            agente=agent_name,
            cadencia=schedule.describe(),
            start_offset_s=schedule.start_offset_s,
        )

    # Jobs operacionais — mantêm cadência curta (gerador_checkins, questionários).
    # Escalonados entre si com pequenos offsets para não coincidirem no mesmo tick.
    job_names = list(JOB_REGISTRY.keys())
    for i, job_name in enumerate(job_names):
        job_offset = 240 + i * 30   # 240s, 270s, ... após o boot
        job_schedule = _Schedule(
            interval_seconds=settings.scheduler_interval_seconds,
            start_offset_s=job_offset,
        )
        sched.add_job(
            _tick_job,
            trigger=job_schedule.trigger(),
            args=[job_name],
            id=f"tick:job:{job_name}",
            replace_existing=True,
            coalesce=True,
            max_instances=1,
        )
        logger.info(
            "scheduler.job.registered",
            job=job_name,
            cadencia=job_schedule.describe(),
            start_offset_s=job_offset,
        )

    # Indexador RAG (ADR-028) — cadência longa (RAG_INDEX_INTERVAL_HOURS), reindex
    # incremental do corpus. Fora do loop de jobs (que é de cadência curta).
    if settings.embeddings_enabled:
        rag_schedule = _Schedule(
            interval_hours=settings.rag_index_interval_hours,
            start_offset_s=300,   # bem após os demais no boot
            jitter_s=120,
        )
        sched.add_job(
            _tick_rag_index,
            trigger=rag_schedule.trigger(),
            id="tick:rag_index",
            replace_existing=True,
            coalesce=True,
            max_instances=1,
        )
        logger.info(
            "scheduler.rag_index.registered",
            cadencia=rag_schedule.describe(),
            start_offset_s=300,
        )

    sched.start()
    _scheduler = sched
    return sched


def shutdown_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None


# ─── Disparo manual (endpoints HTTP) ───────────────────────────────────────

async def run_once(name: str) -> dict:
    """Disparo manual síncrono — usado pelos endpoints HTTP."""
    agent = get_agent(name)
    return await agent.run_once()


async def run_for_patient(name: str, paciente_id) -> dict:
    """Disparo manual focado em um paciente — útil para testes e bypass.

    Percorre o find_pending do agente e processa o primeiro payload cujo
    paciente_id bate. Respeita a lógica de elegibilidade do agente (consulta
    agendada para resumidor, triggers ativos para adesao, etc.) e dispara
    _run_for_payload que ignora dedup window propositadamente — endpoint
    manual é para forçar nova execução.

    Se o agente não considera o paciente "pending" agora, retorna sem criar
    insight, explicitando o motivo.
    """
    agent = get_agent(name)

    async for payload in agent.find_pending():
        if payload.paciente_id == paciente_id:
            insight_id = await agent._run_for_payload(payload)
            return {
                "insight_id": str(insight_id) if insight_id else None,
                "payload_extra": payload.extra,
            }

    return {
        "insight_id": None,
        "message": (
            "Agente não considera o paciente elegível no momento. "
            "Possíveis razões: triggers não atingidos, sem consulta "
            "agendada, ou contexto insuficiente."
        ),
    }


__all__ = ["run_for_patient", "run_once", "shutdown_scheduler", "start_scheduler"]
