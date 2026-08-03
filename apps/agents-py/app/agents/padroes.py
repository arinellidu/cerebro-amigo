"""Agente `padroes` — detecta mudanças longitudinais em sintomas estruturados.

Analisa as variáveis numéricas da tabela `sintomas` (humor, ansiedade,
sono_horas, sono_qualidade, energia, apetite, irritabilidade) ao longo
de uma janela de 30 dias e identifica três tipos de padrão:

1. **Tendência linear** — slope significativo via `scipy.stats.linregress`.
   Para cada variável, a "direção negativa" depende da semântica clínica
   (humor decrescente é negativo; ansiedade crescente é negativo).

2. **Step change** — quebra entre primeira e segunda metade da janela.
   Detectada via t-test de Welch (`scipy.stats.ttest_ind`) com diferença
   de médias acima de threshold.

3. **Volatilidade** — desvio padrão dentro da janela. Em saúde mental,
   oscilação ampla (humor 8 num dia, 1 no seguinte) é clinicamente
   importante independente do slope médio.

Cadência: tick padrão do scheduler. Dedup window: 24h (no máximo 1
insight por paciente por dia). Skip silencioso quando não há padrão
detectado — pacientes estáveis não geram ruído no dashboard.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import ClassVar, Literal
from uuid import UUID

import numpy as np
import structlog
from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, Field
from scipy import stats

from app.agents.base import AgentPayload, BaseAgent, InsightOutput
from app.core.config import get_settings
from app.core.db import acquire
from app.core.llm import ainvoke_structured, sonnet
from app.core.prompt_loader import get_prompt

logger = structlog.get_logger(__name__)

# (nome_coluna, direção_negativa_é) — "decrescente" significa que slope
# negativo OU step change negativo é clinicamente preocupante; "crescente"
# o contrário.
VARIAVEIS_SINTOMAS: list[tuple[str, Literal["decrescente", "crescente"]]] = [
    ("humor", "decrescente"),
    ("ansiedade", "crescente"),
    ("sono_horas", "decrescente"),
    ("sono_qualidade", "decrescente"),
    ("energia", "decrescente"),
    ("apetite", "decrescente"),
    ("irritabilidade", "crescente"),
]

VARIAVEL_LABEL_PT = {
    "humor": "humor",
    "ansiedade": "ansiedade",
    "sono_horas": "duração do sono",
    "sono_qualidade": "qualidade do sono",
    "energia": "energia",
    "apetite": "apetite",
    "irritabilidade": "irritabilidade",
}


# ─── Severidade helpers ────────────────────────────────────────────────────

_SEVERIDADE_ORDEM = ["info", "baixa", "media", "alta", "critica"]


def _max_sev(*niveis: str) -> str:
    idx = 0
    for n in niveis:
        if n in _SEVERIDADE_ORDEM:
            idx = max(idx, _SEVERIDADE_ORDEM.index(n))
    return _SEVERIDADE_ORDEM[idx]


# ─── Modelos de análise ────────────────────────────────────────────────────


class AnalisePadraoPorVariavel(BaseModel):
    variavel: str
    direcao_negativa: Literal["decrescente", "crescente"]
    count: int
    media: float
    stddev: float
    minimo: float
    maximo: float

    # Tendência linear
    slope_por_semana: float | None = None
    slope_p_value: float | None = None
    slope_r_squared: float | None = None

    # Step change
    step_change_diff: float | None = None       # media(segunda) - media(primeira)
    step_change_p_value: float | None = None
    step_change_em: datetime | None = None      # data aproximada do corte

    # Triggers identificados para esta variável
    triggers: list[str] = Field(default_factory=list)


class MetricasPadroes(BaseModel):
    janela_dias: int
    janela_inicio: datetime
    janela_fim: datetime
    analises: list[AnalisePadraoPorVariavel] = Field(default_factory=list)
    triggers_globais: list[str] = Field(default_factory=list)
    severidade_algoritmica: Literal["info", "baixa", "media", "alta", "critica"] = "info"


# ─── Output do LLM ─────────────────────────────────────────────────────────


class PadroesLLMOutput(BaseModel):
    titulo: str = Field(..., max_length=200)
    narrativa: str = Field(
        ...,
        description="Parágrafo curto (3-5 frases) descrevendo os padrões "
        "estatísticos identificados em linguagem clínica. NÃO diagnostique.",
    )
    pontos_relevantes: list[str] = Field(
        default_factory=list,
        description="Até 5 bullets com fatos numéricos: variável, magnitude, "
        "direção, intervalo de tempo. Ex.: 'Humor caindo 0.8/semana ao longo "
        "de 30 dias (slope p<0.05).'",
    )
    sugestoes_topicos: list[str] = Field(
        default_factory=list,
        description="Até 3 sugestões de tópicos para a psiquiatra explorar. "
        "NÃO são diagnósticos.",
    )
    severidade: Literal["info", "baixa", "media", "alta", "critica"] = Field(
        ...,
        description="Pode subir mas não baixar em relação à severidade "
        "algorítmica — algoritmo conservador prevalece.",
    )


# ─── Prompt ────────────────────────────────────────────────────────────────


PADROES_SYSTEM_V1 = """Você é o agente analítico Cérebro Amigo · padrões. Sua tarefa é traduzir \
para a psiquiatra os padrões estatísticos detectados nos sintomas estruturados \
do paciente ao longo dos últimos 30 dias.

PRINCÍPIOS:
1. Você NÃO é médico(a). NÃO diagnostique transtorno, episódio, fase. \
   Limite-se a descrever o que os números mostram.
2. Use SOMENTE as métricas fornecidas (slope, p-value, stddev, step change). \
   NÃO INVENTE estatísticas adicionais.
3. Distinga claramente tendência (slope), mudança abrupta (step change) e \
   volatilidade (stddev). São padrões DIFERENTES. Volatilidade alta pode \
   coexistir com slope plano.
4. Em saúde mental, volatilidade alta em humor é clinicamente importante \
   mesmo quando a média da janela parece estável.
5. Seja conciso. A psiquiatra vai ler em segundos.
6. Severidade reflete a urgência do que você reporta. `critica` é reservado \
   para combinação grave (ex.: humor decrescente forte + ansiedade crescente \
   forte + alta volatilidade)."""


def _build_user_prompt(nome: str, m: MetricasPadroes) -> str:
    analises_relevantes = [
        a.model_dump(mode="json", exclude_none=True)
        for a in m.analises
        if a.triggers  # só passa variáveis com algum trigger
    ]
    return (
        f"Paciente: {nome}\n"
        f"Janela: {m.janela_dias} dias "
        f"({m.janela_inicio.date()} a {m.janela_fim.date()})\n\n"
        f"Triggers globais: {m.triggers_globais}\n"
        f"Severidade algorítmica: {m.severidade_algoritmica}\n\n"
        f"=== Análises com padrão detectado ===\n"
        f"{json.dumps(analises_relevantes, ensure_ascii=False, indent=2, default=str)}\n\n"
        f"Escreva o insight conforme o schema."
    )


# ─── Cálculo estatístico ───────────────────────────────────────────────────


def _analisar_serie(
    nome: str,
    direcao: Literal["decrescente", "crescente"],
    valores: list[float],
    momentos: list[datetime],
    *,
    settings,
) -> AnalisePadraoPorVariavel:
    """Computa todas as métricas para uma variável.

    `valores` e `momentos` devem estar pareados e ordenados por tempo.
    """
    arr = np.array(valores, dtype=float)
    a = AnalisePadraoPorVariavel(
        variavel=nome,
        direcao_negativa=direcao,
        count=len(arr),
        media=float(np.mean(arr)),
        stddev=float(np.std(arr, ddof=1)) if len(arr) >= 2 else 0.0,
        minimo=float(np.min(arr)),
        maximo=float(np.max(arr)),
    )

    if len(arr) < settings.padroes_minimo_registros:
        return a

    # Série constante → sem variação clínica a reportar. Evita warning
    # do scipy ("catastrophic cancellation") e cálculos espúrios.
    if a.stddev == 0:
        return a

    # Tempo em dias desde o primeiro registro (para slope)
    t0 = momentos[0]
    tempos_dias = np.array([(m - t0).total_seconds() / 86400.0 for m in momentos])

    # ── Slope linear ──
    try:
        reg = stats.linregress(tempos_dias, arr)
        a.slope_por_semana = float(reg.slope * 7)
        a.slope_p_value = float(reg.pvalue)
        a.slope_r_squared = float(reg.rvalue ** 2)
    except Exception:
        pass

    # ── Step change (t-test entre metades) ──
    mid = len(arr) // 2
    if mid >= 2 and len(arr) - mid >= 2:
        first, second = arr[:mid], arr[mid:]
        try:
            tt = stats.ttest_ind(first, second, equal_var=False)
            a.step_change_diff = float(np.mean(second) - np.mean(first))
            a.step_change_p_value = float(tt.pvalue)
            a.step_change_em = momentos[mid]
        except Exception:
            pass

    # ── Avaliação de triggers ──
    _avaliar_triggers_variavel(a, settings)
    return a


def _avaliar_triggers_variavel(
    a: AnalisePadraoPorVariavel, settings
) -> None:
    triggers: list[str] = []

    # Slope significativo
    if (
        a.slope_por_semana is not None
        and a.slope_p_value is not None
        and abs(a.slope_por_semana) >= settings.padroes_slope_min_pontos_semana
        and a.slope_p_value <= settings.padroes_slope_max_p_value
    ):
        direcao_slope = "crescente" if a.slope_por_semana > 0 else "decrescente"
        if direcao_slope == a.direcao_negativa:
            triggers.append(f"tendencia_{a.variavel}_negativa")
        else:
            triggers.append(f"tendencia_{a.variavel}_positiva")

    # Step change significativo
    if (
        a.step_change_diff is not None
        and a.step_change_p_value is not None
        and abs(a.step_change_diff) >= settings.padroes_step_change_min_diff
        and a.step_change_p_value <= settings.padroes_step_change_max_p_value
    ):
        direcao_step = "crescente" if a.step_change_diff > 0 else "decrescente"
        if direcao_step == a.direcao_negativa:
            triggers.append(f"step_change_{a.variavel}_negativo")
        else:
            triggers.append(f"step_change_{a.variavel}_positivo")

    # Volatilidade
    if a.stddev >= settings.padroes_stddev_threshold_alta:
        triggers.append(f"volatilidade_{a.variavel}_alta")
    elif a.stddev >= settings.padroes_stddev_threshold_media:
        triggers.append(f"volatilidade_{a.variavel}_media")

    a.triggers = triggers


def _avaliar_severidade_global(m: MetricasPadroes) -> None:
    """Aplica regras combinatórias para severidade global. Considera apenas
    triggers NEGATIVOS (positivos são reportados mas não escalam severidade).
    """
    triggers_negativos = [
        t
        for a in m.analises
        for t in a.triggers
        if t.endswith("_negativa")
        or t.endswith("_negativo")
        or "volatilidade" in t  # volatilidade é sempre considerada negativa
    ]
    m.triggers_globais = sorted(set(triggers_negativos))

    if not triggers_negativos:
        # Pode ter triggers positivos — reportar como info
        if any(a.triggers for a in m.analises):
            m.severidade_algoritmica = "info"
        else:
            m.severidade_algoritmica = "info"
        return

    sev = "media"  # qualquer trigger negativo → mínimo media

    # Combinatórias clinicamente relevantes
    nomes = {t for t in triggers_negativos}

    has_humor_negativo = any(
        "humor" in t for t in nomes if t.endswith("_negativa") or t.endswith("_negativo")
    )
    has_ansiedade_negativa = any(
        "ansiedade" in t for t in nomes if t.endswith("_negativa") or t.endswith("_negativo")
    )
    has_volatilidade_alta = any("volatilidade" in t and "_alta" in t for t in nomes)  # noqa: F841

    # Humor decrescente + ansiedade crescente → alta
    if has_humor_negativo and has_ansiedade_negativa:
        sev = _max_sev(sev, "alta")

    # 3+ triggers negativos distintos → alta
    if len(nomes) >= 3:
        sev = _max_sev(sev, "alta")

    # Volatilidade alta em humor + tendência humor negativa → critica
    if (
        any("volatilidade_humor_alta" == t for t in nomes)
        and has_humor_negativo
    ):
        sev = "critica"

    m.severidade_algoritmica = sev  # type: ignore[assignment]


# ─── O Agente ──────────────────────────────────────────────────────────────


class PadroesAgent(BaseAgent):
    name: ClassVar[str] = "padroes"
    dedup_window_hours: ClassVar[int] = 24  # 1 insight por paciente por dia

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

            if not metricas.triggers_globais:
                continue

            yield AgentPayload(
                paciente_id=paciente_id,
                medico_id=medico_id,
                extra={"metricas_json": metricas.model_dump_json()},
            )

    async def execute(self, payload: AgentPayload) -> InsightOutput:
        metricas = MetricasPadroes.model_validate_json(payload.extra["metricas_json"])
        nome = await self._get_nome(payload.paciente_id)

        call = await ainvoke_structured(
            sonnet(temperature=0.2),
            PadroesLLMOutput,
            [
                SystemMessage(content=await get_prompt("agents", "padroes")),
                HumanMessage(content=_build_user_prompt(nome, metricas)),
            ],
        )
        narrativa: PadroesLLMOutput = call.parsed  # type: ignore[assignment]

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
                "janela_dias": metricas.janela_dias,
                "triggers_globais": metricas.triggers_globais,
                "severidade_algoritmica": metricas.severidade_algoritmica,
                "severidade_llm": narrativa.severidade,
                "analises": [a.model_dump(mode="json") for a in metricas.analises],
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
        """Pacientes com ≥ minimo_registros nos últimos N dias."""
        settings = get_settings()
        async with acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT p.cliente_id AS paciente_id,
                       p.medico_responsavel_id AS medico_id
                FROM pacientes p
                WHERE (
                    SELECT COUNT(*) FROM sintomas s
                    WHERE s.paciente_id = p.cliente_id
                      AND s.registrado_em > NOW() - ($1 || ' days')::interval
                ) >= $2
                """,
                str(settings.padroes_janela_dias),
                settings.padroes_minimo_registros,
            )
        return [(r["paciente_id"], r["medico_id"]) for r in rows]

    # ─── Cálculo ────────────────────────────────────────────────────────────

    async def _calcular_metricas(self, paciente_id: UUID) -> MetricasPadroes:
        settings = get_settings()
        agora = datetime.now(UTC)
        inicio = agora - timedelta(days=settings.padroes_janela_dias)

        m = MetricasPadroes(
            janela_dias=settings.padroes_janela_dias,
            janela_inicio=inicio,
            janela_fim=agora,
        )

        async with acquire() as conn:
            registros = await conn.fetch(
                """
                SELECT humor, ansiedade, sono_horas, sono_qualidade, energia,
                       apetite, irritabilidade, registrado_em
                FROM sintomas
                WHERE paciente_id = $1 AND registrado_em > $2
                ORDER BY registrado_em
                """,
                paciente_id,
                inicio,
            )

        if len(registros) < settings.padroes_minimo_registros:
            return m

        # Para cada variável, monta a série filtrando nulls
        for nome_var, direcao in VARIAVEIS_SINTOMAS:
            valores: list[float] = []
            momentos: list[datetime] = []
            for r in registros:
                v = r[nome_var]
                if v is not None:
                    valores.append(float(v))
                    momentos.append(r["registrado_em"])

            if not valores:
                continue

            analise = _analisar_serie(
                nome_var, direcao, valores, momentos, settings=settings
            )
            m.analises.append(analise)

        _avaliar_severidade_global(m)
        return m

    # ─── Helpers ────────────────────────────────────────────────────────────

    async def _get_nome(self, paciente_id: UUID) -> str:
        async with acquire() as conn:
            row = await conn.fetchrow(
                "SELECT nome FROM clientes WHERE id = $1", paciente_id
            )
        return row["nome"] if row and row["nome"] else ""


# ─── Renderizador Markdown ─────────────────────────────────────────────────


def _format_markdown(narrativa: PadroesLLMOutput, m: MetricasPadroes) -> str:
    lines = [f"## {narrativa.titulo}", "", narrativa.narrativa, ""]

    if narrativa.pontos_relevantes:
        lines.append("### Pontos relevantes")
        lines.extend(f"- {p}" for p in narrativa.pontos_relevantes)
        lines.append("")

    # Tabela de variáveis com padrão detectado
    relevantes = [a for a in m.analises if a.triggers]
    if relevantes:
        lines.append("### Variáveis com padrão detectado")
        lines.append("| Variável | n | Média | Stddev | Slope/sem | Step change |")
        lines.append("|---|---|---|---|---|---|")
        for a in relevantes:
            slope = (
                f"{a.slope_por_semana:+.2f} (p={a.slope_p_value:.2f})"
                if a.slope_por_semana is not None and a.slope_p_value is not None
                else "—"
            )
            step = (
                f"{a.step_change_diff:+.2f} (p={a.step_change_p_value:.2f})"
                if a.step_change_diff is not None and a.step_change_p_value is not None
                else "—"
            )
            label = VARIAVEL_LABEL_PT.get(a.variavel, a.variavel)
            lines.append(
                f"| {label} | {a.count} | {a.media:.2f} | "
                f"{a.stddev:.2f} | {slope} | {step} |"
            )
        lines.append("")

    if narrativa.sugestoes_topicos:
        lines.append("### Sugestões de tópicos para a consulta")
        lines.extend(f"- {s}" for s in narrativa.sugestoes_topicos)
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"
