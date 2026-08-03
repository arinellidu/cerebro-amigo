"""Triagem de crise no Diário (áudio + texto).

Espelha o mecanismo do orchestrator-py (nodes/crisis.py), adaptado ao diário:
não há conversa/mensagem — a crise é detectada sobre o texto que o paciente
acabou de gravar/digitar, ANTES de qualquer análise ou persistência da entrada.

Regras (clinical-safety):
  #1 IA não pratica medicina — detecção só classifica risco, não orienta.
  #2 Protocolo de crise é FIXO: texto vem de crisis_copy (nunca LLM), grava
     trilha, notifica médico, pausa automação. Fail-safe: erro → trata como crise.
  #4 LGPD — `palavras_detectadas` são CATEGORIAS, nunca trechos verbatim.
  #5 Auditoria append-only — só INSERT em protocolos_crise_acionados.
"""

from __future__ import annotations

import uuid
from typing import Literal

import structlog
from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, Field

from app.core.llm import ainvoke_structured, haiku
from app.services.crisis_copy import CRISIS_COPY, texto_protocolo

logger = structlog.get_logger(__name__)


# ─── Schema de detecção (espelha orchestrator CrisisDetectionOutput) ────────


class CrisisDetectionOutput(BaseModel):
    """Conservadora: falso positivo é tolerável; falso negativo NÃO é."""

    crise_detectada: bool = Field(
        ...,
        description="True se há QUALQUER sinal de risco de auto-extermínio, "
        "auto-lesão, ideação suicida (ativa/passiva), plano, desesperança "
        "aguda ou risco a terceiros. Na dúvida, True.",
    )
    confianca: float = Field(..., ge=0.0, le=1.0)
    nivel: Literal["nenhum", "baixo", "moderado", "alto", "critico"] = Field(...)
    gatilhos: list[str] = Field(
        default_factory=list,
        description="Categorias detectadas (NUNCA trechos verbatim). "
        "Ex.: ['ideacao_ativa', 'desesperanca'].",
    )


# Prompt idêntico ao CRISIS_DETECTION_SYSTEM_V1 do orchestrator.
_CRISIS_SYSTEM = """Você é um classificador de risco em saúde mental. Sua ÚNICA tarefa é \
determinar se a mensagem do paciente contém sinais de risco de auto-extermínio, \
auto-lesão, ideação suicida ativa ou passiva, plano suicida, desesperança aguda \
ou risco a terceiros.

REGRAS RÍGIDAS:
1. Na dúvida, classifique como crise. Falso positivo é tolerável; falso \
   negativo NÃO é.
2. Mensagens metafóricas explícitas ("estou afundando", "não aguento mais") \
   classificam como pelo menos `moderado`.
3. Menção a método, meio ou plano → `critico`.
4. Você NÃO oferece resposta ao paciente. Você apenas classifica.
5. Em `gatilhos`, use CATEGORIAS (ex.: "ideacao_ativa") — nunca trechos \
   verbatim da mensagem.

Retorne JSON conforme o schema."""


# ─── Resultado público ──────────────────────────────────────────────────────


class TriagemResult(BaseModel):
    crise: bool
    nivel: str
    confianca: float
    gatilhos: list[str]
    texto_acolhimento: str | None = None  # preenchido só quando crise=True


# ─── Detecção ───────────────────────────────────────────────────────────────


async def detectar_crise(texto: str) -> CrisisDetectionOutput:
    """Classifica risco no texto. Fail-safe: qualquer erro → crise (nível alto)."""
    try:
        call = await ainvoke_structured(
            haiku(),
            CrisisDetectionOutput,
            [
                SystemMessage(content=_CRISIS_SYSTEM),
                HumanMessage(content=texto),
            ],
        )
        out: CrisisDetectionOutput = call.parsed  # type: ignore[assignment]
        logger.info(
            "diario.crise.detect_done",
            detectada=out.crise_detectada,
            nivel=out.nivel,
            confianca=out.confianca,
        )
        return out
    except Exception as exc:
        # Fail-safe (regra #2): classificador indisponível → trata como crise.
        logger.exception("diario.crise.detect_failed", error=str(exc))
        return CrisisDetectionOutput(
            crise_detectada=True,
            confianca=0.0,
            nivel="alto",
            gatilhos=["classifier_error"],
        )


def _gatilho_principal(gatilhos: list[str], nivel: str) -> str:
    return gatilhos[0] if gatilhos else f"nivel_{nivel}"


# ─── Protocolo (SEM LLM) ────────────────────────────────────────────────────


async def acionar_protocolo(
    conn,
    paciente_id: uuid.UUID,
    crise: CrisisDetectionOutput,
    origem: str,
    titulo: str,
    mensagem: str,
) -> str:
    """Núcleo do protocolo de crise (SEM LLM). Numa transação: grava trilha
    append-only, notifica o médico e pausa a automação. O texto de acolhimento
    vem de crisis_copy — nunca gerado. Reutilizado pelo diário e por gatilhos
    determinísticos (ex.: item 9 do PHQ-9). `conn` é asyncpg já adquirida.

    Crise é sempre real-action (registro + notificação + pausa), independente de
    SHADOW_MODE — o gate de shadow vale para automação proativa, não para crise.
    """
    texto = texto_protocolo()

    medico_id = await conn.fetchval(
        "SELECT medico_responsavel_id FROM pacientes WHERE cliente_id = $1",
        paciente_id,
    )

    async with conn.transaction():
        # 1. Trilha de auditoria (append-only). mensagem_id NULL (não é conversa).
        await conn.execute(
            """
            INSERT INTO protocolos_crise_acionados
                (paciente_id, medico_id, gatilho, palavras_detectadas,
                 confianca, resposta_enviada, medico_notificado,
                 medico_notificado_em, origem)
            VALUES ($1, $2, $3, $4, $5, $6, TRUE, NOW(), $7)
            """,
            paciente_id,
            medico_id,
            _gatilho_principal(crise.gatilhos, crise.nivel),
            crise.gatilhos,
            crise.confianca,
            texto,
            origem,
        )

        # 2. Notifica médico (só se houver médico responsável).
        if medico_id is not None:
            await conn.execute(
                """
                INSERT INTO notificacoes_medico
                    (medico_id, paciente_id, severidade, tipo, titulo, mensagem)
                VALUES ($1, $2, 'critico', 'crise', $3, $4)
                """,
                medico_id,
                paciente_id,
                titulo,
                mensagem,
            )

        # 3. Pausa automação do paciente (defesa em camadas).
        await conn.execute(
            "UPDATE pacientes SET automacao_pausada = TRUE WHERE cliente_id = $1",
            paciente_id,
        )

    logger.warning(
        "crise.protocolo_executado",
        paciente_id=str(paciente_id),
        nivel=crise.nivel,
        origem=origem,
        copy_versao=CRISIS_COPY.versao,
    )
    return texto


async def acionar_protocolo_diario(
    conn,
    paciente_id: uuid.UUID,
    crise: CrisisDetectionOutput,
    origem: Literal["diario_audio", "diario_texto"],
) -> str:
    """Crise disparada pelo diário (áudio/texto). Delega o núcleo a
    acionar_protocolo, preservando o texto histórico da notificação."""
    titulo = f"Protocolo de crise acionado no diário (nível: {crise.nivel})"
    mensagem = (
        f"O paciente registrou no diário ({origem}) um conteúdo "
        f"classificado como risco {crise.nivel} "
        f"(confiança {crise.confianca:.2f}). A automação foi "
        f"suspensa. Resposta padrão de crise (v{CRISIS_COPY.versao}) "
        f"foi exibida ao paciente."
    )
    return await acionar_protocolo(conn, paciente_id, crise, origem, titulo, mensagem)
