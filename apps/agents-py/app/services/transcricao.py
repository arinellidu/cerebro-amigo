"""Serviço de transcrição de áudio: Azure AI Speech (fast transcription) → Claude análise.

Fluxo (ADR-082):
  1. Fast transcription pt-BR — os bytes vão direto na request REST (síncrona);
     o áudio NÃO toca storage em nenhum momento deste fluxo.
  2. Triagem de crise sobre a transcrição (ADR-010)
  3. Claude Sonnet: extrai humor estimado, emoção, tags e sintomas relatados

O áudio NUNCA persiste além do ciclo de transcrição (LGPD).
"""

from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass, field

import structlog
from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel
from pydantic import Field as PydanticField

from app.core.config import get_settings
from app.core.db import acquire
from app.core.llm import ainvoke_structured, sonnet
from app.services.azure_speech import texto_simples, transcrever_fast
from app.services.crisis import acionar_protocolo_diario, detectar_crise

logger = structlog.get_logger(__name__)


# ─── Resultado público ──────────────────────────────────────────────────────


@dataclass
class TranscricaoResult:
    transcricao: str
    humor_estimado: int | None          # 1-10 ou None se não inferível
    emocao_predominante: str            # "neutro" | "ansioso" | "triste" | etc.
    tags_sugeridas: list[str] = field(default_factory=list)
    sintomas_detectados: list[str] = field(default_factory=list)
    # Triagem de crise (ADR-010). Se crise=True, a análise é pulada e o front
    # exibe crise_texto (acolhimento fixo) em vez do formulário de revisão.
    crise: bool = False
    crise_texto: str | None = None


# ─── Schema de saída do LLM ────────────────────────────────────────────────


class AnaliseVozOutput(BaseModel):
    humor_estimado: int | None = PydanticField(
        None,
        ge=1,
        le=10,
        description="Pontuação 1-10 baseada no que o paciente descreveu. "
        "Retornar null se o paciente não mencionar estado emocional.",
    )
    emocao_predominante: str = PydanticField(
        default="neutro",
        description="Emoção dominante em uma palavra em pt-BR: neutro, ansioso, triste, "
        "agitado, esperancoso, frustrado, aliviado, etc.",
    )
    tags_sugeridas: list[str] = PydanticField(
        default_factory=list,
        description="Até 5 palavras-chave curtas em PT-BR sobre temas mencionados. "
        "Ex: ['sono', 'trabalho', 'medicação', 'família']. Sem avaliações.",
    )
    sintomas_detectados: list[str] = PydanticField(
        default_factory=list,
        description="Sintomas que o paciente RELATOU sentir, em linguagem descritiva. "
        "Ex: ['dificuldade para dormir', 'tensão no peito', 'cansaço']. "
        "NÃO interpretar — apenas o que o paciente disse.",
    )


_ANALISE_SYSTEM = """\
Você é um assistente de saúde mental analisando a transcrição de um áudio de diário \
gravado por um paciente psiquiátrico.

PRINCÍPIOS RÍGIDOS:
1. NÃO diagnostique transtorno, fase, episódio ou condição clínica.
2. Identifique SINTOMAS RELATADOS (o que o paciente disse que sente), não interprete clinicamente.
3. NÃO copie trechos verbatim do paciente nos campos de análise — use linguagem descritiva neutra.
4. Humor estimado: 1=extremamente ruim, 10=excelente. Retorne null se não houver menção emocional clara.
5. Tags: até 5 temas curtos em PT-BR — TEMAS, não diagnósticos.
6. Sintomas: frases curtas descrevendo o que o paciente relatou, sem interpretação.

Responda com o JSON estruturado conforme o schema."""


# ─── Entrada pública ───────────────────────────────────────────────────────


async def transcrever_audio(
    audio_bytes: bytes,
    content_type: str,
    paciente_id: uuid.UUID,
) -> TranscricaoResult:
    """Ponto de entrada principal: transcreve → triagem de crise → analisa.

    content_type fica na assinatura por compat de wire/log — a fast
    transcription detecta o formato (webm/mp4) pelo próprio conteúdo.
    """
    settings = get_settings()
    log = logger.bind(service="transcricao", paciente_id=str(paciente_id))

    # 1. Azure Speech fast transcription (bytes direto — sem storage)
    transcricao = texto_simples(
        await asyncio.to_thread(_transcrever_bytes, audio_bytes, settings)
    )
    log.info("transcricao.done", chars=len(transcricao), content_type=content_type)

    # 2. Triagem de crise ANTES da análise (ADR-010, regra #2 clinical-safety).
    # Se houver crise: aciona protocolo (texto fixo, trilha, notifica médico,
    # pausa automação) e PULA a análise — não geramos humor/tags sobre uma fala
    # de crise; o paciente recebe o acolhimento.
    crise = await detectar_crise(transcricao)
    if crise.crise_detectada:
        async with acquire() as conn:
            texto_acolhimento = await acionar_protocolo_diario(
                conn, paciente_id, crise, origem="diario_audio"
            )
        log.warning("transcricao.crise_detectada", nivel=crise.nivel)
        return TranscricaoResult(
            transcricao="",  # não propaga a fala de crise ao cliente (minimização)
            humor_estimado=None,
            emocao_predominante="neutro",
            tags_sugeridas=[],
            sintomas_detectados=[],
            crise=True,
            crise_texto=texto_acolhimento,
        )

    # 3. Claude Sonnet: análise contextual
    call = await ainvoke_structured(
        sonnet(temperature=0.0),
        AnaliseVozOutput,
        [
            SystemMessage(content=_ANALISE_SYSTEM),
            HumanMessage(content=f"Transcrição do paciente:\n\n{transcricao}"),
        ],
    )
    analise: AnaliseVozOutput = call.parsed  # type: ignore[assignment]
    log.info(
        "transcricao.analise_done",
        humor=analise.humor_estimado,
        emocao=analise.emocao_predominante,
        n_tags=len(analise.tags_sugeridas),
        tokens_in=call.tokens_in,
        tokens_out=call.tokens_out,
    )

    return TranscricaoResult(
        transcricao=transcricao,
        humor_estimado=analise.humor_estimado,
        emocao_predominante=analise.emocao_predominante,
        tags_sugeridas=analise.tags_sugeridas,
        sintomas_detectados=analise.sintomas_detectados,
    )


# ─── Helper síncrono (executado em thread pool) ────────────────────────────


def _transcrever_bytes(audio_bytes: bytes, settings) -> dict:
    """Fast transcription sem diarização (diário de voz é um locutor só)."""
    return transcrever_fast(audio_bytes, settings, max_speakers=None)
