"""T0-3: heurísticas de nome/endereço no redact_pii (campos livres, sem NER)."""

import pytest

from app.core.observability import redact_pii


@pytest.mark.parametrize(
    ("texto", "marcador", "sumiu"),
    [
        ("moro na Rua das Flores, 123", "[ADDRESS_REDACTED]", "Flores"),
        ("endereço: Avenida Paulista, nº 1000", "[ADDRESS_REDACTED]", "Paulista"),
        ("CEP 01310-100 em SP", "[CEP_REDACTED]", "01310"),
        ("consultei a Dra. Maria Clara ontem", "[NAME_REDACTED]", "Maria"),
        ("o Sr. João da Silva chegou", "[NAME_REDACTED]", "Silva"),
        ("me chamo Pedro Henrique e estou ansioso", "[NAME_REDACTED]", "Pedro"),
        ("Meu nome é Ana Beatriz dos Santos", "[NAME_REDACTED]", "Beatriz"),
        ("falei com Maria Clara Souza Lima hoje", "[NAME_REDACTED]", "Souza"),
    ],
)
def test_redata_nome_e_endereco(texto, marcador, sumiu):
    saida = redact_pii(texto)
    assert marcador in saida
    assert sumiu not in saida


@pytest.mark.parametrize(
    "texto",
    [
        "estou me sentindo muito ansioso hoje",
        "tomei o remédio de manhã",
        "o Cérebro Amigo me lembrou do check-in",
        "Hoje acordei melhor",
    ],
)
def test_texto_clinico_comum_fica_intacto(texto):
    assert redact_pii(texto) == texto


def test_pii_existente_continua_redatada():
    saida = redact_pii("CPF 123.456.789-01, tel 11 98765-4321")
    assert "[CPF_REDACTED]" in saida and "[PHONE_REDACTED]" in saida
