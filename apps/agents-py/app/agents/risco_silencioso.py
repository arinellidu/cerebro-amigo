"""Agente `risco_silencioso` — detecta retraimento clínico.

Levanta a bandeira quando o paciente para de interagir COM o sistema **e**
os sinais imediatamente anteriores ao silêncio sugerem que pode não ser
um sumiço benigno (viagem, fim de semana tranquilo).

Lógica em duas fases:

1. **Trigger de ausência** — atinge severidade base `media` se:
   - dias desde última atividade ≥ threshold absoluto (default 14d), OU
   - dias atuais > p95 dos intervalos históricos do paciente x multiplicador
     (default 1.5), exigindo amostra mínima (default 5 intervalos)

2. **Escalada por sinais negativos prévios** — antes do silêncio:
   - humor ≤ threshold_baixo (default 3/10), OU
   - ansiedade ≥ threshold_alto (default 8/10), OU
   - última tomada de medicação foi `esquecida`, OU
   - última entrada de diário compartilhada com humor ≤ threshold_baixo, OU
   - protocolo de crise nos últimos 30 dias

   1 sinal → severidade `alta`
   2+ sinais → severidade `critica`
   Crise nos últimos 14 dias (mais recente que o threshold de 30d) → `critica`
   diretamente.

Princípio: o sistema não diagnostica retraimento. Sinaliza ausência com
contexto, deixando a psiquiatra decidir.

Dedup window: 7 dias. Não vamos notificar diariamente sobre o mesmo
paciente silencioso — uma vez por semana basta até o silêncio quebrar.
"""

from __future__ import annotations

import json
import statistics
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


# ─── Helpers de severidade (reaproveitado do adesao) ───────────────────────

_SEVERIDADE_ORDEM = ["info", "baixa", "media", "alta", "critica"]


def _max_sev(*niveis: str) -> str:
    idx = 0
    for n in niveis:
        if n in _SEVERIDADE_ORDEM:
            idx = max(idx, _SEVERIDADE_ORDEM.index(n))
    return _SEVERIDADE_ORDEM[idx]


# ─── Modelos de métricas ───────────────────────────────────────────────────


class SinalNegativo(BaseModel):
    tipo: Literal[
        "humor_baixo_mensagem",
        "ansiedade_alta_mensagem",
        "medicacao_esquecida",
        "humor_baixo_diario",
        "crise_recente",
        "crise_muito_recente",
    ]
    detalhe: str  # parafraseado, sem verbatim de paciente
    quando: datetime


class MetricasRiscoSilencioso(BaseModel):
    dias_desde_ultima_atividade: int | None = None
    ultima_atividade_em: datetime | None = None

    # Histórico de intervalos
    intervalos_historicos_dias: list[int] = Field(default_factory=list)
    p95_intervalo_historico: float | None = None
    amostras_suficientes: bool = False

    # Por que o agente acionou
    triggers: list[str] = Field(default_factory=list)
    sinais_negativos_pre_silencio: list[SinalNegativo] = Field(default_factory=list)
    severidade_algoritmica: Literal["info", "baixa", "media", "alta", "critica"] = "info"


# ─── Output estruturado do LLM ─────────────────────────────────────────────


class RiscoSilenciosoLLMOutput(BaseModel):
    titulo: str = Field(..., max_length=200)
    narrativa: str = Field(
        ...,
        description="2-4 frases descrevendo a ausência e o contexto. "
        "Tom factual; explicita ausência sem patologizar. NÃO diagnostique.",
    )
    pontos_relevantes: list[str] = Field(
        default_factory=list,
        description="Até 4 bullets com fatos do período: tempo de ausência, "
        "sinais negativos identificados antes do silêncio, padrão habitual "
        "do paciente quando disponível.",
    )
    sugestoes_topicos: list[str] = Field(
        default_factory=list,
        description="Até 3 sugestões de ação ou abordagem para a psiquiatra "
        "considerar. Não são condutas clínicas obrigatórias.",
    )
    severidade: Literal["info", "baixa", "media", "alta", "critica"] = Field(
        ...,
        description="Pode confirmar ou subir a severidade algorítmica. NÃO "
        "deve baixar — algoritmo conservador prevalece.",
    )


# ─── Prompts ───────────────────────────────────────────────────────────────


RISCO_SILENCIOSO_SYSTEM_V1 = """Você é o agente analítico Cérebro Amigo · risco silencioso. Sua tarefa é \
notificar a psiquiatra quando um paciente para de interagir com o sistema e \
os sinais imediatamente anteriores ao silêncio sugerem que vale acompanhar.

PRINCÍPIOS:
1. Você NÃO é médico(a). NÃO diagnostique "retraimento", "recaída" ou \
   "episódio depressivo". Limite-se a descrever ausência + sinais factuais.
2. Use somente os fatos do payload (datas, contagens, sinais negativos \
   identificados). NÃO INVENTE.
3. Distinga claramente "ausência sem outros sinais" de "ausência precedida \
   de sinais negativos". O primeiro pode ser sumiço benigno (viagem, vida \
   tranquila); o segundo pede atenção.
4. Quando há protocolo de crise recente (especialmente nos últimos 14 dias), \
   o tom da notificação muda — ausência após crise é particularmente \
   relevante.
5. Sugira ações abertas (ex.: "considerar contato direto"), NUNCA prescreva \
   conduta clínica."""


def _build_user_prompt(nome: str, metricas: MetricasRiscoSilencioso) -> str:
    return (
        f"Paciente: {nome}\n"
        f"Dias desde última atividade: {metricas.dias_desde_ultima_atividade}\n"
        f"Última atividade em: {metricas.ultima_atividade_em}\n\n"
        f"Padrão histórico do paciente:\n"
        f"  Amostras suficientes: {metricas.amostras_suficientes}\n"
        f"  P95 de intervalos: {metricas.p95_intervalo_historico} dias "
        f"(em {len(metricas.intervalos_historicos_dias)} intervalos prévios)\n\n"
        f"Triggers de ausência: {metricas.triggers}\n"
        f"Severidade algorítmica: {metricas.severidade_algoritmica}\n\n"
        f"Sinais negativos identificados nos 7 dias ANTES do silêncio:\n"
        f"{json.dumps([s.model_dump(mode='json') for s in metricas.sinais_negativos_pre_silencio], ensure_ascii=False, indent=2, default=str)}\n\n"
        f"Escreva conforme o schema. Severidade pode subir mas não baixar."
    )


# ─── O Agente ──────────────────────────────────────────────────────────────


class RiscoSilenciosoAgent(BaseAgent):
    name: ClassVar[str] = "risco_silencioso"
    dedup_window_hours: ClassVar[int] = 24 * 7  # 1 vez por semana por paciente

    async def find_pending(self) -> AsyncIterator[AgentPayload]:
        candidatos = await self._listar_candidatos()
        log = logger.bind(agente=self.name)

        for paciente_id, medico_id in candidatos:
            try:
                metricas = await self._calcular_metricas(paciente_id)
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
                extra={"metricas_json": metricas.model_dump_json()},
            )

    async def execute(self, payload: AgentPayload) -> InsightOutput:
        metricas = MetricasRiscoSilencioso.model_validate_json(
            payload.extra["metricas_json"]
        )
        nome = await self._get_nome(payload.paciente_id)

        call = await ainvoke_structured(
            sonnet(temperature=0.2),
            RiscoSilenciosoLLMOutput,
            [
                SystemMessage(content=await get_prompt("agents", "risco_silencioso")),
                HumanMessage(content=_build_user_prompt(nome, metricas)),
            ],
        )
        narrativa: RiscoSilenciosoLLMOutput = call.parsed  # type: ignore[assignment]

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
                "dias_desde_ultima_atividade": metricas.dias_desde_ultima_atividade,
                "p95_historico_dias": metricas.p95_intervalo_historico,
                "amostras_suficientes": metricas.amostras_suficientes,
                "triggers": metricas.triggers,
                "severidade_algoritmica": metricas.severidade_algoritmica,
                "severidade_llm": narrativa.severidade,
                "sinais_negativos_pre_silencio": [
                    s.model_dump(mode="json")
                    for s in metricas.sinais_negativos_pre_silencio
                ],
                "pontos_relevantes": narrativa.pontos_relevantes,
                "sugestoes_topicos": narrativa.sugestoes_topicos,
            },
            tokens_in=call.tokens_in,
            tokens_out=call.tokens_out,
            custo_usd=call.custo_usd,
            modelo=call.model_id or settings.model_sonnet,
        )

    # ─── Candidatos ─────────────────────────────────────────────────────────

    async def _listar_candidatos(self) -> list[tuple[UUID, UUID]]:
        """Pacientes ativos que ainda NÃO têm insight de risco_silencioso na
        janela de dedup (7 dias). Evita escanear per-patient quem já foi
        notificado — ADR-014 dedup-no-SQL (fix G-2 DEBT.md)."""
        dedup_seconds = self.dedup_window_hours * 3600
        async with acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT p.cliente_id AS paciente_id,
                       p.medico_responsavel_id AS medico_id
                FROM pacientes p
                WHERE NOT EXISTS (
                    SELECT 1 FROM insights i
                    WHERE i.paciente_id = p.cliente_id
                      AND i.agente = $1
                      AND i.descartado_em IS NULL
                      AND i.criado_em >= NOW() - ($2 * INTERVAL '1 second')
                )
                """,
                self.name,
                dedup_seconds,
            )
        return [(r["paciente_id"], r["medico_id"]) for r in rows]

    # ─── Métricas ───────────────────────────────────────────────────────────

    async def _calcular_metricas(self, paciente_id: UUID) -> MetricasRiscoSilencioso:
        agora = datetime.now(UTC)
        m = MetricasRiscoSilencioso()

        async with acquire() as conn:
            # Última atividade clinicamente relevante (qualquer sinal)
            ultima = await conn.fetchval(
                """
                SELECT MAX(ts) FROM (
                    SELECT MAX(msg.criada_em) AS ts
                    FROM mensagens msg
                    JOIN conversas c ON c.id = msg.conversa_id
                    WHERE c.cliente_id = $1 AND msg.papel = 'user'

                    UNION ALL

                    SELECT MAX(criada_em) FROM diario_entradas
                    WHERE paciente_id = $1

                    UNION ALL

                    SELECT MAX(respondido_em) FROM checkins
                    WHERE paciente_id = $1 AND respondido_em IS NOT NULL

                    UNION ALL

                    SELECT MAX(horario_real) FROM tomadas_medicacao
                    WHERE paciente_id = $1 AND horario_real IS NOT NULL
                ) t
                """,
                paciente_id,
            )

            if ultima is None:
                # Sem histórico nenhum — não é "silêncio", é paciente que
                # nunca interagiu. Não dispara.
                m.dias_desde_ultima_atividade = None
                return m

            m.ultima_atividade_em = ultima
            m.dias_desde_ultima_atividade = (agora - ultima).days

            # Histórico de intervalos (180 dias atrás → última atividade)
            settings = get_settings()
            inicio_hist = ultima - timedelta(days=settings.risco_silencioso_janela_historico_dias)
            timestamps = await conn.fetch(
                """
                SELECT ts FROM (
                    SELECT msg.criada_em AS ts
                    FROM mensagens msg
                    JOIN conversas c ON c.id = msg.conversa_id
                    WHERE c.cliente_id = $1 AND msg.papel = 'user'

                    UNION ALL

                    SELECT criada_em FROM diario_entradas WHERE paciente_id = $1

                    UNION ALL

                    SELECT respondido_em FROM checkins
                    WHERE paciente_id = $1 AND respondido_em IS NOT NULL

                    UNION ALL

                    SELECT horario_real FROM tomadas_medicacao
                    WHERE paciente_id = $1 AND horario_real IS NOT NULL
                ) t
                WHERE ts >= $2 AND ts <= $3
                ORDER BY ts
                """,
                paciente_id,
                inicio_hist,
                ultima,
            )

            tss = [r["ts"] for r in timestamps]
            if len(tss) >= 2:
                intervalos = [
                    (tss[i + 1] - tss[i]).days for i in range(len(tss) - 1)
                ]
                # Filtra intervalos de 0 dias (múltiplas interações no mesmo dia)
                intervalos_uteis = [i for i in intervalos if i > 0]
                m.intervalos_historicos_dias = intervalos_uteis

                if (
                    len(intervalos_uteis)
                    >= settings.risco_silencioso_minimo_amostras_historico
                ):
                    m.amostras_suficientes = True
                    m.p95_intervalo_historico = _percentile(intervalos_uteis, 95)

            # Sinais negativos pré-silêncio (7d antes da última atividade)
            janela_pre_inicio = ultima - timedelta(days=7)
            await self._coletar_sinais_negativos(
                conn, paciente_id, m, janela_pre_inicio, ultima, agora
            )

        return m

    async def _coletar_sinais_negativos(
        self,
        conn,
        paciente_id: UUID,
        m: MetricasRiscoSilencioso,
        janela_inicio: datetime,
        janela_fim: datetime,
        agora: datetime,
    ) -> None:
        settings = get_settings()
        sinais: list[SinalNegativo] = []

        # Humor/ansiedade extremos em sintomas
        sintomas_neg = await conn.fetch(
            """
            SELECT humor, ansiedade, registrado_em
            FROM sintomas
            WHERE paciente_id = $1
              AND registrado_em BETWEEN $2 AND $3
              AND (humor <= $4 OR ansiedade >= $5)
            ORDER BY registrado_em DESC
            """,
            paciente_id,
            janela_inicio,
            janela_fim,
            settings.risco_silencioso_humor_threshold_baixo,
            settings.risco_silencioso_ansiedade_threshold_alto,
        )
        for s in sintomas_neg:
            if (
                s["humor"] is not None
                and s["humor"] <= settings.risco_silencioso_humor_threshold_baixo
            ):
                sinais.append(
                    SinalNegativo(
                        tipo="humor_baixo_mensagem",
                        detalhe=f"Humor reportado em {s['humor']}/10.",
                        quando=s["registrado_em"],
                    )
                )
            if (
                s["ansiedade"] is not None
                and s["ansiedade"] >= settings.risco_silencioso_ansiedade_threshold_alto
            ):
                sinais.append(
                    SinalNegativo(
                        tipo="ansiedade_alta_mensagem",
                        detalhe=f"Ansiedade reportada em {s['ansiedade']}/10.",
                        quando=s["registrado_em"],
                    )
                )

        # Última tomada antes do silêncio foi 'esquecida'
        ultima_tomada = await conn.fetchrow(
            """
            SELECT status, horario_previsto
            FROM tomadas_medicacao
            WHERE paciente_id = $1
              AND horario_previsto <= $2
            ORDER BY horario_previsto DESC
            LIMIT 1
            """,
            paciente_id,
            janela_fim,
        )
        if ultima_tomada and ultima_tomada["status"] == "esquecida":
            sinais.append(
                SinalNegativo(
                    tipo="medicacao_esquecida",
                    detalhe="Última tomada registrada como esquecida.",
                    quando=ultima_tomada["horario_previsto"],
                )
            )

        # Diário compartilhado com humor baixo
        diario_neg = await conn.fetch(
            """
            SELECT humor, criada_em FROM diario_entradas
            WHERE paciente_id = $1
              AND compartilhada_com_medico = TRUE
              AND criada_em BETWEEN $2 AND $3
              AND humor IS NOT NULL
              AND humor <= $4
            """,
            paciente_id,
            janela_inicio,
            janela_fim,
            settings.risco_silencioso_humor_threshold_baixo,
        )
        for d in diario_neg:
            sinais.append(
                SinalNegativo(
                    tipo="humor_baixo_diario",
                    detalhe=f"Diário compartilhado com humor {d['humor']}/10.",
                    quando=d["criada_em"],
                )
            )

        # Crise recente
        crise_recente_inicio = agora - timedelta(
            days=settings.risco_silencioso_janela_crise_recente_dias
        )
        crise_critica_inicio = agora - timedelta(
            days=settings.risco_silencioso_janela_crise_critica_dias
        )

        crises = await conn.fetch(
            """
            SELECT gatilho, criado_em
            FROM protocolos_crise_acionados
            WHERE paciente_id = $1 AND criado_em >= $2
            ORDER BY criado_em DESC
            """,
            paciente_id,
            crise_recente_inicio,
        )
        for c in crises:
            tipo = (
                "crise_muito_recente"
                if c["criado_em"] >= crise_critica_inicio
                else "crise_recente"
            )
            # Schema real: protocolos_crise_acionados não tem coluna `nivel`,
            # mas tem `gatilho`. Usamos gatilho para o detalhe.
            gatilho = c.get("gatilho") if isinstance(c, dict) else c["gatilho"]
            sinais.append(
                SinalNegativo(
                    tipo=tipo,  # type: ignore[arg-type]
                    detalhe=f"Protocolo de crise acionado (gatilho: {gatilho}).",
                    quando=c["criado_em"],
                )
            )

        m.sinais_negativos_pre_silencio = sinais

    # ─── Avaliação de triggers ──────────────────────────────────────────────

    def _avaliar_triggers(self, m: MetricasRiscoSilencioso) -> None:
        s = get_settings()
        triggers: list[str] = []
        sev = "info"

        if m.dias_desde_ultima_atividade is None:
            # Paciente nunca interagiu — não é silêncio
            m.triggers = triggers
            m.severidade_algoritmica = sev  # type: ignore[assignment]
            return

        # Trigger 1: threshold absoluto
        if m.dias_desde_ultima_atividade >= s.risco_silencioso_threshold_dias_absoluto:
            triggers.append("ausencia_absoluta")
            sev = _max_sev(sev, "media")

        # Trigger 2: comparação com histórico do paciente
        if (
            m.amostras_suficientes
            and m.p95_intervalo_historico is not None
            and m.dias_desde_ultima_atividade
            > m.p95_intervalo_historico * s.risco_silencioso_threshold_p95_multiplicador
        ):
            triggers.append("ausencia_atipica_para_paciente")
            sev = _max_sev(sev, "media")

        # Se nenhum trigger de ausência ativo, não acionamos.
        if not triggers:
            m.triggers = triggers
            m.severidade_algoritmica = sev  # type: ignore[assignment]
            return

        # ─── Escalada por sinais negativos ───
        sinais_distintos = {s.tipo for s in m.sinais_negativos_pre_silencio}

        # Crise muito recente (≤14d) já escala para crítica direto
        if "crise_muito_recente" in sinais_distintos:
            triggers.append("crise_muito_recente_pre_silencio")
            sev = "critica"
        else:
            # Conta sinais "não-crise" para escalada graduada
            sinais_severos = sinais_distintos - {"crise_recente"}
            tem_crise_recente = "crise_recente" in sinais_distintos

            n_sinais_para_escalada = len(sinais_severos) + (1 if tem_crise_recente else 0)

            if n_sinais_para_escalada >= 2:
                triggers.append("multiplos_sinais_negativos_pre_silencio")
                sev = _max_sev(sev, "critica")
            elif n_sinais_para_escalada == 1:
                triggers.append("sinal_negativo_pre_silencio")
                sev = _max_sev(sev, "alta")

        m.triggers = triggers
        m.severidade_algoritmica = sev  # type: ignore[assignment]

    # ─── Helpers ────────────────────────────────────────────────────────────

    async def _get_nome(self, paciente_id: UUID) -> str:
        async with acquire() as conn:
            row = await conn.fetchrow(
                "SELECT nome FROM clientes WHERE id = $1", paciente_id
            )
        return row["nome"] if row and row["nome"] else ""


def _percentile(values: list[int], pct: float) -> float:
    """Percentil simples (linear interpolation). Para amostras pequenas
    `statistics.quantiles` exige mín 2 elementos — checado pelo caller."""
    if not values:
        return 0.0
    if len(values) == 1:
        return float(values[0])
    return float(statistics.quantiles(values, n=100)[int(pct) - 1])


# ─── Renderizador Markdown ─────────────────────────────────────────────────


def _format_markdown(
    narrativa: RiscoSilenciosoLLMOutput, m: MetricasRiscoSilencioso
) -> str:
    lines = [f"## {narrativa.titulo}", "", narrativa.narrativa, ""]

    if narrativa.pontos_relevantes:
        lines.append("### Pontos relevantes")
        lines.extend(f"- {p}" for p in narrativa.pontos_relevantes)
        lines.append("")

    if m.sinais_negativos_pre_silencio:
        lines.append("### Sinais identificados antes do silêncio")
        for s in m.sinais_negativos_pre_silencio:
            quando = s.quando.strftime("%d/%m/%Y") if s.quando else "?"
            lines.append(f"- ({quando}) {s.detalhe}")
        lines.append("")

    if narrativa.sugestoes_topicos:
        lines.append("### Sugestões")
        lines.extend(f"- {s}" for s in narrativa.sugestoes_topicos)
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"
