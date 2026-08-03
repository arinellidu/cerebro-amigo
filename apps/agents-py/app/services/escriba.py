"""Escriba clínico (Ambient Scribe, ADR-040): áudio da consulta → transcrição
diarizada → rascunho FACTUAL para o médico revisar.

Transcrição via Azure AI Speech fast transcription (ADR-082), diarizada
(Locutor 1/2 — não assume quem é médico). Dois caminhos:
  - Teleconsulta: o áudio chega em bytes (base64) e vai DIRETO na request do
    Speech — não toca storage em momento algum.
  - Presencial (ADR-075): o browser subiu o áudio para o container efêmero do
    Blob via SAS; aqui baixamos, transcrevemos e DELETAMOS (finally — o áudio
    NUNCA persiste além do ciclo, LGPD).

Guardrails:
  - O rascunho é FACTUAL (regra #1 clinical-safety): relato do paciente, temas,
    medicações MENCIONADAS, fatos. NÃO gera diagnóstico, CID, avaliação, dose
    nem plano — isso é do médico.
  - `mencao_risco` é observação factual ("o paciente mencionou risco?"), não
    dispara protocolo de crise patient-facing (regra #2): o rascunho é
    doctor-facing e o médico estava na consulta.
"""

from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass

import structlog
from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel
from pydantic import Field as PydanticField

from app.core.config import get_settings
from app.core.llm import ainvoke_structured, sonnet
from app.services.azure_speech import texto_diarizado, transcrever_fast
from app.services.blob_audio import delete_blob, download_blob

logger = structlog.get_logger(__name__)


# ─── Resultado público ──────────────────────────────────────────────────────


@dataclass
class EscribaResult:
    transcricao: str          # transcrição diarizada (Locutor 1/2)
    rascunho: dict            # rascunho factual (RascunhoFactualOutput serializado)
    mencao_risco: bool        # flag factual p/ o médico


# ─── Schema de saída do LLM (FACTUAL — sem decisão clínica) ─────────────────


class RascunhoFactualOutput(BaseModel):
    resumo_factual: str = PydanticField(
        description="Resumo NEUTRO do que foi dito na consulta, em pt-BR. Apenas fatos "
        "relatados/observados na fala — sem diagnóstico, sem interpretação clínica, sem plano.",
    )
    queixas_relatadas: list[str] = PydanticField(
        default_factory=list,
        description="O que o paciente RELATOU sentir/queixar, em linguagem descritiva. "
        "Ex: ['dificuldade para dormir', 'ansiedade pela manhã']. NÃO interpretar.",
    )
    fatos_relatados: list[str] = PydanticField(
        default_factory=list,
        description="Fatos/eventos que o paciente mencionou. Ex: ['mudou de emprego', "
        "'parou a medicação há 1 semana', 'dorme ~5h']. Só o que foi dito.",
    )
    temas_abordados: list[str] = PydanticField(
        default_factory=list,
        description="Até 6 temas curtos discutidos na consulta. Ex: ['sono', 'trabalho', "
        "'efeitos colaterais']. TEMAS, não diagnósticos.",
    )
    medicacoes_mencionadas: list[str] = PydanticField(
        default_factory=list,
        description="Medicações CITADAS na conversa, como texto, para o MÉDICO confirmar. "
        "Ex: ['Escitalopram', 'Clonazepam SOS']. NÃO é prescrição nem recomendação de dose.",
    )
    mencao_risco: bool = PydanticField(
        default=False,
        description="True SE o paciente mencionou ideação suicida, autoagressão ou risco. "
        "É observação FACTUAL do que foi dito (para o médico revisar), não uma avaliação.",
    )


_RASCUNHO_SYSTEM = """\
Você é um ESCRIBA clínico. Recebe a transcrição de uma consulta de psiquiatria entre um \
médico e um paciente (rotulados Locutor 1 e Locutor 2) e organiza o que foi DITO num rascunho \
factual para o MÉDICO revisar e completar.

REGRAS RÍGIDAS (inegociáveis):
1. NÃO diagnostique. NÃO sugira CID. NÃO faça avaliação clínica. NÃO sugira conduta, medicação \
   ou ajuste de dose. NÃO escreva plano terapêutico. Isso é decisão do MÉDICO.
2. Apenas ORGANIZE FATOS: o que o paciente relatou, temas abordados, medicações mencionadas \
   (como citação, para o médico confirmar), e eventos relatados.
3. Linguagem neutra e descritiva. Não interprete o que foi dito.
4. Se não houver informação para um campo, deixe-o vazio. Não invente.
5. mencao_risco = true apenas se houver menção explícita de risco (ideação suicida, autoagressão).

Responda com o JSON estruturado conforme o schema."""


# ─── Entrada pública ───────────────────────────────────────────────────────


async def gerar_rascunho_consulta(
    audio_bytes: bytes,
    content_type: str,
    paciente_id: uuid.UUID,
) -> EscribaResult:
    """Caminho da TELECONSULTA: o áudio chega em bytes (base64) e vai direto ao
    Speech — sem storage. (O presencial usa gerar_rascunho_consulta_blob — o
    browser já subiu o áudio via SAS.)"""
    settings = get_settings()
    log = logger.bind(service="escriba", paciente_id=str(paciente_id), origem="teleconsulta")

    transcricao = texto_diarizado(
        await asyncio.to_thread(_transcrever_consulta_bytes, audio_bytes, settings)
    )
    log.info("escriba.transcrito", chars=len(transcricao), content_type=content_type)
    return await _rascunho_da_transcricao(transcricao, log)


async def gerar_rascunho_consulta_blob(
    blob_key: str,
    content_type: str,
    paciente_id: uuid.UUID,
) -> EscribaResult:
    """Caminho da consulta PRESENCIAL (ADR-075): o browser já subiu o áudio para
    o container efêmero via SAS PUT (o wire ainda chama a chave de s3_key — nome
    legado, ADR-082). Baixa, transcreve e apaga — o áudio NUNCA persiste (delete
    garantido no finally, LGPD)."""
    settings = get_settings()
    log = logger.bind(
        service="escriba",
        paciente_id=str(paciente_id),
        blob_key=blob_key,
        content_type=content_type,
        origem="presencial",
    )
    log.info("escriba.blob_key_recebida")

    try:
        audio_bytes = await asyncio.to_thread(download_blob, blob_key, settings)
        transcricao = texto_diarizado(
            await asyncio.to_thread(_transcrever_consulta_bytes, audio_bytes, settings)
        )
        log.info("escriba.transcrito", chars=len(transcricao))
    finally:
        # Delete garantido mesmo se download/transcrição falharem (LGPD).
        await asyncio.to_thread(delete_blob, blob_key, settings)
        log.info("escriba.blob_deletado")

    return await _rascunho_da_transcricao(transcricao, log)


async def _rascunho_da_transcricao(transcricao: str, log) -> EscribaResult:
    """Miolo comum aos dois caminhos: transcrição → rascunho factual."""
    if not transcricao.strip():
        return EscribaResult(transcricao="", rascunho={}, mencao_risco=False)

    call = await ainvoke_structured(
        sonnet(temperature=0.0),
        RascunhoFactualOutput,
        [
            SystemMessage(content=_RASCUNHO_SYSTEM),
            HumanMessage(content=f"Transcrição da consulta:\n\n{transcricao}"),
        ],
    )
    rascunho: RascunhoFactualOutput = call.parsed  # type: ignore[assignment]
    log.info(
        "escriba.rascunho_done",
        n_queixas=len(rascunho.queixas_relatadas),
        mencao_risco=rascunho.mencao_risco,
        tokens_in=call.tokens_in,
        tokens_out=call.tokens_out,
    )

    return EscribaResult(
        transcricao=transcricao,
        rascunho=rascunho.model_dump(),
        mencao_risco=rascunho.mencao_risco,
    )


# ─── Transcrição diarizada (helper síncrono, thread pool) ───────────────────


def _transcrever_consulta_bytes(audio_bytes: bytes, settings) -> dict:
    """Fast transcription com diarização (2 locutores)."""
    return transcrever_fast(audio_bytes, settings, max_speakers=2)
