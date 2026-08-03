"""Textos fixos para notificações de check-in.

Mesma filosofia do `crisis_copy.py` no orchestrator: o conteúdo da
notificação push NÃO é gerado por LLM. É string constante no código,
versionada e hashada. A diferença com o texto de crise é que estas
notificações de check-in são menos críticas (lembrete operacional, não
intervenção de risco), mas a política de não-LLM é mantida por:

1. Determinismo — push pode ser auditado e reproduzido exatamente.
2. Latência — sem ida ao LLM, dispatch fica abaixo de 1 segundo.
3. Custo — milhares de pushes/dia sem custo de token.
4. Privacidade — texto não passa por terceiros.

Cada tipo de check-in conhecido tem seu (titulo, corpo) versionados.
Tipo desconhecido cai num default genérico.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass


@dataclass(frozen=True)
class PushCopy:
    versao: str
    titulo: str
    corpo: str
    hash_sha256: str


def _versionar(versao: str, titulo: str, corpo: str) -> PushCopy:
    digest = hashlib.sha256(f"{versao}|{titulo}|{corpo}".encode()).hexdigest()
    return PushCopy(versao=versao, titulo=titulo, corpo=corpo, hash_sha256=digest)


# ─── Catálogo de textos ────────────────────────────────────────────────────


CHECKIN_COPY: dict[str, PushCopy] = {
    "humor_diario": _versionar(
        "v1",
        "Como você está hoje?",
        "Reserve 1 minuto para registrar como está se sentindo. Sua psiquiatra acompanha.",
    ),
    "sintomas_semanal": _versionar(
        "v1",
        "Check-in semanal",
        "Um momento rápido para registrar como foi sua semana.",
    ),
    "medicacao_lembrete": _versionar(
        "v1",
        "Hora da medicação",
        "Não esqueça da sua dose agora. Toque para confirmar.",
    ),
    "diario_lembrete": _versionar(
        "v1",
        "Que tal escrever no diário?",
        "Registrar pensamentos do dia pode ajudar no acompanhamento.",
    ),
}


CHECKIN_COPY_DEFAULT: PushCopy = _versionar(
    "v1",
    "Cérebro Amigo",
    "Você tem uma notificação aguardando no app.",
)


def get_copy(tipo: str) -> PushCopy:
    """Resolve o texto pelo tipo de checkin. Tipo desconhecido cai no default
    genérico — não falha, mas merece log + revisão (provavelmente migration
    adicionou tipo novo sem atualizar este catálogo)."""
    return CHECKIN_COPY.get(tipo, CHECKIN_COPY_DEFAULT)
