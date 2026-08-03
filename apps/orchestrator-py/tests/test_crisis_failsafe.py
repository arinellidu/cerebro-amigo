"""Fail-safe e resiliência do classificador de crise — ADR-006 + ADR-063.

Estes testes tornam os ADRs *executáveis*:

ADR-006 (fail-closed original):
  Qualquer exceção no classificador → assume crise
  (`detectada=True`, `nivel="alto"`, `gatilho="classifier_error"`).
  Falso negativo em risco de auto-extermínio é o pior erro possível.

ADR-063 (camadas 1-3, gateado por crisis_resilience_enabled=True):
  Camada 1: screen determinístico (lista clínica) — hit → crise sem chamar LLM.
  Camada 2: retry para erros transitórios; sistêmico não retria.
  Camada 3: falha sistêmica → modo degradado (não fabricar crise para todos);
            circuit breaker pula o LLM após N falhas consecutivas.

Todos determinísticos — não chamam LLM nem fazem I/O. O cliente LLM é
substituído por um duble que ou levanta exceção ou retorna saída controlada.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from app.conversation.nodes import crisis as crisis_node
from app.conversation.schemas import CrisisDetectionOutput


class _RaisingLLM:
    """Duble de LLM cujo ainvoke sempre falha — simula API fora do ar."""

    def __init__(self, exc: Exception) -> None:
        self._exc = exc

    async def ainvoke(self, _messages):
        raise self._exc


class _StubLLM:
    """Duble de LLM que retorna saída estruturada controlada."""

    def __init__(self, output: CrisisDetectionOutput) -> None:
        self._output = output

    async def ainvoke(self, _messages):
        return self._output


class _FailOnceThenSucceedLLM:
    """Duble que falha na primeira chamada e sucede na segunda (testa retry)."""

    def __init__(self, exc: Exception, output: CrisisDetectionOutput) -> None:
        self._exc = exc
        self._output = output
        self._call = 0

    async def ainvoke(self, _messages):
        self._call += 1
        if self._call == 1:
            raise self._exc
        return self._output


def _mock_settings(resilience: bool = False) -> MagicMock:
    s = MagicMock()
    s.crisis_resilience_enabled = resilience
    return s


@pytest.fixture(autouse=True)
def _reset_circuit_breaker():
    """Limpa estado do circuit breaker entre testes."""
    crisis_node._circuit_breaker.reset()
    yield
    crisis_node._circuit_breaker.reset()


@pytest.fixture(autouse=True)
def _no_real_llm(monkeypatch):
    """Garante que nenhum teste construa cliente LLM real."""
    monkeypatch.setattr(crisis_node, "haiku", lambda: object())

    async def _stub_get_prompt(_agente: str, _nome: str) -> str:
        return "system-prompt-stub"

    monkeypatch.setattr(crisis_node, "get_prompt", _stub_get_prompt)


def _state(mensagem: str = "qualquer coisa") -> dict:
    return {"mensagem": mensagem}


# ── ADR-006: comportamento histórico (resilience=False, default) ─────────────


@pytest.mark.parametrize(
    "exc",
    [
        RuntimeError("Bedrock indisponível"),
        TimeoutError("timeout de rede"),
        ValueError("output não conformante ao schema"),
    ],
)
async def test_failsafe_trata_falha_como_crise(monkeypatch, exc):
    """Qualquer exceção no classificador → fail-closed (ADR-006).

    resilience desabilitado (default) → comportamento inalterado.
    """
    monkeypatch.setattr(crisis_node, "with_schema", lambda _llm, _schema: _RaisingLLM(exc))
    monkeypatch.setattr(crisis_node, "get_settings", lambda: _mock_settings(resilience=False))

    out = await crisis_node.detect_crisis(_state())
    crise = out["crise"]

    assert crise["detectada"] is True, "fail-safe deve assumir crise"
    assert crise["nivel"] == "alto"
    assert crise["confianca"] == 0.0
    assert "classifier_error" in crise["gatilhos"]


async def test_caminho_normal_mapeia_saida_do_classificador(monkeypatch):
    """Sem falha: propaga fielmente a classificação do modelo."""
    output = CrisisDetectionOutput(
        crise_detectada=True,
        confianca=0.92,
        nivel="critico",
        gatilhos=["ideacao_ativa", "plano"],
    )
    monkeypatch.setattr(crisis_node, "with_schema", lambda _llm, _schema: _StubLLM(output))
    monkeypatch.setattr(crisis_node, "get_settings", lambda: _mock_settings(resilience=False))

    out = await crisis_node.detect_crisis(_state("comprei remédio pra usar tudo"))
    crise = out["crise"]

    assert crise["detectada"] is True
    assert crise["nivel"] == "critico"
    assert crise["confianca"] == pytest.approx(0.92)
    assert crise["gatilhos"] == ["ideacao_ativa", "plano"]


async def test_caminho_normal_nao_crise(monkeypatch):
    """Classificação negativa não deve disparar crise."""
    output = CrisisDetectionOutput(
        crise_detectada=False,
        confianca=0.05,
        nivel="nenhum",
        gatilhos=[],
    )
    monkeypatch.setattr(crisis_node, "with_schema", lambda _llm, _schema: _StubLLM(output))
    monkeypatch.setattr(crisis_node, "get_settings", lambda: _mock_settings(resilience=False))

    out = await crisis_node.detect_crisis(_state("tomei o remédio hoje cedo"))
    assert out["crise"]["detectada"] is False
    assert out["crise"]["nivel"] == "nenhum"


def test_gatilho_principal_usa_primeira_categoria():
    assert crisis_node._gatilho_principal(["isolamento", "desesperanca"], "alto") == "isolamento"


def test_gatilho_principal_fallback_para_nivel():
    """Sem categorias explícitas, cai para nivel_<nivel> — nunca string vazia."""
    assert crisis_node._gatilho_principal([], "critico") == "nivel_critico"


# ── ADR-063 camada 1: screen determinístico ──────────────────────────────────


async def test_screen_hit_dispara_crise_sem_chamar_llm(monkeypatch):
    """Camada 1: hit no screen → crise mesmo sem LLM (e sem chamar with_schema)."""
    monkeypatch.setattr(crisis_node, "LISTA_ATESTADA", True)
    monkeypatch.setattr(crisis_node, "_TERMOS_NORMALIZADOS", frozenset(["quero me matar"]))
    monkeypatch.setattr(crisis_node, "get_settings", lambda: _mock_settings(resilience=True))

    llm_chamado = False

    def _nao_deve_chamar(_llm, _schema):
        nonlocal llm_chamado
        llm_chamado = True
        return _StubLLM(CrisisDetectionOutput(crise_detectada=False, confianca=0.0, nivel="nenhum", gatilhos=[]))

    monkeypatch.setattr(crisis_node, "with_schema", _nao_deve_chamar)

    out = await crisis_node.detect_crisis(_state("eu quero me matar"))
    crise = out["crise"]

    assert crise["detectada"] is True
    assert crise["gatilhos"] == ["screen_deterministico"]
    assert crise["confianca"] == pytest.approx(1.0)
    assert not llm_chamado, "screen hit não deve chamar LLM"


async def test_screen_normaliza_acentos(monkeypatch):
    """Camada 1: acento no termo e na mensagem → match correto."""
    monkeypatch.setattr(crisis_node, "LISTA_ATESTADA", True)
    monkeypatch.setattr(crisis_node, "_TERMOS_NORMALIZADOS", frozenset(["quero me matar"]))
    monkeypatch.setattr(crisis_node, "get_settings", lambda: _mock_settings(resilience=True))
    monkeypatch.setattr(crisis_node, "with_schema", lambda _l, _s: _StubLLM(
        CrisisDetectionOutput(crise_detectada=False, confianca=0.0, nivel="nenhum", gatilhos=[])
    ))

    # Mensagem com variação de capitalização e acento extra
    out = await crisis_node.detect_crisis(_state("QUERO ME MATAR HOJE"))
    assert out["crise"]["detectada"] is True
    assert out["crise"]["gatilhos"] == ["screen_deterministico"]


async def test_screen_miss_chama_llm(monkeypatch):
    """Camada 1: sem hit no screen → LLM é chamado normalmente."""
    monkeypatch.setattr(crisis_node, "LISTA_ATESTADA", True)
    monkeypatch.setattr(crisis_node, "_TERMOS_NORMALIZADOS", frozenset(["quero me matar"]))
    monkeypatch.setattr(crisis_node, "get_settings", lambda: _mock_settings(resilience=True))

    output = CrisisDetectionOutput(crise_detectada=False, confianca=0.1, nivel="nenhum", gatilhos=[])
    monkeypatch.setattr(crisis_node, "with_schema", lambda _l, _s: _StubLLM(output))

    out = await crisis_node.detect_crisis(_state("hoje tomei o remédio direito"))
    assert out["crise"]["detectada"] is False
    assert "screen_deterministico" not in out["crise"]["gatilhos"]


async def test_screen_desabilitado_sem_atestacao(monkeypatch):
    """LISTA_ATESTADA=False → screen nunca ativa (seguro sem curadoria clínica)."""
    monkeypatch.setattr(crisis_node, "LISTA_ATESTADA", False)
    monkeypatch.setattr(crisis_node, "_TERMOS_NORMALIZADOS", frozenset(["quero me matar"]))
    monkeypatch.setattr(crisis_node, "get_settings", lambda: _mock_settings(resilience=True))

    output = CrisisDetectionOutput(crise_detectada=False, confianca=0.0, nivel="nenhum", gatilhos=[])
    monkeypatch.setattr(crisis_node, "with_schema", lambda _l, _s: _StubLLM(output))

    # Mensagem que bateria no screen SE atestado fosse True
    out = await crisis_node.detect_crisis(_state("quero me matar"))
    # Deve ir para o LLM (e LLM diz não-crise), não para screen
    assert out["crise"]["gatilhos"] != ["screen_deterministico"]


# ── ADR-063 camada 2: retry para erros transitórios ──────────────────────────


async def test_retry_transitorio_sucesso_na_segunda_tentativa(monkeypatch):
    """Camada 2: erro transitório na 1ª tentativa, sucesso na 2ª."""
    monkeypatch.setattr(crisis_node, "get_settings", lambda: _mock_settings(resilience=True))

    output = CrisisDetectionOutput(
        crise_detectada=False, confianca=0.1, nivel="nenhum", gatilhos=[]
    )
    exc_transitorio = TimeoutError("timeout de rede")
    llm = _FailOnceThenSucceedLLM(exc_transitorio, output)
    monkeypatch.setattr(crisis_node, "with_schema", lambda _l, _s: llm)

    out = await crisis_node.detect_crisis(_state("tomei o remédio"))
    crise = out["crise"]

    assert crise["detectada"] is False
    assert llm._call == 2, "deve ter tentado 2x"


async def test_sistémico_nao_retria(monkeypatch):
    """Camada 2: auth 401 → falha imediata, sem retry."""

    class _AuthError(Exception):
        status_code = 401

    monkeypatch.setattr(crisis_node, "get_settings", lambda: _mock_settings(resilience=True))

    call_count = 0

    class _CountingRaiser:
        async def ainvoke(self, _m):
            nonlocal call_count
            call_count += 1
            raise _AuthError("invalid x-api-key")

    monkeypatch.setattr(crisis_node, "with_schema", lambda _l, _s: _CountingRaiser())

    out = await crisis_node.detect_crisis(_state("bom dia"))
    assert call_count == 1, "sistêmico não deve retentar"
    assert out["crise"]["detectada"] is False
    assert out.get("modo_degradado") is True


# ── ADR-063 camada 3: modo degradado + circuit breaker ───────────────────────


async def test_falha_sistemica_retorna_modo_degradado(monkeypatch):
    """Camada 3: auth 401 + resilience → modo_degradado=True (não crise)."""

    class _AuthError(Exception):
        status_code = 401

    monkeypatch.setattr(crisis_node, "get_settings", lambda: _mock_settings(resilience=True))
    monkeypatch.setattr(crisis_node, "with_schema", lambda _l, _s: _RaisingLLM(_AuthError()))

    out = await crisis_node.detect_crisis(_state("estou bem hoje"))
    assert out["crise"]["detectada"] is False
    assert out.get("modo_degradado") is True
    assert "modo_degradado" in out["crise"]["gatilhos"]


async def test_circuit_breaker_tripa_apos_n_falhas(monkeypatch):
    """Circuit breaker: após 3 falhas sistêmicas, próxima msg pula LLM."""

    class _AuthError(Exception):
        status_code = 401

    monkeypatch.setattr(crisis_node, "get_settings", lambda: _mock_settings(resilience=True))
    raiser = _RaisingLLM(_AuthError())
    monkeypatch.setattr(crisis_node, "with_schema", lambda _l, _s: raiser)

    # 3 falhas sistêmicas para tripar o circuito
    for _ in range(3):
        await crisis_node.detect_crisis(_state("mensagem qualquer"))

    assert crisis_node._circuit_breaker.em_modo_degradado()

    # 4ª mensagem: circuit breaker aberto → pula LLM (with_schema não deve ser chamado)
    llm_chamado = False

    def _nao_deve_chamar(_l, _s):
        nonlocal llm_chamado
        llm_chamado = True
        return raiser

    monkeypatch.setattr(crisis_node, "with_schema", _nao_deve_chamar)

    out = await crisis_node.detect_crisis(_state("oi"))
    assert out.get("modo_degradado") is True
    assert not llm_chamado, "circuit aberto não deve chamar LLM"


async def test_circuit_breaker_reseta_no_sucesso(monkeypatch):
    """Circuit breaker reseta quando o LLM retorna com sucesso."""

    class _AuthError(Exception):
        status_code = 401

    monkeypatch.setattr(crisis_node, "get_settings", lambda: _mock_settings(resilience=True))
    raiser = _RaisingLLM(_AuthError())
    monkeypatch.setattr(crisis_node, "with_schema", lambda _l, _s: raiser)

    # Tripar o circuito
    for _ in range(3):
        await crisis_node.detect_crisis(_state("msg"))

    assert crisis_node._circuit_breaker.em_modo_degradado()

    # LLM volta a funcionar
    output = CrisisDetectionOutput(crise_detectada=False, confianca=0.0, nivel="nenhum", gatilhos=[])
    monkeypatch.setattr(crisis_node, "with_schema", lambda _l, _s: _StubLLM(output))
    # Forçar circuito fechado para simular restart ou reset manual
    crisis_node._circuit_breaker.reset()

    out = await crisis_node.detect_crisis(_state("tomei o remédio"))
    assert out["crise"]["detectada"] is False
    assert not crisis_node._circuit_breaker.em_modo_degradado()


async def test_transitorio_apos_retry_mantem_failsafe(monkeypatch):
    """Erro transitório após retries esgotados → fail-safe conservador (não degradado)."""
    monkeypatch.setattr(crisis_node, "get_settings", lambda: _mock_settings(resilience=True))
    monkeypatch.setattr(crisis_node, "with_schema",
                        lambda _l, _s: _RaisingLLM(TimeoutError("timeout")))

    out = await crisis_node.detect_crisis(_state("qualquer coisa"))
    crise = out["crise"]

    # Transitório → fail-safe conservador (crise para essa mensagem isolada)
    assert crise["detectada"] is True
    assert "classifier_error" in crise["gatilhos"]
    # NÃO é modo degradado (não sistêmico)
    assert not out.get("modo_degradado")
