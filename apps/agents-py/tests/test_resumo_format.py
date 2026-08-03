"""Testes do formatter de resumo (sem chamar LLM)."""

from __future__ import annotations

from app.agents.resumidor import ResumoLLMOutput, _format_resumo_markdown


def test_format_full():
    out = ResumoLLMOutput(
        titulo="Sono fragmentado e ansiedade elevada nas últimas 2 semanas",
        pontos_chave=[
            "Relata sono < 5h na maioria dos dias.",
            "Ansiedade autorreportada em 7-8/10.",
        ],
        adesao_observada="Adesão inconsistente: 60% das doses registradas no período.",
        sinais_de_alerta=["Pico de ansiedade após reduzir dose autonomamente em 18/05."],
        sugestoes_topicos=["Revisar tolerância ao tratamento.", "Discutir higiene do sono."],
        severidade="media",
    )
    md = _format_resumo_markdown(out)
    assert md.startswith("## Sono fragmentado")
    assert "### Pontos-chave" in md
    assert "### Adesão" in md
    assert "### Sinais de alerta" in md
    assert "### Sugestões de tópicos para a consulta" in md


def test_format_minimal_no_alerts():
    out = ResumoLLMOutput(
        titulo="Quadro estável",
        pontos_chave=[],
        adesao_observada="Adesão boa.",
        sinais_de_alerta=[],
        sugestoes_topicos=[],
        severidade="info",
    )
    md = _format_resumo_markdown(out)
    assert "## Quadro estável" in md
    assert "### Adesão" in md
    assert "### Sinais de alerta" not in md
    assert "### Sugestões de tópicos" not in md
