"""Testes do gate de custo diário de LLM (ADR-011).

Foco nas regras inegociáveis: risco_silencioso isento, fail-open, gate só pausa
batch não-crítico, alertas em 50/80/100% uma vez por nível.
"""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from app.core import cost_gate

_TZ = ZoneInfo("America/Sao_Paulo")


# ─── _alert_level: fronteiras ──────────────────────────────────────────────

@pytest.mark.parametrize(
    "cost,cap,expected",
    [
        (0.0, 5.0, None),
        (2.49, 5.0, None),   # 49.8% → nada
        (2.5, 5.0, 50),      # 50% exato
        (3.9, 5.0, 50),      # 78% → 50
        (4.0, 5.0, 80),      # 80% exato
        (4.99, 5.0, 80),     # 99.8% → 80
        (5.0, 5.0, 100),     # 100% exato
        (7.5, 5.0, 100),     # 150% → 100
        (10.0, 0.0, None),   # cap<=0 desabilita
        (10.0, -1.0, None),
    ],
)
def test_alert_level_fronteiras(cost, cap, expected):
    assert cost_gate._alert_level(cost, cap) == expected


# ─── should_dispatch: regras do gate ───────────────────────────────────────

@pytest.fixture(autouse=True)
def _reset_alert_state():
    cost_gate._alert_state["date"] = ""
    cost_gate._alert_state["max_pct"] = 0
    yield


def _patch_cost(monkeypatch, value):
    async def _fake(now=None):
        return value
    monkeypatch.setattr(cost_gate, "get_daily_llm_cost_usd", _fake)


@pytest.mark.asyncio
async def test_cap_zero_desabilita_gate(monkeypatch):
    # cap<=0 → sempre despacha, nem consulta custo
    async def _boom(now=None):
        raise AssertionError("não deveria consultar custo com cap<=0")
    monkeypatch.setattr(cost_gate, "get_daily_llm_cost_usd", _boom)
    assert await cost_gate.should_dispatch("adesao", 0.0) is True
    assert await cost_gate.should_dispatch("adesao", -5.0) is True


@pytest.mark.asyncio
async def test_batch_nao_critico_abaixo_do_teto_roda(monkeypatch):
    _patch_cost(monkeypatch, 3.0)
    assert await cost_gate.should_dispatch("adesao", 5.0) is True


@pytest.mark.asyncio
async def test_batch_nao_critico_no_teto_pausa(monkeypatch):
    _patch_cost(monkeypatch, 5.0)
    assert await cost_gate.should_dispatch("adesao", 5.0) is False
    _patch_cost(monkeypatch, 6.2)
    assert await cost_gate.should_dispatch("padroes", 5.0) is False


@pytest.mark.asyncio
async def test_risco_silencioso_isento_mesmo_acima_do_teto(monkeypatch):
    # Safety-relevant: NUNCA pausado por custo, mesmo muito acima do teto.
    _patch_cost(monkeypatch, 999.0)
    assert await cost_gate.should_dispatch("risco_silencioso", 5.0) is True


@pytest.mark.asyncio
async def test_fail_open_quando_contagem_falha(monkeypatch):
    # Erro ao contar custo → prossegue (fail-open), inclusive batch não-crítico.
    async def _boom(now=None):
        raise RuntimeError("DB indisponível")
    monkeypatch.setattr(cost_gate, "get_daily_llm_cost_usd", _boom)
    assert await cost_gate.should_dispatch("adesao", 5.0) is True


# ─── alertas: emitidos uma vez por nível por dia ───────────────────────────

@pytest.mark.asyncio
async def test_alerta_emitido_uma_vez_por_nivel(monkeypatch):
    eventos: list[int] = []

    def _capture(event, **kw):
        if event == "llm_cost.alert":
            eventos.append(kw["threshold_pct"])

    monkeypatch.setattr(cost_gate.logger, "warning", _capture)

    _patch_cost(monkeypatch, 4.0)  # 80%
    await cost_gate.should_dispatch("adesao", 5.0)
    await cost_gate.should_dispatch("padroes", 5.0)  # mesmo nível → sem novo alerta
    assert eventos == [80]

    _patch_cost(monkeypatch, 5.0)  # sobe p/ 100%
    await cost_gate.should_dispatch("adesao", 5.0)
    assert eventos == [80, 100]


# ─── fronteira do dia: America/Sao_Paulo ───────────────────────────────────

def test_today_start_utc_usa_timezone_local():
    # 2026-06-11 00:30 em SP (UTC-3) → início do dia local = 2026-06-11 03:00 UTC.
    now_sp = datetime(2026, 6, 11, 0, 30, tzinfo=_TZ)
    start = cost_gate._today_start_utc(now_sp)
    assert start.hour == 3
    assert start.day == 11
    assert str(start.tzinfo) in ("UTC", "datetime.timezone.utc")
