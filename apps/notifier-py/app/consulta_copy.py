"""Textos fixos para lembretes de consulta.

Mesma filosofia de `checkin_copy.py` / `crisis_copy.py`: o conteúdo NÃO é
gerado por LLM. É template constante no código, versionado e hashado. O único
dado interpolado é a data/hora da consulta (informação administrativa — não
clínica). Nenhum sintoma, diagnóstico ou conduta entra aqui.

`tipo` é a antecedência ('24h' | '1h'); o texto é genérico (não assume
"amanhã") e inclui a data/hora real, então funciona para qualquer janela.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass


@dataclass(frozen=True)
class LembreteCopy:
    versao: str
    titulo: str
    corpo_template: str  # usa {quando}
    hash_sha256: str

    def corpo(self, quando: str) -> str:
        return self.corpo_template.format(quando=quando)


def _versionar(versao: str, titulo: str, corpo_template: str) -> LembreteCopy:
    digest = hashlib.sha256(
        f"{versao}|{titulo}|{corpo_template}".encode()
    ).hexdigest()
    return LembreteCopy(
        versao=versao, titulo=titulo, corpo_template=corpo_template, hash_sha256=digest
    )


LEMBRETE_COPY: dict[str, LembreteCopy] = {
    "24h": _versionar(
        "v1",
        "Lembrete de consulta",
        "Você tem consulta marcada para {quando}. Em caso de imprevisto, avise com antecedência.",
    ),
    "1h": _versionar(
        "v1",
        "Sua consulta está próxima",
        "Sua consulta é {quando}. Até logo!",
    ),
}

LEMBRETE_COPY_DEFAULT: LembreteCopy = _versionar(
    "v1",
    "Lembrete de consulta",
    "Você tem consulta marcada para {quando}.",
)


def get_lembrete_copy(tipo: str) -> LembreteCopy:
    return LEMBRETE_COPY.get(tipo, LEMBRETE_COPY_DEFAULT)
