"""Texto FIXO do protocolo de crise — JAMAIS gerado por LLM.

Qualquer alteração aqui exige:
    1) Revisão psiquiátrica documentada (registrar PR aprovado).
    2) Atualização do hash em CRISIS_COPY_VERSION.
    3) Registro na trilha `protocolos_crise_acionados` referenciando a versão.

Conteúdo migrado de `apps/orchestrator/internal/agent/crise.go` — manter
paridade textual até nova revisão clínica.

ADR-063 camadas 1+3: `InstabilidadeCopy` e lista determinística vivem aqui
pelo mesmo rito de atestação clínica (clinical-safety R2).
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass


@dataclass(frozen=True)
class CrisisCopy:
    versao: str
    texto: str
    hash_sha256: str


@dataclass(frozen=True)
class InstabilidadeCopy:
    versao: str
    texto: str
    # False = rascunho — NÃO enviado ao paciente até atestação clínica.
    # Quando Adonai atestar: (1) revisar texto, (2) atestado = True,
    # (3) PR com revisão documentada. Mesmo rito de CrisisCopy.
    atestado: bool
    hash_sha256: str


def _versionar(versao: str, texto: str) -> CrisisCopy:
    h = hashlib.sha256(texto.encode("utf-8")).hexdigest()
    return CrisisCopy(versao=versao, texto=texto, hash_sha256=h)


def _versionar_instabilidade(versao: str, texto: str, *, atestado: bool) -> InstabilidadeCopy:
    h = hashlib.sha256(texto.encode("utf-8")).hexdigest()
    return InstabilidadeCopy(versao=versao, texto=texto, atestado=atestado, hash_sha256=h)


# ─── v1 (placeholder — substituir pelo texto revisado em crise.go) ─────────
_TEXTO_V1 = (
    "Recebi sua mensagem e quero que você saiba que ela está sendo levada a "
    "sério agora. Estou avisando sua psiquiatra imediatamente.\n\n"
    "Enquanto isso, se você sente que pode se machucar ou que está em risco, "
    "por favor ligue agora para o CVV no 188 — atendimento 24h gratuito por "
    "voluntários treinados. Se houver risco imediato, vá ao pronto-socorro "
    "mais próximo ou ligue para o SAMU (192).\n\n"
    "Você não precisa lidar com isso sozinho(a). Sua psiquiatra vai te "
    "responder o mais breve possível."
)

CRISIS_COPY = _versionar("v1", _TEXTO_V1)


def texto_protocolo() -> str:
    """Retorna o texto vigente. Sempre logar `CRISIS_COPY.versao` junto."""
    return CRISIS_COPY.texto


# ─── ADR-063 camada 3: texto de instabilidade técnica ─────────────────────
# RASCUNHO — AGUARDANDO CURADORIA E ATESTAÇÃO DO CLÍNICO (ADONAI ARINELLI).
#
# Enviado ao paciente quando o classificador de crise está sistemicamente
# indisponível E a mensagem não bateu no screen determinístico (camada 1).
# `atestado = False` → NÃO enviado ao paciente até revisão clínica aprovada.
#
# Para atestar: (1) revisar o texto abaixo com Adonai, (2) ajustar se necessário,
# (3) mudar `atestado=True`, (4) PR com descrição da revisão documentada.
_RASCUNHO_INSTABILIDADE = (
    "Sua mensagem foi recebida e registrada com segurança. "
    "No momento há uma instabilidade técnica que impede o atendimento automático. "
    "Sua psiquiatra foi avisada e vai te responder em breve. "
    "Se você sentir que está em risco imediato, ligue agora para o CVV (188) "
    "ou SAMU (192)."
)
INSTABILIDADE_COPY = _versionar_instabilidade(
    "v0-rascunho", _RASCUNHO_INSTABILIDADE, atestado=False
)
