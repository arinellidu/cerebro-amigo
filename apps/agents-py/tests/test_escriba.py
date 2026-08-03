"""Testes do escriba clínico (ADR-040/ADR-082): diarização, pipeline efêmero e guardrails.

Cobrem as invariantes que não podem regredir:
  - Presencial: o blob efêmero é SEMPRE deletado, mesmo se a transcrição falhar (LGPD).
  - Teleconsulta: os bytes vão direto ao Speech — storage nunca é tocado.
  - Transcrição vazia não chama o LLM (custo + não inventar rascunho).
  - O prompt do rascunho mantém a regra #1 (sem diagnóstico/CID/conduta).
  - Reconstrução diarizada rotula Locutor 1/2 sem assumir quem é médico.
"""

from __future__ import annotations

import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from pydantic import SecretStr

from app.services import azure_speech, escriba
from app.services.azure_speech import _rotulo, texto_diarizado, transcrever_fast
from app.services.escriba import (
    _RASCUNHO_SYSTEM,
    EscribaResult,
    RascunhoFactualOutput,
    gerar_rascunho_consulta,
    gerar_rascunho_consulta_blob,
)

PACIENTE_ID = uuid.uuid4()


# ─── _rotulo ─────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("spk", "esperado"),
    [
        (1, "Locutor 1"),
        (2, "Locutor 2"),
        (None, "Locutor"),
    ],
)
def test_rotulo(spk, esperado):
    assert _rotulo(spk) == esperado


# ─── texto_diarizado (payload do fast transcription) ─────────────────────────


def test_diarizacao_rotula_e_agrupa_por_locutor():
    payload = {
        "phrases": [
            {"speaker": 1, "text": "Como vai"},
            {"speaker": 1, "text": "você?"},
            {"speaker": 2, "text": "Bem."},
        ]
    }
    assert texto_diarizado(payload) == "Locutor 1: Como vai você?\nLocutor 2: Bem."


def test_diarizacao_ausente_cai_para_transcript_simples():
    payload = {
        "phrases": [{"text": "texto corrido"}],
        "combinedPhrases": [{"text": "texto corrido sem locutores"}],
    }
    assert texto_diarizado(payload) == "texto corrido sem locutores"


def test_diarizacao_payload_vazio():
    assert texto_diarizado({}) == ""
    assert texto_diarizado({"phrases": [], "combinedPhrases": []}) == ""


# ─── guardrails do prompt e do schema (regra #1 clinical-safety) ─────────────


def test_prompt_do_rascunho_mantem_guardrails_factuais():
    # Se alguém "suavizar" o prompt, este teste quebra de propósito.
    assert "NÃO diagnostique" in _RASCUNHO_SYSTEM
    assert "NÃO sugira CID" in _RASCUNHO_SYSTEM
    assert "decisão do MÉDICO" in _RASCUNHO_SYSTEM
    assert "Não invente" in _RASCUNHO_SYSTEM


def test_schema_mencao_risco_default_false():
    # Fail-safe: sem evidência explícita, não marca risco.
    assert RascunhoFactualOutput(resumo_factual="x").mencao_risco is False


# ─── pipeline com mocks ──────────────────────────────────────────────────────

PAYLOAD_DIARIZADO = {
    "phrases": [
        {"speaker": 1, "text": "Olá."},
        {"speaker": 2, "text": "Olá, doutor."},
    ]
}


def _fake_structured_call(parsed: RascunhoFactualOutput) -> SimpleNamespace:
    return SimpleNamespace(parsed=parsed, tokens_in=100, tokens_out=50)


@pytest.fixture()
def pipeline_mocks(monkeypatch):
    """Mocka Blob/Speech/LLM no namespace do módulo escriba."""
    download = MagicMock(return_value=b"audio-bytes")
    delete = MagicMock()
    transcrever = MagicMock(return_value=PAYLOAD_DIARIZADO)
    monkeypatch.setattr(escriba, "download_blob", download)
    monkeypatch.setattr(escriba, "delete_blob", delete)
    monkeypatch.setattr(escriba, "_transcrever_consulta_bytes", transcrever)
    monkeypatch.setattr(escriba, "sonnet", MagicMock(return_value=object()))

    parsed = RascunhoFactualOutput(
        resumo_factual="Paciente relatou dificuldade para dormir.",
        queixas_relatadas=["dificuldade para dormir"],
        medicacoes_mencionadas=["Escitalopram"],
        mencao_risco=True,
    )
    llm_calls: list = []

    async def fake_ainvoke_structured(llm, schema, messages):
        llm_calls.append(messages)
        return _fake_structured_call(parsed)

    monkeypatch.setattr(escriba, "ainvoke_structured", fake_ainvoke_structured)
    return SimpleNamespace(
        download=download, delete=delete, transcrever=transcrever, llm_calls=llm_calls
    )


# ─── gerar_rascunho_consulta (teleconsulta: bytes direto, sem storage) ───────


@pytest.mark.asyncio
async def test_pipeline_feliz_propaga_rascunho_e_risco(pipeline_mocks):
    result = await gerar_rascunho_consulta(b"audio", "audio/webm", PACIENTE_ID)

    assert isinstance(result, EscribaResult)
    assert result.transcricao.startswith("Locutor 1:")
    assert result.rascunho["medicacoes_mencionadas"] == ["Escitalopram"]
    assert result.mencao_risco is True
    # Invariante ADR-082: o caminho de bytes NÃO toca storage.
    pipeline_mocks.download.assert_not_called()
    pipeline_mocks.delete.assert_not_called()
    # A transcrição vai ao LLM como mensagem humana
    assert len(pipeline_mocks.llm_calls) == 1


@pytest.mark.asyncio
async def test_transcricao_vazia_nao_chama_llm(pipeline_mocks):
    pipeline_mocks.transcrever.return_value = {"combinedPhrases": [{"text": "   "}]}

    result = await gerar_rascunho_consulta(b"audio", "audio/webm", PACIENTE_ID)

    assert result == EscribaResult(transcricao="", rascunho={}, mencao_risco=False)
    assert pipeline_mocks.llm_calls == []


# ─── gerar_rascunho_consulta_blob (presencial, ADR-075) ──────────────────────

BLOB_KEY = "escriba/paciente/consulta.webm"


@pytest.mark.asyncio
async def test_blob_baixa_transcreve_e_deleta(pipeline_mocks):
    # Presencial: o browser já subiu o áudio via SAS; baixamos a chave,
    # transcrevemos e deletamos (áudio efêmero, LGPD).
    result = await gerar_rascunho_consulta_blob(BLOB_KEY, "audio/webm", PACIENTE_ID)

    assert isinstance(result, EscribaResult)
    assert result.rascunho["medicacoes_mencionadas"] == ["Escitalopram"]
    assert result.mencao_risco is True
    pipeline_mocks.download.assert_called_once_with(BLOB_KEY, escriba.get_settings())
    pipeline_mocks.transcrever.assert_called_once_with(b"audio-bytes", escriba.get_settings())
    pipeline_mocks.delete.assert_called_once_with(BLOB_KEY, escriba.get_settings())
    assert len(pipeline_mocks.llm_calls) == 1


@pytest.mark.asyncio
async def test_blob_deletado_mesmo_se_transcricao_falhar(pipeline_mocks):
    # Invariante LGPD: o delete fica num finally — falha não pode vazar áudio.
    pipeline_mocks.transcrever.side_effect = RuntimeError("Speech falhou")

    with pytest.raises(RuntimeError):
        await gerar_rascunho_consulta_blob(BLOB_KEY, "audio/webm", PACIENTE_ID)

    pipeline_mocks.delete.assert_called_once_with(BLOB_KEY, escriba.get_settings())
    assert pipeline_mocks.llm_calls == []


@pytest.mark.asyncio
async def test_blob_delete_roda_mesmo_se_download_falhar(pipeline_mocks):
    # Best-effort: download quebrado não pode pular o delete (que é idempotente).
    pipeline_mocks.download.side_effect = RuntimeError("blob indisponível")

    with pytest.raises(RuntimeError):
        await gerar_rascunho_consulta_blob(BLOB_KEY, "audio/webm", PACIENTE_ID)

    pipeline_mocks.delete.assert_called_once_with(BLOB_KEY, escriba.get_settings())
    assert pipeline_mocks.llm_calls == []


@pytest.mark.asyncio
async def test_blob_transcricao_vazia_nao_chama_llm(pipeline_mocks):
    pipeline_mocks.transcrever.return_value = {"combinedPhrases": []}

    result = await gerar_rascunho_consulta_blob(BLOB_KEY, "audio/webm", PACIENTE_ID)

    assert result == EscribaResult(transcricao="", rascunho={}, mencao_risco=False)
    assert pipeline_mocks.llm_calls == []
    pipeline_mocks.delete.assert_called_once()


# ─── transcrever_fast (httpx mockado) ────────────────────────────────────────


def _settings_speech() -> SimpleNamespace:
    return SimpleNamespace(
        azure_speech_key=SecretStr("chave-teste"),
        azure_speech_region="eastus",
        transcribe_timeout_s=1.0,
    )


def test_transcrever_fast_pede_diarizacao_e_locale(monkeypatch):
    resp = MagicMock(status_code=200)
    resp.json.return_value = PAYLOAD_DIARIZADO
    post = MagicMock(return_value=resp)
    monkeypatch.setattr(azure_speech.httpx, "post", post)

    payload = transcrever_fast(b"audio", _settings_speech(), max_speakers=2)

    assert payload == PAYLOAD_DIARIZADO
    kwargs = post.call_args.kwargs
    assert "eastus.api.cognitive.microsoft.com" in post.call_args.args[0]
    assert kwargs["headers"]["Ocp-Apim-Subscription-Key"] == "chave-teste"
    definition = kwargs["files"]["definition"][1]
    assert '"pt-BR"' in definition
    assert '"maxSpeakers": 2' in definition


def test_transcrever_fast_sem_diarizacao_omite_bloco(monkeypatch):
    resp = MagicMock(status_code=200)
    resp.json.return_value = {"combinedPhrases": [{"text": "oi"}]}
    post = MagicMock(return_value=resp)
    monkeypatch.setattr(azure_speech.httpx, "post", post)

    transcrever_fast(b"audio", _settings_speech(), max_speakers=None)

    definition = post.call_args.kwargs["files"]["definition"][1]
    assert "diarization" not in definition


def test_transcrever_fast_http_erro_levanta_sem_corpo(monkeypatch):
    # Erro HTTP vira RuntimeError SÓ com o status — nunca ecoa o corpo (LGPD).
    resp = MagicMock(status_code=401)
    resp.text = "detalhe sensível que não pode vazar"
    monkeypatch.setattr(azure_speech.httpx, "post", MagicMock(return_value=resp))

    with pytest.raises(RuntimeError, match="HTTP 401") as exc:
        transcrever_fast(b"audio", _settings_speech())
    assert "sensível" not in str(exc.value)


def test_transcrever_fast_sem_key_falha_rapido():
    settings = SimpleNamespace(
        azure_speech_key=None, azure_speech_region="eastus", transcribe_timeout_s=1.0
    )
    with pytest.raises(RuntimeError, match="AZURE_SPEECH_KEY"):
        transcrever_fast(b"audio", settings)
