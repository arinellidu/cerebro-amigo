"""Testes da lógica de triggers do RiscoSilenciosoAgent.

Sem DB nem LLM. Cobre apenas `_avaliar_triggers`.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from app.agents.risco_silencioso import (
    MetricasRiscoSilencioso,
    RiscoSilenciosoAgent,
    SinalNegativo,
    _percentile,
)


def _m(**kw) -> MetricasRiscoSilencioso:
    return MetricasRiscoSilencioso(**kw)


def _sinal(tipo: str) -> SinalNegativo:
    return SinalNegativo(
        tipo=tipo,  # type: ignore[arg-type]
        detalhe="sintético",
        quando=datetime.now(UTC) - timedelta(days=3),
    )


def test_sem_atividade_no_historico_nao_dispara():
    m = _m(dias_desde_ultima_atividade=None)
    RiscoSilenciosoAgent()._avaliar_triggers(m)
    assert m.triggers == []
    assert m.severidade_algoritmica == "info"


def test_ausencia_curta_nao_dispara():
    m = _m(dias_desde_ultima_atividade=3)
    RiscoSilenciosoAgent()._avaliar_triggers(m)
    assert m.triggers == []


def test_ausencia_absoluta_14d_dispara_media():
    m = _m(dias_desde_ultima_atividade=14)
    RiscoSilenciosoAgent()._avaliar_triggers(m)
    assert "ausencia_absoluta" in m.triggers
    assert m.severidade_algoritmica == "media"


def test_ausencia_atipica_por_historico_dispara_media():
    # p95 = 4 dias * 1.5 = 6 dias. Paciente sumido 10 dias é atípico,
    # mas ainda não atingiu 14d absoluto.
    m = _m(
        dias_desde_ultima_atividade=10,
        intervalos_historicos_dias=[2, 3, 4, 5, 3, 4, 6],
        p95_intervalo_historico=6.0,
        amostras_suficientes=True,
    )
    RiscoSilenciosoAgent()._avaliar_triggers(m)
    assert "ausencia_atipica_para_paciente" in m.triggers
    assert "ausencia_absoluta" not in m.triggers
    assert m.severidade_algoritmica == "media"


def test_historico_sem_amostra_minima_so_usa_absoluto():
    # Mesmo paciente, mas histórico curto (não temos 5 intervalos):
    # só threshold absoluto vale. 10 dias não dispara.
    m = _m(
        dias_desde_ultima_atividade=10,
        intervalos_historicos_dias=[2, 3],
        p95_intervalo_historico=None,
        amostras_suficientes=False,
    )
    RiscoSilenciosoAgent()._avaliar_triggers(m)
    assert m.triggers == []


def test_ausencia_com_um_sinal_negativo_escala_alta():
    m = _m(
        dias_desde_ultima_atividade=15,
        sinais_negativos_pre_silencio=[_sinal("humor_baixo_mensagem")],
    )
    RiscoSilenciosoAgent()._avaliar_triggers(m)
    assert "ausencia_absoluta" in m.triggers
    assert "sinal_negativo_pre_silencio" in m.triggers
    assert m.severidade_algoritmica == "alta"


def test_ausencia_com_dois_sinais_distintos_escala_critica():
    m = _m(
        dias_desde_ultima_atividade=15,
        sinais_negativos_pre_silencio=[
            _sinal("humor_baixo_mensagem"),
            _sinal("medicacao_esquecida"),
        ],
    )
    RiscoSilenciosoAgent()._avaliar_triggers(m)
    assert "multiplos_sinais_negativos_pre_silencio" in m.triggers
    assert m.severidade_algoritmica == "critica"


def test_sinais_repetidos_mesmo_tipo_nao_contam_duas_vezes():
    # 3 sinais do mesmo tipo (humor_baixo_mensagem) ainda contam como 1
    m = _m(
        dias_desde_ultima_atividade=15,
        sinais_negativos_pre_silencio=[
            _sinal("humor_baixo_mensagem"),
            _sinal("humor_baixo_mensagem"),
            _sinal("humor_baixo_mensagem"),
        ],
    )
    RiscoSilenciosoAgent()._avaliar_triggers(m)
    assert m.severidade_algoritmica == "alta"  # não critica


def test_crise_muito_recente_escala_critica_diretamente():
    # Apenas 1 sinal, mas é crise nos últimos 14d → critica
    m = _m(
        dias_desde_ultima_atividade=15,
        sinais_negativos_pre_silencio=[_sinal("crise_muito_recente")],
    )
    RiscoSilenciosoAgent()._avaliar_triggers(m)
    assert "crise_muito_recente_pre_silencio" in m.triggers
    assert m.severidade_algoritmica == "critica"


def test_crise_recente_30d_conta_como_um_sinal_normal():
    # Crise entre 14 e 30 dias atrás é "recente" mas não "muito recente"
    m = _m(
        dias_desde_ultima_atividade=15,
        sinais_negativos_pre_silencio=[_sinal("crise_recente")],
    )
    RiscoSilenciosoAgent()._avaliar_triggers(m)
    # 1 sinal → alta (não critica)
    assert m.severidade_algoritmica == "alta"


def test_sinais_sem_ausencia_nao_dispara():
    # Sinais negativos isolados, paciente ainda interage → não é silêncio
    m = _m(
        dias_desde_ultima_atividade=2,
        sinais_negativos_pre_silencio=[
            _sinal("humor_baixo_mensagem"),
            _sinal("medicacao_esquecida"),
            _sinal("crise_muito_recente"),
        ],
    )
    RiscoSilenciosoAgent()._avaliar_triggers(m)
    assert m.triggers == []
    assert m.severidade_algoritmica == "info"


@pytest.mark.parametrize(
    ("dias", "p95", "amostras", "esperado_critica"),
    [
        (14, None, False, False),   # 14d só absoluto → media
        (20, 5.0, True, False),     # 20d > 14 e > p95*1.5 → media (sem sinais)
        (10, 4.0, True, False),     # 10 > 6 → atipico → media
        (5, 2.0, True, False),      # 5 > 3 → atipico → media
    ],
)
def test_combinacoes_ausencia(dias, p95, amostras, esperado_critica):
    m = _m(
        dias_desde_ultima_atividade=dias,
        p95_intervalo_historico=p95,
        amostras_suficientes=amostras,
        intervalos_historicos_dias=[1] * 10 if amostras else [],
    )
    RiscoSilenciosoAgent()._avaliar_triggers(m)
    # Pelo menos um trigger deve estar ativo
    assert len(m.triggers) > 0
    # Sem sinais negativos → severidade é media, não critica
    assert (m.severidade_algoritmica == "critica") == esperado_critica


def test_percentile_helper():
    assert _percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50) == pytest.approx(5.5, abs=0.5)
    # P95 de 1..20 deve estar perto de 19
    p95 = _percentile(list(range(1, 21)), 95)
    assert 18 <= p95 <= 20
    # Caso com um valor só
    assert _percentile([5], 95) == 5.0
    assert _percentile([], 95) == 0.0
