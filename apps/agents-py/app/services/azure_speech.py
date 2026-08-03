"""Azure AI Speech — fast transcription (ADR-082, substitui o Amazon Transcribe).

REST síncrono: o áudio vai em multipart na própria request e a resposta volta
com as frases transcritas — sem job, sem polling, sem storage intermediário.
pt-BR fixo; diarização opcional (escriba de consulta usa 2 locutores).

LGPD: nenhum log aqui contém transcrição ou áudio; erros expõem só o status
HTTP. O corpo de erro do Speech nunca vai para exceção/log.
"""

from __future__ import annotations

import json

import httpx

_API_VERSION = "2024-11-15"


def transcrever_fast(
    audio_bytes: bytes,
    settings,
    *,
    max_speakers: int | None = None,
) -> dict:
    """Chama a fast transcription e retorna o JSON da resposta.

    max_speakers=None → sem diarização (diário de voz).
    max_speakers=N    → diarizado (escriba: 2).
    Síncrona (chamar via asyncio.to_thread, padrão dos helpers de infra).
    """
    if settings.azure_speech_key is None:
        raise RuntimeError("AZURE_SPEECH_KEY ausente — transcrição indisponível.")

    definition: dict = {"locales": ["pt-BR"]}
    if max_speakers:
        definition["diarization"] = {"enabled": True, "maxSpeakers": max_speakers}

    url = (
        f"https://{settings.azure_speech_region}.api.cognitive.microsoft.com"
        f"/speechtotext/transcriptions:transcribe?api-version={_API_VERSION}"
    )
    resp = httpx.post(
        url,
        headers={"Ocp-Apim-Subscription-Key": settings.azure_speech_key.get_secret_value()},
        files={
            "audio": ("audio", audio_bytes, "application/octet-stream"),
            "definition": (None, json.dumps(definition), "application/json"),
        },
        timeout=settings.transcribe_timeout_s,
    )
    if resp.status_code != 200:
        # Sem corpo da resposta na exceção (pode ecoar metadados) — só o status.
        raise RuntimeError(f"Azure Speech fast transcription falhou: HTTP {resp.status_code}")
    return resp.json()


def texto_simples(payload: dict) -> str:
    """Transcrição corrida (sem locutores) a partir de combinedPhrases."""
    frases = payload.get("combinedPhrases", [])
    return " ".join(f.get("text", "") for f in frases).strip()


def _rotulo(spk: int | None) -> str:
    """speaker 1 → 'Locutor 1'. Não assume quem é médico/paciente."""
    return f"Locutor {spk}" if spk else "Locutor"


def texto_diarizado(payload: dict) -> str:
    """Reconstrói 'Locutor N: …' a partir de phrases (speaker 1-based do Speech).
    Sem informação de locutor, cai para o texto corrido."""
    phrases = payload.get("phrases", [])
    if not phrases or all(p.get("speaker") is None for p in phrases):
        return texto_simples(payload)

    linhas: list[str] = []
    atual: int | None = None
    buf: list[str] = []
    for p in phrases:
        texto = (p.get("text") or "").strip()
        if not texto:
            continue
        spk = p.get("speaker")
        if spk != atual and buf:
            linhas.append(f"{_rotulo(atual)}: " + " ".join(buf))
            buf = []
        atual = spk
        buf.append(texto)
    if buf:
        linhas.append(f"{_rotulo(atual)}: " + " ".join(buf))
    return "\n".join(linhas)
