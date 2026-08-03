"""Testes da lógica de avaliação de triggers do AdesaoAgent.

Sem chamadas a DB ou LLM. Cobre a função `_avaliar_triggers` que aplica
thresholds objetivos sobre as métricas calculadas.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest

from app.agents.adesao import AdesaoAgent, MetricasAdesao, TaxaPorPrescricao, _max_sev


def _empty_metricas(**overrides) -> MetricasAdesao:
    now = datetime.now(UTC)
    base = {
        "janela_dias": 30,
        "janela_inicio": now - timedelta(days=30),
        "janela_fim": now,
        "tem_prescricoes": True,
    }
    base.update(overrides)
    return MetricasAdesao(**base)


def test_sem_problemas_nao_dispara():
    m = _empty_metricas(
        taxa_global=0.95,
        max_consecutivas_perdidas=1,
        contagem_mensagens=5,
        dias_desde_ultima_atividade=1,
    )
    AdesaoAgent()._avaliar_triggers(m)
    assert m.triggers == []
    assert m.severidade_algoritmica == "info"


def test_taxa_global_baixa_dispara_media():
    m = _empty_metricas(taxa_global=0.65)
    AdesaoAgent()._avaliar_triggers(m)
    assert "taxa_global_baixa" in m.triggers
    assert m.severidade_algoritmica == "media"


def test_taxa_global_critica_dispara_alta():
    m = _empty_metricas(taxa_global=0.40)
    AdesaoAgent()._avaliar_triggers(m)
    assert "taxa_global_critica" in m.triggers
    assert m.severidade_algoritmica == "alta"


def test_consecutivas_perdidas_media():
    m = _empty_metricas(taxa_global=0.85, max_consecutivas_perdidas=3)
    AdesaoAgent()._avaliar_triggers(m)
    assert "consecutivas_perdidas" in m.triggers
    assert m.severidade_algoritmica == "media"


def test_consecutivas_perdidas_alta():
    m = _empty_metricas(taxa_global=0.85, max_consecutivas_perdidas=5)
    AdesaoAgent()._avaliar_triggers(m)
    assert "consecutivas_perdidas_critica" in m.triggers
    assert m.severidade_algoritmica == "alta"


def test_trend_negativo_dispara():
    m = _empty_metricas(taxa_global=0.85, trend_pp=-20.0)
    AdesaoAgent()._avaliar_triggers(m)
    assert "trend_medicacao_negativo" in m.triggers


def test_inatividade_comportamental():
    m = _empty_metricas(
        tem_prescricoes=False,
        dias_desde_ultima_atividade=10,
    )
    AdesaoAgent()._avaliar_triggers(m)
    assert "inatividade_comportamental" in m.triggers


def test_queda_engajamento():
    m = _empty_metricas(
        tem_prescricoes=False,
        engajamento_janela_anterior=20,
        contagem_mensagens=2,
        contagem_diario_compartilhado=0,
        contagem_checkins_respondidos=2,
        queda_engajamento_pct=-0.80,
    )
    AdesaoAgent()._avaliar_triggers(m)
    assert "queda_engajamento" in m.triggers


def test_queda_engajamento_ignora_amostra_pequena():
    m = _empty_metricas(
        tem_prescricoes=False,
        engajamento_janela_anterior=2,  # < 5
        contagem_mensagens=0,
        queda_engajamento_pct=-1.0,
    )
    AdesaoAgent()._avaliar_triggers(m)
    assert "queda_engajamento" not in m.triggers


def test_prescricao_individual_critica():
    m = _empty_metricas(
        taxa_global=0.85,
        taxas_por_prescricao=[
            TaxaPorPrescricao(
                prescricao_id=uuid4(),
                medicamento="Sertralina",
                dose_descricao="50mg manhã",
                total_doses=30,
                tomadas=28,
                taxa=0.93,
            ),
            TaxaPorPrescricao(
                prescricao_id=uuid4(),
                medicamento="Quetiapina",
                dose_descricao="25mg noite",
                total_doses=30,
                tomadas=12,
                taxa=0.40,
            ),
        ],
    )
    AdesaoAgent()._avaliar_triggers(m)
    assert "prescricao_individual_critica" in m.triggers
    assert m.severidade_algoritmica == "alta"


def test_escalada_critica_combinatoria():
    m = _empty_metricas(
        taxa_global=0.40,             # critica
        max_consecutivas_perdidas=6,  # critica
    )
    AdesaoAgent()._avaliar_triggers(m)
    # 2+ triggers _critica deveriam escalar pra critica
    assert m.severidade_algoritmica == "critica"


def test_sem_prescricoes_so_avalia_comportamento():
    m = _empty_metricas(
        tem_prescricoes=False,
        taxa_global=None,
        max_consecutivas_perdidas=None,
        dias_desde_ultima_atividade=2,
        contagem_mensagens=10,
    )
    AdesaoAgent()._avaliar_triggers(m)
    # Sem prescrição + comportamento ativo → sem triggers
    assert m.triggers == []


def test_max_sev_helper():
    assert _max_sev("info", "media", "info") == "media"
    assert _max_sev("info") == "info"
    assert _max_sev("media", "alta", "media") == "alta"
    assert _max_sev("critica", "alta") == "critica"
    assert _max_sev() == "info"


@pytest.mark.parametrize(
    ("entrada", "esperada"),
    [
        ({"taxa_global": 0.95}, "info"),
        ({"taxa_global": 0.69}, "media"),
        ({"taxa_global": 0.30}, "alta"),
        ({"max_consecutivas_perdidas": 2}, "info"),
        ({"max_consecutivas_perdidas": 4}, "media"),
        ({"max_consecutivas_perdidas": 7}, "alta"),
    ],
)
def test_thresholds_progressivos(entrada, esperada):
    m = _empty_metricas(**entrada)
    AdesaoAgent()._avaliar_triggers(m)
    assert m.severidade_algoritmica == esperada
