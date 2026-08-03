"""Testes determinísticos do PadroesAgent.

Cobrem a função `_analisar_serie`, `_avaliar_triggers_variavel` e
`_avaliar_severidade_global` sem chamadas a DB ou LLM.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from app.agents.padroes import (
    AnalisePadraoPorVariavel,
    MetricasPadroes,
    _analisar_serie,
    _avaliar_severidade_global,
    _avaliar_triggers_variavel,
)
from app.core.config import get_settings


def _datas_diarias(n: int) -> list[datetime]:
    base = datetime(2026, 5, 1, tzinfo=UTC)
    return [base + timedelta(days=i) for i in range(n)]


def test_humor_decrescente_dispara_trigger_negativo():
    settings = get_settings()
    # Humor caindo de ~8 para ~3 em 14 dias
    valores = [8, 7, 8, 7, 6, 6, 5, 5, 4, 4, 3, 3, 3, 2]
    momentos = _datas_diarias(len(valores))
    a = _analisar_serie("humor", "decrescente", valores, momentos, settings=settings)

    assert a.slope_por_semana is not None
    assert a.slope_por_semana < -0.5  # caindo mais de 0.5/semana
    assert any(t.startswith("tendencia_humor") for t in a.triggers)
    assert any("negativa" in t for t in a.triggers)


def test_serie_estavel_nao_dispara():
    settings = get_settings()
    valores = [5, 5, 5, 5, 5, 5, 5, 5, 5, 5]
    momentos = _datas_diarias(len(valores))
    a = _analisar_serie("humor", "decrescente", valores, momentos, settings=settings)
    assert a.triggers == []


def test_volatilidade_humor_dispara():
    settings = get_settings()
    # Humor oscilando entre 1 e 9 (alta volatilidade real)
    valores = [9, 1, 8, 2, 9, 1, 7, 2, 8, 3]
    momentos = _datas_diarias(len(valores))
    a = _analisar_serie("humor", "decrescente", valores, momentos, settings=settings)

    # stddev de uma série assim deve estar bem acima de 2.8
    assert a.stddev > 2.8
    assert "volatilidade_humor_alta" in a.triggers


def test_amostra_insuficiente_no_op():
    settings = get_settings()
    valores = [8, 7, 6]
    momentos = _datas_diarias(len(valores))
    a = _analisar_serie("humor", "decrescente", valores, momentos, settings=settings)
    assert a.slope_por_semana is None
    assert a.triggers == []


def test_step_change_detectado():
    settings = get_settings()
    # Primeira metade estável em 7, segunda metade desceu para 3
    valores = [7, 7, 7, 8, 7, 3, 3, 3, 2, 3]
    momentos = _datas_diarias(len(valores))
    a = _analisar_serie("humor", "decrescente", valores, momentos, settings=settings)

    assert a.step_change_diff is not None
    assert a.step_change_diff < -1.5  # queda > 1.5
    assert any(t.startswith("step_change_humor") for t in a.triggers)
    assert any("negativo" in t for t in a.triggers)


def test_ansiedade_crescente_e_negativa():
    """Ansiedade subindo é o cenário negativo (oposto de humor)."""
    settings = get_settings()
    valores = [2, 3, 3, 4, 4, 5, 6, 7, 7, 8, 8, 9, 9]
    momentos = _datas_diarias(len(valores))
    a = _analisar_serie("ansiedade", "crescente", valores, momentos, settings=settings)
    assert any(t.startswith("tendencia_ansiedade") and "negativa" in t for t in a.triggers)


def test_humor_crescente_e_positivo():
    """Humor subindo é positivo (paciente melhorando)."""
    settings = get_settings()
    valores = [3, 3, 4, 4, 5, 5, 6, 7, 7, 8]
    momentos = _datas_diarias(len(valores))
    a = _analisar_serie("humor", "decrescente", valores, momentos, settings=settings)
    assert any(t.startswith("tendencia_humor") and "positiva" in t for t in a.triggers)


def test_severidade_combinatoria_humor_e_ansiedade():
    """Humor decrescente + ansiedade crescente → alta."""
    a_humor = AnalisePadraoPorVariavel(
        variavel="humor",
        direcao_negativa="decrescente",
        count=14, media=5, stddev=1.5, minimo=2, maximo=8,
        triggers=["tendencia_humor_negativa"],
    )
    a_ansiedade = AnalisePadraoPorVariavel(
        variavel="ansiedade",
        direcao_negativa="crescente",
        count=14, media=7, stddev=1.5, minimo=4, maximo=9,
        triggers=["tendencia_ansiedade_negativa"],
    )
    m = MetricasPadroes(
        janela_dias=30,
        janela_inicio=datetime.now(UTC) - timedelta(days=30),
        janela_fim=datetime.now(UTC),
        analises=[a_humor, a_ansiedade],
    )
    _avaliar_severidade_global(m)
    assert m.severidade_algoritmica == "alta"


def test_severidade_critica_volatilidade_alta_em_humor_decrescente():
    """Volatilidade alta em humor + tendência humor negativa → critica."""
    a = AnalisePadraoPorVariavel(
        variavel="humor",
        direcao_negativa="decrescente",
        count=14, media=4, stddev=3.0, minimo=1, maximo=9,
        triggers=["tendencia_humor_negativa", "volatilidade_humor_alta"],
    )
    m = MetricasPadroes(
        janela_dias=30,
        janela_inicio=datetime.now(UTC) - timedelta(days=30),
        janela_fim=datetime.now(UTC),
        analises=[a],
    )
    _avaliar_severidade_global(m)
    assert m.severidade_algoritmica == "critica"


def test_sem_triggers_negativos_severidade_info():
    """Triggers só positivos → info (insight informativo, melhora)."""
    a = AnalisePadraoPorVariavel(
        variavel="humor",
        direcao_negativa="decrescente",
        count=14, media=6, stddev=1.0, minimo=4, maximo=8,
        triggers=["tendencia_humor_positiva"],
    )
    m = MetricasPadroes(
        janela_dias=30,
        janela_inicio=datetime.now(UTC) - timedelta(days=30),
        janela_fim=datetime.now(UTC),
        analises=[a],
    )
    _avaliar_severidade_global(m)
    assert m.severidade_algoritmica == "info"


def test_sem_padroes_nada_para_reportar():
    """Nenhuma variável com trigger → triggers_globais vazio."""
    a = AnalisePadraoPorVariavel(
        variavel="humor",
        direcao_negativa="decrescente",
        count=14, media=6, stddev=1.0, minimo=4, maximo=8,
        triggers=[],
    )
    m = MetricasPadroes(
        janela_dias=30,
        janela_inicio=datetime.now(UTC) - timedelta(days=30),
        janela_fim=datetime.now(UTC),
        analises=[a],
    )
    _avaliar_severidade_global(m)
    assert m.triggers_globais == []


@pytest.mark.parametrize(
    "stddev,esperado_trigger",
    [
        (0.5, []),
        (1.5, []),
        (2.1, ["volatilidade_humor_media"]),
        (3.0, ["volatilidade_humor_alta"]),
    ],
)
def test_thresholds_volatilidade(stddev, esperado_trigger):
    settings = get_settings()
    a = AnalisePadraoPorVariavel(
        variavel="humor",
        direcao_negativa="decrescente",
        count=10, media=5, stddev=stddev, minimo=2, maximo=8,
    )
    _avaliar_triggers_variavel(a, settings)
    for t in esperado_trigger:
        assert t in a.triggers
