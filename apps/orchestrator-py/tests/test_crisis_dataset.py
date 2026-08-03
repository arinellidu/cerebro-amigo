"""Integridade do dataset semente de detecção de crise.

O dataset (`tests/datasets/crisis_examples.jsonl`) é a referência de avaliação
do classificador (ver `scripts/eval_crisis.py`). Estes testes não chamam LLM:
guardam o *dataset em si* contra corrupção, rótulos inválidos ou perda de
cobertura — uma regressão silenciosa no dataset enfraquece o gate de crise.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

DATASET = Path(__file__).parent / "datasets" / "crisis_examples.jsonl"

NIVEIS_VALIDOS = {"nenhum", "baixo", "moderado", "alto", "critico"}
# Mínimo de exemplos positivos (crise) exigido para o eval ter sinal.
MIN_POSITIVOS = 4


def _carregar() -> list[dict]:
    linhas = [ln for ln in DATASET.read_text(encoding="utf-8").splitlines() if ln.strip()]
    return [json.loads(ln) for ln in linhas]


def test_dataset_existe_e_nao_vazio():
    assert DATASET.exists(), f"dataset ausente: {DATASET}"
    assert _carregar(), "dataset não pode estar vazio"


def test_todas_as_linhas_sao_json_valido():
    for linha in DATASET.read_text(encoding="utf-8").splitlines():
        if linha.strip():
            json.loads(linha)  # levanta se inválido


@pytest.mark.parametrize("ex", _carregar(), ids=lambda e: e.get("id", "?"))
def test_schema_de_cada_exemplo(ex):
    assert set(ex) >= {"id", "mensagem", "expected_crise", "expected_nivel"}
    assert isinstance(ex["id"], str) and ex["id"]
    assert isinstance(ex["mensagem"], str) and ex["mensagem"].strip()
    assert isinstance(ex["expected_crise"], bool)
    assert ex["expected_nivel"] in NIVEIS_VALIDOS


@pytest.mark.parametrize("ex", _carregar(), ids=lambda e: e.get("id", "?"))
def test_coerencia_crise_x_nivel(ex):
    """Regra de rotulação: crise=True nunca pode ter nível 'nenhum',
    e crise=False nunca pode ter nível 'alto'/'critico'."""
    if ex["expected_crise"]:
        assert ex["expected_nivel"] != "nenhum", (
            f"{ex['id']}: marcado como crise mas nível 'nenhum'"
        )
    else:
        assert ex["expected_nivel"] not in {"alto", "critico"}, (
            f"{ex['id']}: não-crise não pode ter nível {ex['expected_nivel']!r}"
        )


def test_ids_unicos():
    ids = [e["id"] for e in _carregar()]
    assert len(ids) == len(set(ids)), "há ids duplicados no dataset"


def test_cobertura_minima_de_positivos():
    positivos = [e for e in _carregar() if e["expected_crise"]]
    assert len(positivos) >= MIN_POSITIVOS, (
        f"dataset precisa de ao menos {MIN_POSITIVOS} exemplos de crise; "
        f"tem {len(positivos)}"
    )


def test_tem_exemplos_negativos():
    """Sem negativos não dá pra medir precisão (falsos positivos)."""
    assert any(not e["expected_crise"] for e in _carregar())
