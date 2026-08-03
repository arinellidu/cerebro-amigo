"""Nós de detecção e protocolo de crise.

`detect_crisis`: Haiku com 4 camadas de resiliência (ADR-063).
`crisis_protocol`: SEM LLM. Texto fixo, grava trilha e aciona o alerta ao médico.
`degraded_response`: modo degradado — LLM sistemicamente fora, sem crise explícita.

── Camadas ADR-063 em `detect_crisis` ────────────────────────────────────────

  1. Screen determinístico (LISTA_ATESTADA + _TERMOS_NORMALIZADOS):
     lista curada pelo clínico de termos explícitos pt-BR. Alta precisão.
     Roda SEMPRE quando crisis_resilience_enabled=True, independente do LLM.
     Hit → crise dispara mesmo num outage total da API.
     LISTA_ATESTADA=False (padrão) → screen desabilitado até atestação do Adonai.

  2. Retry com backoff para erros transitórios (timeout, 5xx isolado).
     Sistêmico (auth 401/403) → sem retry, falha imediata para não atrasar.

  3. Modo degradado quando LLM está sistemicamente fora:
     - screen (camada 1) SEGUE ativo — explícito ainda dispara crise.
     - mensagens sem hit no screen → `degraded_response` (não fabricar crise).
     - circuit breaker: 3 falhas sistêmicas consecutivas → pula LLM em futuras msgs.

  4. Observabilidade: Sentry alert quando classificador cai (já estava; mantido).

── Ordem em `crisis_protocol` (tudo numa transação) ─────────────────────────

  1. INSERT protocolos_crise_acionados (RETURNING id) — fonte da verdade da crise
  2. INSERT notificacoes_medico (severidade='critica') — canal in-app
  3. INSERT crise_alerta_eventos (canal='in_app') — abre a trilha de entrega (ADR-041)
  4. UPDATE conversas.status = 'humano'
  5. UPDATE pacientes.automacao_pausada = TRUE (defesa em camadas)
  6. INSERT mensagens (papel='assistant', conteudo=texto_protocolo, cifrado)

Após o commit: trigger best-effort ao notifier (`/internal/crise/despachar`)
para o e-mail sair em segundos. O watchdog do notifier é a rede durável se o
trigger falhar. Entrega, escalonamento e ack vivem em `crise_alerta_eventos`.
"""

from __future__ import annotations

import asyncio
import json
import re
import unicodedata
from uuid import UUID

import structlog
from langchain_core.messages import HumanMessage, SystemMessage

from app.config import get_settings
from app.conversation.crisis_copy import CRISIS_COPY, INSTABILIDADE_COPY, texto_protocolo
from app.conversation.llm import haiku, with_schema
from app.conversation.prompt_loader import get_prompt
from app.conversation.schemas import CrisisDetectionOutput
from app.conversation.state import ConversaState
from app.core.crypto import encrypt
from app.db import acquire

logger = structlog.get_logger(__name__)

# Referências fortes às tasks de trigger (evita GC enquanto rodam).
_background_tasks: set[asyncio.Task] = set()


def _schedule_notifier_trigger(protocolo_id: UUID) -> None:
    """Dispara o alerta ao notifier SEM bloquear a resposta ao paciente.

    Best-effort: sem event loop ou em falha de rede, o watchdog do notifier
    (varre `protocolos_crise_acionados` abertos) é a rede durável."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:  # pragma: no cover
        logger.warning("crise.trigger.no_loop", protocolo_id=str(protocolo_id))
        return
    task = loop.create_task(_notificar_notifier(protocolo_id))
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)


async def _notificar_notifier(protocolo_id: UUID) -> None:
    settings = get_settings()
    try:
        import httpx
    except ImportError:  # pragma: no cover
        logger.warning("crise.trigger.no_httpx", protocolo_id=str(protocolo_id))
        return
    url = settings.notifier_url.rstrip("/") + "/internal/crise/despachar"
    token = settings.internal_api_token.get_secret_value()
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            await client.post(
                url,
                headers={"Authorization": f"Bearer {token}"},
                json={"protocolo_id": str(protocolo_id)},
            )
        logger.info("crise.trigger.ok", protocolo_id=str(protocolo_id))
    except Exception as exc:
        logger.warning(
            "crise.trigger.failed", protocolo_id=str(protocolo_id), error=str(exc)
        )


# ── Camada 4 do ADR-063: observabilidade do classificador de crise ──────────
# PURA INSTRUMENTAÇÃO — alerta engenharia em minutos via Sentry.
# LGPD/R4: capture_message (não capture_exception) — não anexa frame locals.


def _classify_llm_error(exc: Exception) -> tuple[str, bool]:
    """Retorna (error_class, is_systemic).

    Sistêmico = afeta TODOS os pacientes (config/credencial), não é ambiguidade de
    uma mensagem isolada: auth (401/403). Esse é o sinal que precisa gritar.
    """
    status = getattr(exc, "status_code", None)
    if status is None:
        status = getattr(getattr(exc, "response", None), "status_code", None)
    name = type(exc).__name__
    if status in (401, 403) or "Authentication" in name or "PermissionDenied" in name:
        return "auth", True
    if status == 429 or "RateLimit" in name:
        return "rate_limit", False
    if isinstance(status, int) and 500 <= status < 600:
        return "server", False
    return "other", False


def _report_classifier_down(exc: Exception, error_class: str, systemic: bool) -> None:
    """Alerta de OPS no Sentry. Best-effort: nunca derruba o caminho de crise.

    Fingerprint estável → 1 issue agrupada (não spamma 1 por mensagem).
    Gate manual: regra de alerta no Sentry mirando `component:crisis_classifier`
    (nível fatal) → e-mail/Slack à engenharia.
    """
    try:
        import sentry_sdk
    except ImportError:
        return
    try:
        status = getattr(exc, "status_code", None)
        with sentry_sdk.push_scope() as scope:
            scope.set_tag("component", "crisis_classifier")
            scope.set_tag("error_class", error_class)
            scope.set_tag("systemic", "true" if systemic else "false")
            if status is not None:
                scope.set_tag("http_status", str(status))
            scope.set_level("fatal" if systemic else "error")
            scope.fingerprint = ["crisis-classifier-down", error_class]
            detalhe = f"{error_class} / {type(exc).__name__}"
            if status is not None:
                detalhe += f" / HTTP {status}"
            sentry_sdk.capture_message(
                f"crisis classifier indisponível (ADR-063 camada 4): {detalhe}",
                level="fatal" if systemic else "error",
            )
    except Exception:  # nunca deixa a observabilidade derrubar a crise
        logger.warning("crisis.detect.sentry_capture_failed")


# ── Camada 3 do ADR-063: circuit breaker ────────────────────────────────────


class _CircuitBreaker:
    """Circuit breaker para falhas sistêmicas do classificador.

    Thread-safe para uso em contexto async (single-thread event loop do uvicorn).
    Resets automaticamente ao primeiro sucesso do LLM.
    """

    def __init__(self, limite: int = 3) -> None:
        self._limite = limite
        self._falhas = 0
        self._degradado = False

    def em_modo_degradado(self) -> bool:
        return self._degradado

    def registrar_sucesso(self) -> None:
        if self._degradado or self._falhas > 0:
            logger.info(
                "crisis.circuit_breaker.reset",
                falhas_anteriores=self._falhas,
            )
        self._falhas = 0
        self._degradado = False

    def registrar_falha_sistemica(self) -> bool:
        """Registra falha sistêmica. Retorna True se circuito acabou de tripar."""
        self._falhas += 1
        if not self._degradado and self._falhas >= self._limite:
            self._degradado = True
            logger.error(
                "crisis.circuit_breaker.tripped",
                falhas=self._falhas,
                limite=self._limite,
            )
            return True
        return False

    def reset(self) -> None:
        """Limpa estado entre testes."""
        self._falhas = 0
        self._degradado = False

    def estado(self) -> dict:
        return {"degradado": self._degradado, "falhas": self._falhas}


_circuit_breaker = _CircuitBreaker(limite=3)


# ── Camada 1 do ADR-063: screen determinístico ───────────────────────────────
# ATENÇÃO: lista clínica. NÃO EDITAR sem revisão + atestação do Adonai Arinelli.
#
# LISTA_ATESTADA = False → screen desabilitado (retorna False sempre).
# Quando Adonai atestar: (1) preencher _TERMOS_CRISE_RAW,
# (2) LISTA_ATESTADA = True, (3) PR com revisão clínica documentada.
LISTA_ATESTADA: bool = False

_TERMOS_CRISE_RAW: list[str] = [
    # RASCUNHO — AGUARDANDO CURADORIA E ATESTAÇÃO DO CLÍNICO (ADONAI ARINELLI).
    # Inserir termos explícitos de ideação suicida/autolesão em pt-BR.
    # NÃO inventar, parafrasear ou traduzir — lista vem do clínico.
    # Otimizado para PRECISÃO (minimizar falso-positivo), não exaustividade.
]


def _normalizar_texto(texto: str) -> str:
    """Lowercase + remove acentos + colapsa espaços."""
    nfkd = unicodedata.normalize("NFKD", texto.lower())
    sem_acento = "".join(c for c in nfkd if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", sem_acento).strip()


_TERMOS_NORMALIZADOS: frozenset[str] = frozenset(
    _normalizar_texto(t) for t in _TERMOS_CRISE_RAW
)


def _screen_deterministico(texto: str) -> bool:
    """Camada 1 (ADR-063): True se hit em termo explícito curado.

    Alta precisão, não exaustivo — complementa, não substitui, o LLM.
    LISTA_ATESTADA=False → sempre False (seguro sem atestação clínica).
    """
    if not LISTA_ATESTADA or not _TERMOS_NORMALIZADOS:
        return False
    norm = _normalizar_texto(texto)
    return any(termo in norm for termo in _TERMOS_NORMALIZADOS)


# ── Nó principal ────────────────────────────────────────────────────────────


async def detect_crisis(state: ConversaState) -> dict:
    settings = get_settings()
    mensagem = state["mensagem"]

    # ── Camada 1: screen determinístico (independente do LLM) ──────────────
    if settings.crisis_resilience_enabled and _screen_deterministico(mensagem):
        logger.info("crisis.detect.screen_hit")
        return {
            "crise": {
                "detectada": True,
                "confianca": 1.0,
                "nivel": "alto",
                "gatilhos": ["screen_deterministico"],
            }
        }

    # ── Camada 3: circuit breaker tripado → modo degradado imediato ─────────
    if settings.crisis_resilience_enabled and _circuit_breaker.em_modo_degradado():
        logger.warning("crisis.detect.circuito_aberto")
        return {
            "crise": {
                "detectada": False,
                "confianca": 0.0,
                "nivel": "nenhum",
                "gatilhos": ["modo_degradado"],
            },
            "modo_degradado": True,
        }

    # ── Camada 2: chamada LLM com retry para transitórios ───────────────────
    llm = with_schema(haiku(), CrisisDetectionOutput)
    prompt = await get_prompt("orchestrator", "crisis_detection")

    max_tentativas = 2 if settings.crisis_resilience_enabled else 1
    exc_final: Exception | None = None
    error_class_final = "other"
    systemic_final = False

    for tentativa in range(max_tentativas):
        try:
            result: CrisisDetectionOutput = await llm.ainvoke(
                [
                    SystemMessage(content=prompt),
                    HumanMessage(content=mensagem),
                ]
            )
            _circuit_breaker.registrar_sucesso()
            logger.info(
                "crisis.detect.done",
                detectada=result.crise_detectada,
                nivel=result.nivel,
                confianca=result.confianca,
            )
            return {
                "crise": {
                    "detectada": result.crise_detectada,
                    "confianca": result.confianca,
                    "nivel": result.nivel,
                    "gatilhos": result.gatilhos,
                }
            }
        except Exception as exc:
            error_class, systemic = _classify_llm_error(exc)
            exc_final = exc
            error_class_final = error_class
            systemic_final = systemic
            # Sistêmico não retria (auth 401/403 não melhora com retry).
            # Última tentativa: sai do loop para o handler de falha.
            if systemic or tentativa == max_tentativas - 1:
                break
            await asyncio.sleep(0.5)

    # Todas as tentativas falharam.
    logger.error(
        "crisis.detect.failed",
        error=str(exc_final),
        error_class=error_class_final,
        systemic=systemic_final,
    )
    # Camada 4: torna o outage visível à engenharia.
    if exc_final is not None:
        _report_classifier_down(exc_final, error_class_final, systemic_final)

    if settings.crisis_resilience_enabled:
        if systemic_final:
            # Camada 3: falha sistêmica → modo degradado (não fabricar crise para todos).
            _circuit_breaker.registrar_falha_sistemica()
            return {
                "crise": {
                    "detectada": False,
                    "confianca": 0.0,
                    "nivel": "nenhum",
                    "gatilhos": ["modo_degradado"],
                },
                "modo_degradado": True,
            }
        # Transitório após retries: fail-safe conservador para ESTA mensagem isolada.
        # Camada 1 já cobre explícito; este caminho = nuance que só LLM pegaria.
        return {
            "crise": {
                "detectada": True,
                "confianca": 0.0,
                "nivel": "alto",
                "gatilhos": ["classifier_error"],
            }
        }

    # resilience desabilitado: comportamento histórico inalterado (ADR-006 fail-safe).
    return {
        "crise": {
            "detectada": True,
            "confianca": 0.0,
            "nivel": "alto",
            "gatilhos": ["classifier_error"],
        }
    }


def _gatilho_principal(gatilhos: list[str], nivel: str) -> str:
    """`protocolos_crise_acionados.gatilho` é texto único.

    Usa a primeira categoria do classificador, ou o nível como fallback.
    """
    if gatilhos:
        return gatilhos[0]
    return f"nivel_{nivel}"


async def crisis_protocol(state: ConversaState) -> dict:
    paciente_id = state["paciente_id"]
    medico_id = state["medico_responsavel_id"]
    conversa_id = state["conversa_id"]
    mensagem_db_id = state["mensagem_db_id"]
    crise = state["crise"]
    texto = texto_protocolo()
    settings = get_settings()

    metadata = {
        "nivel": crise["nivel"],
        "confianca": crise["confianca"],
        "gatilhos": crise["gatilhos"],
        "copy_versao": CRISIS_COPY.versao,
        "copy_hash": CRISIS_COPY.hash_sha256,
    }

    async with acquire() as conn, conn.transaction():
        # 1. Trilha de auditoria (fonte da verdade da crise). `medico_notificado`
        #    aqui = "processo de alerta iniciado"; a entrega/ack REAIS vivem em
        #    crise_alerta_eventos (ADR-041), já que esta linha é imutável.
        protocolo_id = await conn.fetchval(
            """
            INSERT INTO protocolos_crise_acionados
                (paciente_id, medico_id, mensagem_id, gatilho, palavras_detectadas,
                 confianca, resposta_enviada, medico_notificado,
                 medico_notificado_em)
            VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, NOW())
            RETURNING id
            """,
            paciente_id,
            medico_id,
            mensagem_db_id,
            _gatilho_principal(crise["gatilhos"], crise["nivel"]),
            crise["gatilhos"],
            crise["confianca"],
            texto,
        )

        # 2. Notifica médico (canal in-app — aparece no dashboard)
        await conn.execute(
            """
            INSERT INTO notificacoes_medico
                (medico_id, paciente_id, severidade, tipo,
                 titulo, mensagem, metadata)
            VALUES ($1, $2, 'critica', 'crise', $3, $4, $5::jsonb)
            """,
            medico_id,
            paciente_id,
            f"Protocolo de crise acionado (nível: {crise['nivel']})",
            (
                f"O paciente enviou uma mensagem classificada como risco "
                f"{crise['nivel']} (confiança {crise['confianca']:.2f}). "
                f"A automação foi suspensa e a conversa foi marcada para "
                f"intervenção humana. Resposta padrão de crise (v"
                f"{CRISIS_COPY.versao}) foi enviada ao paciente."
            ),
            json.dumps(metadata, ensure_ascii=False),
        )

        # 3. Abre a trilha de entrega do alerta (ADR-041). O canal in-app já
        #    está entregue (a notificação acima aparece no dashboard).
        await conn.execute(
            """
            INSERT INTO crise_alerta_eventos
                (protocolo_id, medico_id, canal, evento, estagio, detalhe)
            VALUES ($1, $2, 'in_app', 'enviado', 0, 'notificacao_dashboard')
            """,
            protocolo_id,
            medico_id,
        )

        # 4. Escala conversa para humano
        await conn.execute(
            "UPDATE conversas SET status = 'humano' WHERE id = $1",
            conversa_id,
        )

        # 5. Pausa automação do paciente (toggle global)
        await conn.execute(
            "UPDATE pacientes SET automacao_pausada = TRUE WHERE cliente_id = $1",
            paciente_id,
        )

        # 6. Mensagem do bot persistida — texto fixo de protocolo (cifrado)
        key = get_settings().encryption_key
        key_str = key.get_secret_value() if key else None
        await conn.execute(
            """
            INSERT INTO mensagens (conversa_id, papel, conteudo, modelo_usado)
            VALUES ($1, 'assistant', $2, $3)
            """,
            conversa_id,
            encrypt(texto, key_str),
            f"crisis_copy:{CRISIS_COPY.versao}",
        )

    # Trigger imediato ao notifier (best-effort; watchdog é a rede durável).
    _schedule_notifier_trigger(protocolo_id)

    # O texto vai pro paciente via SSE/PWA — não há envio HTTP aqui.
    logger.warning(
        "crisis.protocol.executed",
        paciente_id=str(paciente_id),
        nivel=crise["nivel"],
        copy_versao=CRISIS_COPY.versao,
        shadow_mode=settings.shadow_mode,
    )

    return {
        "resposta_final": texto,
        "enviado": not settings.shadow_mode,
        "automacao_pausada": True,
        "conversa_status": "humano",
    }


async def degraded_response(state: ConversaState) -> dict:
    """ADR-063 camada 3: classificador sistemicamente indisponível, sem hit no screen.

    NÃO dispara protocolo de crise (evita flood de falsos-positivos no médico).
    NÃO seta automacao_pausada (não é crise confirmada).
    Escala para revisão humana + notifica médico com tipo 'instabilidade_tecnica'.
    Envia texto neutro ao paciente SOMENTE se INSTABILIDADE_COPY.atestado=True.
    """
    paciente_id = state["paciente_id"]
    medico_id = state["medico_responsavel_id"]
    conversa_id = state["conversa_id"]
    settings = get_settings()

    texto_paciente: str | None = None

    async with acquire() as conn, conn.transaction():
        # Escala para revisão humana — não é crise, é falha técnica.
        await conn.execute(
            "UPDATE conversas SET status = 'humano' WHERE id = $1",
            conversa_id,
        )

        # Notifica médico com tipo 'instabilidade_tecnica' (não 'crise').
        # Severidade 'media' para não confundir com protocolo de crise real.
        await conn.execute(
            """
            INSERT INTO notificacoes_medico
                (medico_id, paciente_id, severidade, tipo, titulo, mensagem, metadata)
            VALUES ($1, $2, 'media', 'instabilidade_tecnica', $3, $4, $5::jsonb)
            """,
            medico_id,
            paciente_id,
            "Classificador de crise temporariamente indisponível",
            (
                "O paciente enviou uma mensagem, mas a classificação automática de "
                "risco está indisponível por instabilidade técnica. "
                "A conversa foi escalada para revisão humana. Verifique a mensagem."
            ),
            json.dumps(
                {"modo_degradado": True, "cb_estado": _circuit_breaker.estado()},
                ensure_ascii=False,
            ),
        )

        # Envia texto neutro ao paciente apenas se cópia atestada pelo clínico.
        if INSTABILIDADE_COPY.atestado and not settings.shadow_mode:
            key = settings.encryption_key
            key_str = key.get_secret_value() if key else None
            await conn.execute(
                """
                INSERT INTO mensagens (conversa_id, papel, conteudo, modelo_usado)
                VALUES ($1, 'assistant', $2, $3)
                """,
                conversa_id,
                encrypt(INSTABILIDADE_COPY.texto, key_str),
                f"instabilidade_copy:{INSTABILIDADE_COPY.versao}",
            )
            texto_paciente = INSTABILIDADE_COPY.texto

    logger.warning(
        "crisis.degraded_response.executed",
        paciente_id=str(paciente_id),
        texto_enviado=texto_paciente is not None,
        copy_atestada=INSTABILIDADE_COPY.atestado,
        cb_estado=_circuit_breaker.estado(),
    )

    return {
        "resposta_final": texto_paciente,
        "enviado": texto_paciente is not None,
        "conversa_status": "humano",
    }
