"""Gate de custo diário de LLM (ADR-011).

Pausa o despacho de agentes batch NÃO-críticos quando o custo acumulado do dia
(America/Sao_Paulo) atinge ``MAX_DAILY_LLM_USD``. Regras inegociáveis:

* **Plano interativo** (orchestrator: crise/conversa) — NUNCA passa por aqui.
  Este módulo é importado só pelo scheduler do agents-py (plano batch).
* **risco_silencioso** (batch safety-relevant) — isento; nunca pausado por custo.
* **Fail-open**: se a contagem falhar (DB indisponível, etc.), o caller PROSSEGUE.
  Um teto de custo nunca pode derrubar o produto nem censurar caminho clínico — a
  trava real de dinheiro é o limite mensal de plataforma (Console da Anthropic).
* **Observável**: pausa e alertas (50/80/100%) vão para log estruturado; nunca
  silencioso.

Escopo do custo: tabela ``agente_execucoes`` (custo do plano batch). O custo do
plano interativo é coberto pela trava mensal de plataforma.
"""

from __future__ import annotations

from datetime import UTC, datetime
from zoneinfo import ZoneInfo

import structlog

from app.core.db import acquire

logger = structlog.get_logger(__name__)

_TZ_LOCAL = ZoneInfo("America/Sao_Paulo")

# Agentes safety-relevant: isentos do gate (ADR-011, ponto 2). Nunca pausados.
EXEMPT_AGENTS: frozenset[str] = frozenset({"risco_silencioso"})

# Thresholds de alerta, em % do teto diário. Emitidos uma vez por nível por dia.
ALERT_THRESHOLDS_PCT: tuple[int, ...] = (50, 80, 100)

# Estado in-process p/ dedupe de alerta (single-instance). A chave de data reseta
# o nível a cada dia local. Restart pode re-alertar — aceitável (não crítico).
_alert_state: dict[str, object] = {"date": "", "max_pct": 0}


def _today_start_utc(now: datetime | None = None) -> datetime:
    """Início do dia local (America/Sao_Paulo) convertido para UTC."""
    now_local = (now or datetime.now(_TZ_LOCAL)).astimezone(_TZ_LOCAL)
    start_local = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
    return start_local.astimezone(UTC)


async def get_daily_llm_cost_usd(now: datetime | None = None) -> float:
    """Soma ``custo_usd`` das execuções de agentes do dia local corrente.

    Best-effort: pode levantar em falha de DB — o caller é responsável pelo
    fail-open (ver :func:`should_dispatch`).
    """
    async with acquire() as conn:
        total = await conn.fetchval(
            """
            SELECT COALESCE(SUM(custo_usd), 0)::float8
            FROM agente_execucoes
            WHERE custo_usd IS NOT NULL
              AND iniciado_em >= $1
            """,
            _today_start_utc(now),
        )
    return float(total or 0.0)


def _alert_level(daily_cost: float, cap: float) -> int | None:
    """Maior threshold (%) cruzado por ``daily_cost``, ou ``None``. cap<=0 desliga."""
    if cap <= 0:
        return None
    pct = 100.0 * daily_cost / cap
    crossed = [t for t in ALERT_THRESHOLDS_PCT if pct >= t]
    return max(crossed) if crossed else None


def _maybe_alert(daily_cost: float, cap: float, now: datetime | None = None) -> None:
    """Emite alerta estruturado ao cruzar 50/80/100%, uma vez por nível por dia."""
    level = _alert_level(daily_cost, cap)
    if level is None:
        return
    today = (now or datetime.now(_TZ_LOCAL)).astimezone(_TZ_LOCAL).date().isoformat()
    if _alert_state["date"] != today:
        _alert_state["date"] = today
        _alert_state["max_pct"] = 0
    if level <= int(_alert_state["max_pct"]):
        return
    _alert_state["max_pct"] = level
    logger.warning(
        "llm_cost.alert",
        threshold_pct=level,
        daily_cost_usd=round(daily_cost, 4),
        max_daily_usd=cap,
        message=(
            f"Custo de LLM (batch) atingiu {level}% do teto diário: "
            f"${daily_cost:.2f} de ${cap:.2f}."
        ),
    )


async def should_dispatch(
    agent_name: str, cap: float, now: datetime | None = None
) -> bool:
    """Decide se ``agent_name`` pode ser despachado neste tick.

    ``True`` = pode rodar. Regras (ADR-011):

    * ``cap <= 0`` → gate desabilitado, sempre ``True``.
    * Erro ao contabilizar → ``True`` (fail-open) + log.
    * Agente isento (``risco_silencioso``) → sempre ``True`` (ainda dispara alerta).
    * Custo do dia ``>= cap`` → ``False`` (pausa só o batch não-crítico).
    """
    if cap <= 0:
        return True

    try:
        daily_cost = await get_daily_llm_cost_usd(now)
    except Exception as exc:  # fail-open: nunca derrubar o batch por erro de contagem
        logger.warning("llm_cost.count_failed", agente=agent_name, error=str(exc))
        return True

    _maybe_alert(daily_cost, cap, now)

    if agent_name in EXEMPT_AGENTS:
        return True  # safety-relevant: nunca pausado por custo

    if daily_cost >= cap:
        logger.warning(
            "llm_cost.batch_paused",
            agente=agent_name,
            daily_cost_usd=round(daily_cost, 4),
            max_daily_usd=cap,
        )
        return False
    return True
