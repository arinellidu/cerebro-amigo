"""Agente `adesao` — análise de adesão ao tratamento.

Avalia dois eixos:

1. **Adesão de medicação** — só quando o paciente tem prescrições ativas.
   Calcula taxa por medicamento, sequências de doses perdidas, e trend
   comparando a primeira e segunda metades da janela.
2. **Adesão comportamental** — sempre. Avalia engajamento com o sistema:
   mensagens, entradas de diário compartilhadas, respostas a check-ins.

Trigger por evento: roda a cada tick do scheduler mas só gera `insight`
quando algum threshold é atingido. Dedup window de 24h evita ruído
mesmo em scheduler frequente.

THRESHOLDS DEFENSIVOS: todos os limites são `Settings` com defaults
provisórios. Antes de produção, devem ser revisados pela psiquiatra
responsável (ADR-006).
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import ClassVar, Literal
from uuid import UUID

import structlog
from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, Field

from app.agents.base import AgentPayload, BaseAgent, InsightOutput
from app.core.config import get_settings
from app.core.db import acquire
from app.core.llm import ainvoke_structured, sonnet
from app.core.prompt_loader import get_prompt

logger = structlog.get_logger(__name__)


# ─── Modelos de métricas ───────────────────────────────────────────────────


class TaxaPorPrescricao(BaseModel):
    prescricao_id: UUID
    medicamento: str
    dose_descricao: str
    total_doses: int
    tomadas: int
    taxa: float | None  # None se total_doses == 0


class MetricasAdesao(BaseModel):
    """Métricas calculadas sobre a janela. Tudo computado em SQL/Python,
    sem chamada LLM. Vai direto pro `insights.metadata` para o dashboard
    consumir."""

    janela_dias: int
    janela_inicio: datetime
    janela_fim: datetime

    # ─── Medicação ───
    tem_prescricoes: bool
    taxa_global: float | None = None
    taxas_por_prescricao: list[TaxaPorPrescricao] = Field(default_factory=list)
    max_consecutivas_perdidas: int | None = None
    trend_pp: float | None = None  # diff em pontos % entre 2 metades; negativo = piora

    # ─── Comportamento ───
    dias_desde_ultima_atividade: int | None = None
    contagem_mensagens: int = 0
    contagem_diario_compartilhado: int = 0
    contagem_checkins_respondidos: int = 0
    engajamento_janela_anterior: int | None = None  # mesmo cálculo na janela [-60d, -30d]
    queda_engajamento_pct: float | None = None      # negativa = piorou

    # ─── Output do avaliador de triggers ───
    triggers: list[str] = Field(default_factory=list)
    severidade_algoritmica: Literal["info", "baixa", "media", "alta", "critica"] = "info"


# ─── Output estruturado do LLM ─────────────────────────────────────────────


class AdesaoLLMOutput(BaseModel):
    titulo: str = Field(..., max_length=200)
    narrativa: str = Field(
        ...,
        description="Parágrafo curto (3-5 frases) descrevendo a adesão "
        "observada. Linguagem clínica neutra. Sem diagnóstico, sem prescrição.",
    )
    pontos_relevantes: list[str] = Field(
        default_factory=list,
        description="Até 4 bullets com fatos numéricos do período. "
        "Ex.: 'Taxa global de 58% nas últimas 4 semanas.'",
    )
    sugestoes_topicos: list[str] = Field(
        default_factory=list,
        description="Até 3 tópicos sugeridos para a psiquiatra explorar. "
        "NÃO são diagnósticos nem condutas.",
    )
    severidade: Literal["info", "baixa", "media", "alta", "critica"] = Field(
        ...,
        description="Pode confirmar ou divergir da severidade algorítmica "
        "se o contexto narrativo justificar.",
    )


# ─── Prompts ───────────────────────────────────────────────────────────────


ADESAO_SYSTEM_V1 = """Você é o agente analítico Cérebro Amigo · adesão. Sua tarefa é descrever \
para a psiquiatra o padrão de adesão ao tratamento de um paciente no período \
analisado, com base em métricas pré-calculadas.

PRINCÍPIOS:
1. Você NÃO é médico(a). Não diagnostique. Não recomende dose, troca de \
   medicação ou conduta. Apenas descreva o que os dados mostram e sugira \
   tópicos a explorar.
2. Use os números fornecidos. NÃO INVENTE estatísticas que não estão no \
   payload. Se o paciente não tem prescrições ativas, NÃO escreva sobre \
   medicação — foque em engajamento comportamental.
3. Distinga adesão de medicação de adesão comportamental. Pode haver os \
   dois eixos juntos ou só um.
4. Linguagem clínica neutra. Evite "preocupante" sem contexto numérico. \
   Prefira "redução de 22pp em comparação à janela anterior".
5. Severidade reflete a urgência clínica do que você está reportando. \
   `critica` é reservado para combinação de fatores graves (ex.: adesão \
   < 50% em medicação psiquiátrica + inatividade prolongada)."""


def _build_user_prompt(nome: str, metricas: MetricasAdesao) -> str:
    return (
        f"Paciente: {nome}\n"
        f"Janela analisada: {metricas.janela_dias} dias "
        f"({metricas.janela_inicio.date()} a {metricas.janela_fim.date()})\n\n"
        f"Triggers que dispararam este insight: {metricas.triggers}\n"
        f"Severidade algorítmica (baseada em thresholds objetivos): "
        f"{metricas.severidade_algoritmica}\n\n"
        f"=== Métricas calculadas ===\n"
        f"{metricas.model_dump_json(indent=2, exclude={'triggers', 'severidade_algoritmica'})}\n\n"
        f"Escreva o insight conforme o schema. Severidade pode ser ajustada "
        f"se o contexto narrativo justificar — mas mantenha alinhamento com "
        f"a severidade algorítmica salvo justificativa clara nos pontos."
    )


# ─── Helper: nível máximo de severidade ────────────────────────────────────

_SEVERIDADE_ORDEM = ["info", "baixa", "media", "alta", "critica"]


def _max_sev(*niveis: str) -> str:
    """Retorna o maior nível dentre os passados."""
    idx = 0
    for n in niveis:
        if n in _SEVERIDADE_ORDEM:
            idx = max(idx, _SEVERIDADE_ORDEM.index(n))
    return _SEVERIDADE_ORDEM[idx]


# ─── O Agente ──────────────────────────────────────────────────────────────


class AdesaoAgent(BaseAgent):
    name: ClassVar[str] = "adesao"
    dedup_window_hours: ClassVar[int] = 24

    async def find_pending(self) -> AsyncIterator[AgentPayload]:
        """Itera por candidatos e yield-a só quando há trigger ativo."""
        candidatos = await self._listar_candidatos()
        log = logger.bind(agente=self.name)

        for paciente_id, medico_id in candidatos:
            try:
                metricas = await self._carregar_metricas(paciente_id)
            except Exception as exc:
                log.exception(
                    "metrics.failed",
                    paciente_id=str(paciente_id),
                    error=str(exc),
                )
                continue

            self._avaliar_triggers(metricas)
            if not metricas.triggers:
                continue

            yield AgentPayload(
                paciente_id=paciente_id,
                medico_id=medico_id,
                extra={
                    "metricas_json": metricas.model_dump_json(),
                },
            )

    async def execute(self, payload: AgentPayload) -> InsightOutput:
        metricas = MetricasAdesao.model_validate_json(payload.extra["metricas_json"])
        nome = await self._get_nome(payload.paciente_id)

        call = await ainvoke_structured(
            sonnet(temperature=0.2),
            AdesaoLLMOutput,
            [
                SystemMessage(content=await get_prompt("agents", "adesao")),
                HumanMessage(content=_build_user_prompt(nome, metricas)),
            ],
        )
        narrativa: AdesaoLLMOutput = call.parsed  # type: ignore[assignment]

        # Severidade final: maior entre algorítmica e narrativa. LLM pode
        # subir mas não baixar — garante que algoritmo conservador prevalece.
        severidade_final = _max_sev(metricas.severidade_algoritmica, narrativa.severidade)

        conteudo_md = _format_markdown(narrativa, metricas)
        settings = get_settings()

        return InsightOutput(
            paciente_id=payload.paciente_id,
            medico_id=payload.medico_id,
            titulo=narrativa.titulo,
            conteudo=conteudo_md,
            severidade=severidade_final,
            metadata={
                "agente_versao": "v1",
                "metricas": json.loads(metricas.model_dump_json()),
                "triggers": metricas.triggers,
                "severidade_algoritmica": metricas.severidade_algoritmica,
                "severidade_llm": narrativa.severidade,
                "pontos_relevantes": narrativa.pontos_relevantes,
                "sugestoes_topicos": narrativa.sugestoes_topicos,
            },
            tokens_in=call.tokens_in,
            tokens_out=call.tokens_out,
            custo_usd=call.custo_usd,
            modelo=call.model_id or settings.model_sonnet,
        )

    # ─── Pré-filtragem ──────────────────────────────────────────────────────

    async def _listar_candidatos(self) -> list[tuple[UUID, UUID]]:
        """Retorna `(paciente_id, medico_id)` para pacientes que valem
        analisar agora. Pré-filtragem barata em SQL puro."""
        async with acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT p.cliente_id AS paciente_id, p.medico_responsavel_id AS medico_id
                FROM pacientes p
                WHERE
                    -- tem prescrição ativa OU
                    EXISTS (
                        SELECT 1 FROM prescricoes pr
                        WHERE pr.paciente_id = p.cliente_id AND pr.ativa = TRUE
                    )
                    -- OU teve atividade recente (vale checar engajamento)
                    OR EXISTS (
                        SELECT 1 FROM mensagens m
                        JOIN conversas c ON c.id = m.conversa_id
                        WHERE c.cliente_id = p.cliente_id
                          AND m.criada_em > NOW() - INTERVAL '60 days'
                    )
                """,
            )
        return [(r["paciente_id"], r["medico_id"]) for r in rows]

    # ─── Cálculo de métricas ────────────────────────────────────────────────

    async def _carregar_metricas(self, paciente_id: UUID) -> MetricasAdesao:
        settings = get_settings()
        janela = settings.adesao_janela_dias
        agora = datetime.now(UTC)
        inicio = agora - timedelta(days=janela)

        metricas = MetricasAdesao(
            janela_dias=janela,
            janela_inicio=inicio,
            janela_fim=agora,
            tem_prescricoes=False,
        )

        async with acquire() as conn:
            # Medicação
            await self._calcular_medicacao(conn, paciente_id, metricas, settings)
            # Engajamento comportamental
            await self._calcular_engajamento(conn, paciente_id, metricas, settings)

        return metricas

    async def _calcular_medicacao(
        self, conn, paciente_id: UUID, m: MetricasAdesao, settings
    ) -> None:
        # 1. Tem prescrição ativa?
        prescricoes = await conn.fetch(
            """
            SELECT id, medicamento, dose_descricao
            FROM prescricoes
            WHERE paciente_id = $1 AND ativa = TRUE
            """,
            paciente_id,
        )
        if not prescricoes:
            m.tem_prescricoes = False
            return
        m.tem_prescricoes = True

        # 2. Taxa por prescrição (considera só doses cujo horario_previsto
        # já passou + tolerância)
        tol = timedelta(hours=settings.adesao_tolerancia_pendente_horas)
        cutoff = m.janela_fim - tol

        taxas = []
        total_tomadas = 0
        total_doses = 0
        for pr in prescricoes:
            row = await conn.fetchrow(
                """
                SELECT
                    COUNT(*) AS total,
                    COUNT(*) FILTER (WHERE status = 'tomada') AS tomadas
                FROM tomadas_medicacao
                WHERE prescricao_id = $1
                  AND horario_previsto BETWEEN $2 AND $3
                """,
                pr["id"],
                m.janela_inicio,
                cutoff,
            )
            total = row["total"] or 0
            tomadas = row["tomadas"] or 0
            taxa = (tomadas / total) if total > 0 else None

            taxas.append(
                TaxaPorPrescricao(
                    prescricao_id=pr["id"],
                    medicamento=pr["medicamento"],
                    dose_descricao=pr["dose_descricao"],
                    total_doses=total,
                    tomadas=tomadas,
                    taxa=taxa,
                )
            )
            total_doses += total
            total_tomadas += tomadas

        m.taxas_por_prescricao = taxas
        m.taxa_global = (total_tomadas / total_doses) if total_doses > 0 else None

        # 3. Máximo de consecutivas perdidas (em Python — mais legível que SQL window)
        rows = await conn.fetch(
            """
            SELECT status, horario_previsto
            FROM tomadas_medicacao
            WHERE paciente_id = $1
              AND horario_previsto BETWEEN $2 AND $3
            ORDER BY horario_previsto
            """,
            paciente_id,
            m.janela_inicio,
            cutoff,
        )
        max_seq, cur = 0, 0
        for row in rows:
            perdida = row["status"] != "tomada"
            if perdida:
                cur += 1
                max_seq = max(max_seq, cur)
            else:
                cur = 0
        m.max_consecutivas_perdidas = max_seq if rows else None

        # 4. Trend: compara primeira metade com segunda metade da janela
        if total_doses >= 4:  # evita ruído com amostras pequenas
            metade_dt = m.janela_inicio + (m.janela_fim - m.janela_inicio) / 2
            primeira = await self._taxa_periodo(
                conn, paciente_id, m.janela_inicio, metade_dt
            )
            segunda = await self._taxa_periodo(
                conn, paciente_id, metade_dt, cutoff
            )
            if primeira is not None and segunda is not None:
                m.trend_pp = round((segunda - primeira) * 100, 2)

    async def _taxa_periodo(
        self, conn, paciente_id: UUID, inicio: datetime, fim: datetime
    ) -> float | None:
        row = await conn.fetchrow(
            """
            SELECT
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE status = 'tomada') AS tomadas
            FROM tomadas_medicacao
            WHERE paciente_id = $1
              AND horario_previsto BETWEEN $2 AND $3
            """,
            paciente_id,
            inicio,
            fim,
        )
        total = row["total"] or 0
        tomadas = row["tomadas"] or 0
        return (tomadas / total) if total > 0 else None

    async def _calcular_engajamento(
        self, conn, paciente_id: UUID, m: MetricasAdesao, settings
    ) -> None:
        # Última atividade clinicamente relevante
        ultima = await conn.fetchval(
            """
            SELECT MAX(ts) FROM (
                SELECT MAX(m.criada_em) AS ts
                FROM mensagens m
                JOIN conversas c ON c.id = m.conversa_id
                WHERE c.cliente_id = $1 AND m.papel = 'user'

                UNION ALL

                SELECT MAX(criada_em) FROM diario_entradas
                WHERE paciente_id = $1

                UNION ALL

                SELECT MAX(respondido_em) FROM checkins
                WHERE paciente_id = $1 AND respondido_em IS NOT NULL
            ) t
            """,
            paciente_id,
        )
        if ultima is not None:
            m.dias_desde_ultima_atividade = (m.janela_fim - ultima).days

        # Contagens na janela
        m.contagem_mensagens = (
            await conn.fetchval(
                """
                SELECT COUNT(*)
                FROM mensagens m
                JOIN conversas c ON c.id = m.conversa_id
                WHERE c.cliente_id = $1
                  AND m.papel = 'user'
                  AND m.criada_em BETWEEN $2 AND $3
                """,
                paciente_id,
                m.janela_inicio,
                m.janela_fim,
            )
            or 0
        )
        m.contagem_diario_compartilhado = (
            await conn.fetchval(
                """
                SELECT COUNT(*) FROM diario_entradas
                WHERE paciente_id = $1
                  AND compartilhada_com_medico = TRUE
                  AND criada_em BETWEEN $2 AND $3
                """,
                paciente_id,
                m.janela_inicio,
                m.janela_fim,
            )
            or 0
        )
        m.contagem_checkins_respondidos = (
            await conn.fetchval(
                """
                SELECT COUNT(*) FROM checkins
                WHERE paciente_id = $1
                  AND respondido_em BETWEEN $2 AND $3
                """,
                paciente_id,
                m.janela_inicio,
                m.janela_fim,
            )
            or 0
        )

        # Engajamento na janela ANTERIOR (mesma duração, mas deslocada)
        anterior_inicio = m.janela_inicio - timedelta(days=m.janela_dias)
        anterior_fim = m.janela_inicio
        anterior = (
            await conn.fetchval(
                """
                SELECT (
                    (SELECT COUNT(*) FROM mensagens m
                     JOIN conversas c ON c.id = m.conversa_id
                     WHERE c.cliente_id = $1 AND m.papel = 'user'
                       AND m.criada_em BETWEEN $2 AND $3)
                  + (SELECT COUNT(*) FROM diario_entradas
                     WHERE paciente_id = $1 AND criada_em BETWEEN $2 AND $3)
                  + (SELECT COUNT(*) FROM checkins
                     WHERE paciente_id = $1
                       AND respondido_em BETWEEN $2 AND $3)
                )
                """,
                paciente_id,
                anterior_inicio,
                anterior_fim,
            )
            or 0
        )
        m.engajamento_janela_anterior = anterior

        atual_total = (
            m.contagem_mensagens
            + m.contagem_diario_compartilhado
            + m.contagem_checkins_respondidos
        )
        if anterior > 0:
            m.queda_engajamento_pct = round((atual_total - anterior) / anterior, 4)

    # ─── Avaliação de triggers ──────────────────────────────────────────────

    def _avaliar_triggers(self, m: MetricasAdesao) -> None:
        """Aplica thresholds e popula m.triggers + m.severidade_algoritmica.

        Esta lógica é determinística por design — a severidade do LLM (que
        pode ver narrativa) pode subir mas não baixar. Ver `execute()`.
        """
        s = get_settings()
        triggers: list[str] = []
        sev = "info"

        # ─── Medicação ───
        if m.taxa_global is not None:
            if m.taxa_global < s.adesao_threshold_taxa_alta:
                triggers.append("taxa_global_critica")
                sev = _max_sev(sev, "alta")
            elif m.taxa_global < s.adesao_threshold_taxa_media:
                triggers.append("taxa_global_baixa")
                sev = _max_sev(sev, "media")

        if m.max_consecutivas_perdidas is not None:
            if m.max_consecutivas_perdidas >= s.adesao_threshold_consecutivas_alta:
                triggers.append("consecutivas_perdidas_critica")
                sev = _max_sev(sev, "alta")
            elif m.max_consecutivas_perdidas >= s.adesao_threshold_consecutivas_media:
                triggers.append("consecutivas_perdidas")
                sev = _max_sev(sev, "media")

        if m.trend_pp is not None and m.trend_pp < -s.adesao_threshold_queda_trend_pp:
            triggers.append("trend_medicacao_negativo")
            sev = _max_sev(sev, "media")

        # ─── Adesão por prescrição individual ───
        # (uma prescrição com adesão muito baixa, mesmo se a global estiver ok)
        for taxa in m.taxas_por_prescricao:
            if (
                taxa.taxa is not None
                and taxa.total_doses >= 5  # amostra mínima
                and taxa.taxa < s.adesao_threshold_taxa_alta
                and "prescricao_individual_critica" not in triggers
            ):
                triggers.append("prescricao_individual_critica")
                sev = _max_sev(sev, "alta")

        # ─── Comportamental ───
        if (
            m.dias_desde_ultima_atividade is not None
            and m.dias_desde_ultima_atividade >= s.adesao_threshold_inatividade_dias
        ):
            triggers.append("inatividade_comportamental")
            sev = _max_sev(sev, "media")

        if (
            m.queda_engajamento_pct is not None
            and m.queda_engajamento_pct <= -s.adesao_threshold_queda_engajamento_pct
            and m.engajamento_janela_anterior is not None
            and m.engajamento_janela_anterior >= 5  # amostra mínima
        ):
            triggers.append("queda_engajamento")
            sev = _max_sev(sev, "media")

        # ─── Escalada combinatória ───
        # 2+ triggers de severidade alta = critica (ex.: medicação ruim
        # + paciente sumido)
        triggers_alta = [
            t
            for t in triggers
            if t.endswith("_critica") or t == "consecutivas_perdidas_critica"
        ]
        if len(triggers_alta) >= 2:
            sev = "critica"

        m.triggers = triggers
        m.severidade_algoritmica = sev  # type: ignore[assignment]

    # ─── Helpers ────────────────────────────────────────────────────────────

    async def _get_nome(self, paciente_id: UUID) -> str:
        async with acquire() as conn:
            row = await conn.fetchrow(
                "SELECT nome FROM clientes WHERE id = $1", paciente_id
            )
        return row["nome"] if row and row["nome"] else ""


# ─── Renderizador Markdown ─────────────────────────────────────────────────


def _format_markdown(narrativa: AdesaoLLMOutput, m: MetricasAdesao) -> str:
    lines = [f"## {narrativa.titulo}", "", narrativa.narrativa, ""]

    if narrativa.pontos_relevantes:
        lines.append("### Pontos relevantes")
        lines.extend(f"- {p}" for p in narrativa.pontos_relevantes)
        lines.append("")

    # Tabela compacta por medicamento, se houver
    if m.tem_prescricoes and m.taxas_por_prescricao:
        lines.append("### Adesão por medicação")
        lines.append("| Medicamento | Dose | Tomadas / Total | Taxa |")
        lines.append("|---|---|---|---|")
        for t in m.taxas_por_prescricao:
            taxa_str = f"{t.taxa:.0%}" if t.taxa is not None else "—"
            lines.append(
                f"| {t.medicamento} | {t.dose_descricao} | "
                f"{t.tomadas} / {t.total_doses} | {taxa_str} |"
            )
        lines.append("")

    if narrativa.sugestoes_topicos:
        lines.append("### Sugestões de tópicos para a consulta")
        lines.extend(f"- {s}" for s in narrativa.sugestoes_topicos)
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"
