"""Entrega garantida do alerta de crise ao médico (ADR-041, Fase 1).

Orientado a `protocolos_crise_acionados` (a fonte da verdade do evento de
crise), não mais ao opt-in de e-mail. Cada tentativa de cada canal e o ack do
médico viram uma linha append-only em `crise_alerta_eventos`. O estado
(entregue? confirmado? estágio?) é DERIVADO por query.

Escada da Fase 1 (sem vendor novo — SMS/WhatsApp/retaguarda são F2/F3):
  estágio 0 (imediato)         e-mail ao médico, SEMPRE (sem gate de opt-in).
  estágio 1 (sem ack > X min)  reenvia e-mail + alerta OPS (log crítico + trilha).
  estágio 2 (sem ack > Y min)  alerta OPS crítico.
A escada PARA assim que existir um evento 'confirmado' (ack do médico no
dashboard, gravado pelo gateway).

LGPD: o e-mail e o `detalhe` da trilha NÃO contêm detalhe clínico. O corpo só
diz que um paciente precisa de atenção prioritária + link do painel; `detalhe`
carrega apenas código de canal (ex.: "http_502", "sem_email").

Duas entradas:
  * `despachar_crise_protocolo(id)` — caminho imediato (trigger do orchestrator).
  * `despachar_crise_medico()`      — watchdog periódico (varre crises abertas).
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

import structlog

from app.core.config import get_settings
from app.core.db import acquire
from app.core.email import send_email

logger = structlog.get_logger(__name__)


# ─── Canal: e-mail (cópia mínima, sem detalhe clínico) ───────────────────────


async def _enviar_email(destinatario: str, *, assunto: str, corpo: str) -> tuple[bool, str]:
    """Envia o e-mail de alerta pelo provider ativo (`EMAIL_PROVIDER`, ADR-073).

    Retorna (ok, detalhe_sem_pii). O `detalhe` (id da mensagem em sucesso, código
    de erro em falha) vai para `crise_alerta_eventos.detalhe` — a escada (ADR-041)
    decide por `ok`/eventos, nunca pelo valor textual do detalhe.
    """
    return await send_email(to=destinatario, subject=assunto, text=corpo)


def _corpo_email(paciente_nome: str | None, *, reforco: bool) -> tuple[str, str]:
    """(assunto, corpo) — mínimo, sem citar 'crise' nem detalhe clínico (LGPD)."""
    nome = paciente_nome or "Um paciente"
    dashboard = os.getenv("DASHBOARD_URL", "http://localhost:3000/dashboard")
    prefixo = "Ainda aguarda sua avaliação: " if reforco else ""
    assunto = "Cérebro Amigo · atenção prioritária a um paciente"
    corpo = (
        f"{prefixo}{nome} precisa de atenção prioritária no Cérebro Amigo.\n\n"
        f"Abra o painel para avaliar: {dashboard}\n\n"
        "— Cérebro Amigo (mensagem automática; não responda este e-mail)."
    )
    return assunto, corpo


# ─── Trilha ──────────────────────────────────────────────────────────────────


async def _registrar_evento(
    protocolo_id: UUID,
    medico_id: UUID | None,
    *,
    canal: str,
    evento: str,
    estagio: int = 0,
    detalhe: str | None = None,
) -> None:
    async with acquire() as conn:
        await conn.execute(
            """
            INSERT INTO crise_alerta_eventos
                (protocolo_id, medico_id, canal, evento, estagio, detalhe)
            VALUES ($1, $2, $3, $4, $5, $6)
            """,
            protocolo_id,
            medico_id,
            canal,
            evento,
            estagio,
            detalhe,
        )


# ─── Decisão da escada (determinística, testável) ────────────────────────────


def _idade_segundos(criado_em: datetime) -> float:
    agora = datetime.now(UTC)
    return (agora - criado_em).total_seconds()


@dataclass(frozen=True)
class _EstadoAlerta:
    """Estado derivado dos eventos já gravados de um protocolo de crise."""

    email_enviado: bool
    email_falhas: int
    ops_sem_email: bool
    ops_email_indispo: bool
    ops_estagio1: bool
    ops_estagio2: bool
    reforco_enviado: bool


def _estado_de_eventos(eventos) -> _EstadoAlerta:
    """Reduz as linhas de crise_alerta_eventos ao estado da escada."""
    return _EstadoAlerta(
        email_enviado=any(e["canal"] == "email" and e["evento"] == "enviado" for e in eventos),
        email_falhas=sum(1 for e in eventos if e["canal"] == "email" and e["evento"] == "falhou"),
        ops_sem_email=any(e["canal"] == "ops" and e["detalhe"] == "sem_email" for e in eventos),
        ops_email_indispo=any(
            e["canal"] == "ops" and e["detalhe"] == "email_indisponivel" for e in eventos
        ),
        ops_estagio1=any(e["canal"] == "ops" and e["estagio"] == 1 for e in eventos),
        ops_estagio2=any(e["canal"] == "ops" and e["estagio"] == 2 for e in eventos),
        reforco_enviado=any(e["canal"] == "email" and e["estagio"] == 1 for e in eventos),
    )


def _proxima_etapa(
    idade_s: float, st: _EstadoAlerta, *, ack_timeout_s: int, ops_timeout_s: int
) -> str:
    """Próxima etapa da escada (PURA — sem I/O, fácil de testar).

    Ordem: reforço após ack_timeout → OPS após ops_timeout → garantir e-mail
    inicial. Cada etapa só dispara se ainda não foi cumprida (idempotente).
    Protocolos já confirmados (ack) são filtrados na SQL antes de chegar aqui.

    FAIL-SAFE (ADR-041): a escalação por TEMPO NÃO depende do sucesso do e-mail.
    Os estágios por idade são avaliados ANTES do e-mail inicial e gateados pelos
    marcadores OPS (`ops_estagio1`/`ops_estagio2`, sempre gravados quando o
    estágio dispara), nunca por `email_enviado` (que fica False se o Resend cai).
    Assim "e-mail fora + sem ack" continua subindo até o OPS crítico — senão a
    falha MAIS grave (canal de e-mail down) escalaria MENOS que o médico só
    distraído, deixando o paciente descoberto em silêncio.

    Retorna: 'reforco_estagio1' | 'ops_estagio2' | 'email_inicial' | 'aguardando'.
    """
    if idade_s >= ack_timeout_s and not st.ops_estagio1:
        return "reforco_estagio1"
    if idade_s >= ops_timeout_s and not st.ops_estagio2:
        return "ops_estagio2"
    if not st.email_enviado:
        return "email_inicial"
    return "aguardando"


async def _processar_protocolo(row) -> str:
    """Avalia um protocolo aberto e executa a próxima ação da escada.

    Idempotente por tick: a decisão vem de `_proxima_etapa` (pura) sobre os
    eventos já gravados; cada etapa age uma única vez. Retorna um rótulo do que
    foi feito (para métricas/log)."""
    settings = get_settings()
    protocolo_id: UUID = row["protocolo_id"]
    medico_id: UUID | None = row["medico_id"]
    medico_email: str | None = row["medico_email"]
    paciente_nome: str | None = row["paciente_nome"]
    idade = _idade_segundos(row["criado_em"])

    async with acquire() as conn:
        eventos = await conn.fetch(
            "SELECT canal, evento, estagio, detalhe FROM crise_alerta_eventos "
            "WHERE protocolo_id = $1",
            protocolo_id,
        )
    st = _estado_de_eventos(eventos)
    etapa = _proxima_etapa(
        idade,
        st,
        ack_timeout_s=settings.crise_ack_timeout_segundos,
        ops_timeout_s=settings.crise_ops_timeout_segundos,
    )

    # ── Estágio 0: garantir o e-mail inicial ──
    if etapa == "email_inicial":
        if not medico_email:
            # Falha que hoje passa em silêncio: médico sem e-mail cadastrado.
            if not st.ops_sem_email:
                logger.critical(
                    "crise.alerta.sem_email",
                    protocolo_id=str(protocolo_id),
                    medico_id=str(medico_id) if medico_id else None,
                )
                await _registrar_evento(
                    protocolo_id, medico_id, canal="ops", evento="falhou",
                    estagio=0, detalhe="sem_email",
                )
            return "sem_email"

        assunto, corpo = _corpo_email(paciente_nome, reforco=False)
        ok, detalhe = await _enviar_email(medico_email, assunto=assunto, corpo=corpo)
        await _registrar_evento(
            protocolo_id, medico_id, canal="email",
            evento="enviado" if ok else "falhou", estagio=0, detalhe=detalhe,
        )
        if ok:
            return "email_enviado"
        # Resend indisponível: torna a falha VISÍVEL após o teto de tentativas.
        if st.email_falhas + 1 >= settings.crise_email_max_tentativas and not st.ops_email_indispo:
            logger.critical(
                "crise.alerta.email_indisponivel",
                protocolo_id=str(protocolo_id),
                tentativas=st.email_falhas + 1,
            )
            await _registrar_evento(
                protocolo_id, medico_id, canal="ops", evento="falhou",
                estagio=0, detalhe="email_indisponivel",
            )
        return "email_falhou"

    # ── Estágio 1: sem ack após o timeout → reforço + OPS ──
    if etapa == "reforco_estagio1":
        if medico_email:
            assunto, corpo = _corpo_email(paciente_nome, reforco=True)
            ok, detalhe = await _enviar_email(medico_email, assunto=assunto, corpo=corpo)
            await _registrar_evento(
                protocolo_id, medico_id, canal="email",
                evento="enviado" if ok else "falhou", estagio=1, detalhe=detalhe,
            )
        if not st.ops_estagio1:
            logger.critical(
                "crise.alerta.sem_ack",
                protocolo_id=str(protocolo_id), idade_s=int(idade), estagio=1,
            )
            await _registrar_evento(
                protocolo_id, medico_id, canal="ops", evento="enfileirado",
                estagio=1, detalhe="sem_ack_estagio1",
            )
        return "estagio1"

    # ── Estágio 2: ainda sem ack → OPS crítico ──
    if etapa == "ops_estagio2":
        logger.critical(
            "crise.alerta.sem_ack",
            protocolo_id=str(protocolo_id), idade_s=int(idade), estagio=2,
        )
        await _registrar_evento(
            protocolo_id, medico_id, canal="ops", evento="falhou",
            estagio=2, detalhe="sem_ack_estagio2",
        )
        return "estagio2"

    return "aguardando"


# ─── Query base: crises abertas (sem ack) ────────────────────────────────────

_SELECT_ABERTAS = """
    SELECT p.id AS protocolo_id, p.criado_em,
           m.id AS medico_id, u.email AS medico_email,
           cl.nome AS paciente_nome
    FROM protocolos_crise_acionados p
    JOIN pacientes pat ON pat.cliente_id = p.paciente_id
    JOIN medicos m ON m.id = pat.medico_responsavel_id
    JOIN usuarios u ON u.id = m.usuario_id
    LEFT JOIN clientes cl ON cl.id = p.paciente_id
    WHERE p.criado_em > NOW() - INTERVAL '48 hours'
      AND NOT EXISTS (
          SELECT 1 FROM crise_alerta_eventos e
          WHERE e.protocolo_id = p.id AND e.evento = 'confirmado'
      )
"""


async def despachar_crise_protocolo(protocolo_id: UUID) -> dict:
    """Caminho imediato: despacha o alerta de UM protocolo (trigger do
    orchestrator logo após o protocolo de crise ser gravado)."""
    async with acquire() as conn:
        row = await conn.fetchrow(
            _SELECT_ABERTAS + " AND p.id = $1", protocolo_id
        )
    if row is None:
        # Já confirmado, inexistente, ou fora da janela — nada a fazer.
        return {"protocolo_id": str(protocolo_id), "acao": "ignorado"}
    acao = await _processar_protocolo(row)
    logger.info("crise.despacho.imediato", protocolo_id=str(protocolo_id), acao=acao)
    return {"protocolo_id": str(protocolo_id), "acao": acao}


async def despachar_crise_medico() -> dict:
    """Watchdog: varre crises abertas e executa a próxima ação da escada de
    cada uma. Roda no scheduler; é a rede durável caso o trigger imediato
    falhe (notifier fora no T0, etc.)."""
    async with acquire() as conn:
        pendentes = await conn.fetch(
            _SELECT_ABERTAS + " ORDER BY p.criado_em LIMIT 100"
        )

    contagem: dict[str, int] = {}
    for row in pendentes:
        acao = await _processar_protocolo(row)
        contagem[acao] = contagem.get(acao, 0) + 1

    logger.info("crise.watchdog.done", abertas=len(pendentes), **contagem)
    return {"abertas": len(pendentes), **contagem}
