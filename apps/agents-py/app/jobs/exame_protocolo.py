"""Protocolo determinístico de monitoramento laboratorial (S2, ADR-029).

Mapeia o medicamento (texto livre da prescrição) para os exames de monitoramento
exigidos, com cadência e FAIXA DE REFERÊNCIA. SEM LLM: é conhecimento clínico
padronizado, versionado e hashável. A faixa é dado factual — a decisão clínica é
sempre do médico (regra #1).

Casamento por palavra-chave no nome do medicamento, normalizado (minúsculas + sem
acento), porque `prescricoes.medicamento` é TEXT livre (sem FK ao catálogo).
"""

from __future__ import annotations

import hashlib
import unicodedata
from dataclasses import dataclass

PROTOCOLO_VERSAO = "exames-v1"


@dataclass(frozen=True)
class ProtocoloExame:
    tipo_exame: str
    ref_label: str
    ref_unidade: str | None
    ref_min: float | None      # fora_faixa se valor < ref_min
    ref_max: float | None      # fora_faixa se valor > ref_max
    periodicidade_dias: int


@dataclass(frozen=True)
class _Regra:
    keywords: tuple[str, ...]
    exames: tuple[ProtocoloExame, ...]


# Exames (faixas conservadoras, adulto; valor monitorado primário por exame).
_LITEMIA = ProtocoloExame("litemia", "Nível sérico de lítio", "mEq/L", 0.6, 1.2, 90)
_HEMOGRAMA = ProtocoloExame("hemograma", "Neutrófilos (absoluto)", "10^9/L", 1.5, None, 30)
_HEPATICA = ProtocoloExame("funcao_hepatica", "TGP / ALT", "U/L", 7.0, 56.0, 180)
_METABOLICO = ProtocoloExame("perfil_metabolico", "Glicemia de jejum", "mg/dL", 70.0, 99.0, 180)
_PESO = ProtocoloExame("peso", "Peso corporal", "kg", None, None, 90)
_ECG_QT = ProtocoloExame("ecg_qt", "Intervalo QTc", "ms", None, 460.0, 180)

# Antipsicóticos atípicos → risco metabólico (perfil + peso).
_ATIPICOS = (
    "clozapina", "olanzapina", "quetiapina", "risperidona", "paliperidona",
    "aripiprazol", "ziprasidona", "lurasidona", "seroquel", "zyprexa",
    "risperdal", "leponex",
)

_REGRAS: tuple[_Regra, ...] = (
    _Regra(("litio", "carbolitium", "carbonato de litio"), (_LITEMIA,)),
    _Regra(("clozapina", "leponex"), (_HEMOGRAMA,)),                 # agranulocitose
    _Regra(("valproat", "valproic", "divalpro", "depako"), (_HEPATICA,)),
    _Regra(_ATIPICOS, (_METABOLICO, _PESO)),
    _Regra(("ziprasidona", "haloperidol", "haldol"), (_ECG_QT,)),   # risco de QT
)


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "")
    return "".join(c for c in s if not unicodedata.combining(c)).lower()


def protocolos_para(medicamento: str) -> list[ProtocoloExame]:
    """Exames de monitoramento exigidos por um medicamento (dedup por tipo)."""
    n = _norm(medicamento)
    out: dict[str, ProtocoloExame] = {}
    for regra in _REGRAS:
        if any(k in n for k in regra.keywords):
            for e in regra.exames:
                out.setdefault(e.tipo_exame, e)
    return list(out.values())


def versao_hash() -> str:
    """Hash do conjunto de regras (auditoria — muda se o protocolo muda)."""
    blob = "|".join(
        f"{e.tipo_exame}:{e.ref_min}:{e.ref_max}:{e.periodicidade_dias}"
        for r in _REGRAS
        for e in r.exames
    )
    return hashlib.sha256(blob.encode()).hexdigest()[:12]
