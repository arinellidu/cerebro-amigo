"""Agente `diario` — sumariza entradas de diário compartilhadas pré-consulta.

Coleta as entradas de `diario_entradas` onde `compartilhada_com_medico=true`
nos últimos 14 dias e pede ao Sonnet para sintetizar de forma factual,
identificando temas recorrentes.

Princípios clínicos importantes (refletidos no system prompt):

* **Sem análise emocional especulativa.** Não há "paciente parece estar em
  fase maníaca" baseado em texto. O agente reporta o que o paciente
  escreveu, parafraseando.
* **Sem verbatim.** Excertos do diário são SEMPRE parafraseados — mesmo
  quando isso significaria perder cor. Conteúdo verbatim em texto livre
  amplia surface area de PII.
* **Temas, não diagnóstico.** Identifica que "trabalho" e "família"
  aparecem em múltiplas entradas, sem inferir o que significa.

Trigger: pré-consulta (janela 30-120 min antes), igual ao resumidor.
Skip silencioso se < 2 entradas no período.
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
from app.core import crypto
from app.core.config import get_settings
from app.core.db import acquire
from app.core.llm import ainvoke_structured, sonnet
from app.core.prompt_loader import get_prompt

logger = structlog.get_logger(__name__)


# ─── Output do LLM ─────────────────────────────────────────────────────────


class DiarioLLMOutput(BaseModel):
    titulo: str = Field(..., max_length=200)
    resumo_factual: str = Field(
        ...,
        description="3-5 frases descrevendo factualmente o que o paciente "
        "registrou. NÃO interprete emoções como sintomas. NÃO copie texto "
        "verbatim — parafraseie sempre.",
    )
    temas_recorrentes: list[str] = Field(
        default_factory=list,
        description="Até 5 temas (curtas palavras-chave em PT-BR) que "
        "apareceram em múltiplas entradas. Ex.: 'trabalho', 'relacionamento "
        "familiar', 'sono', 'finanças'. NÃO incluir avaliações ('estresse "
        "alto') — apenas o tema.",
    )
    sugestoes_topicos: list[str] = Field(
        default_factory=list,
        description="Até 3 sugestões de tópicos abertos para a psiquiatra "
        "explorar. NÃO são diagnósticos nem condutas.",
    )
    severidade: Literal["info", "baixa", "media", "alta", "critica"] = Field(
        default="info",
        description="Default `info` — diário é insight contextual, não "
        "urgência. Subir apenas se conteúdo explícito do diário indicar "
        "risco (ex.: ideação suicida registrada e compartilhada).",
    )


DIARIO_SYSTEM_V1 = """Você é o agente analítico Cérebro Amigo · diário. Sua tarefa é sintetizar \
para a psiquiatra as entradas de diário que o paciente escolheu compartilhar.

PRINCÍPIOS RÍGIDOS:
1. Você NÃO é médico(a). NÃO diagnostique transtorno, fase, episódio. \
   Reporte o que o paciente escreveu, em terceira pessoa, factualmente.
2. NUNCA copie trecho verbatim do paciente. PARAFRASEIE SEMPRE. Mesmo \
   quando perder nuance — proteção de dados sensíveis (diário pessoal) \
   prevalece sobre fidelidade narrativa.
3. NÃO faça análise emocional especulativa do tipo "paciente parece estar \
   em quadro ansioso". Reporte o conteúdo, não a interpretação clínica.
4. Identifique TEMAS, não diagnósticos. "Trabalho aparece em 3 entradas" é \
   tema. "Estresse ocupacional" já é interpretação.
5. Severidade DEFAULT é `info`. Suba para `alta` ou `critica` SOMENTE se o \
   conteúdo do diário contiver expressão explícita de risco (ideação \
   suicida, planejamento, desesperança aguda). Nesses casos, sinalize \
   claramente nos `pontos_relevantes`."""


def _build_user_prompt(nome: str, entradas: list[dict], janela_dias: int) -> str:
    return (
        f"Paciente: {nome}\n"
        f"Janela analisada: últimos {janela_dias} dias\n"
        f"Total de entradas compartilhadas: {len(entradas)}\n\n"
        f"=== Entradas do diário (mais recente primeiro) ===\n"
        f"{json.dumps(entradas, ensure_ascii=False, indent=2, default=str)}\n\n"
        f"Sintetize conforme o schema. LEMBRE: parafrasear, não citar."
    )


# ─── O Agente ──────────────────────────────────────────────────────────────


class DiarioAgent(BaseAgent):
    name: ClassVar[str] = "diario"
    dedup_window_hours: ClassVar[int] = 12

    async def find_pending(self) -> AsyncIterator[AgentPayload]:
        settings = get_settings()
        lo = timedelta(minutes=settings.diario_lead_min_min)
        hi = timedelta(minutes=settings.diario_lead_min_max)

        async with acquire() as conn:
            consultas = await conn.fetch(
                """
                SELECT id, paciente_id, medico_id, inicia_em
                FROM consultas
                WHERE status = 'agendada'
                  AND inicia_em BETWEEN NOW() + $1 AND NOW() + $2
                ORDER BY inicia_em
                """,
                lo,
                hi,
            )

        log = logger.bind(agente=self.name)
        for c in consultas:
            # Pré-filtro: tem entradas suficientes?
            count = await self._contar_entradas(c["paciente_id"])
            if count < settings.diario_minimo_entradas:
                log.debug(
                    "skip.poucas_entradas",
                    paciente_id=str(c["paciente_id"]),
                    count=count,
                )
                continue

            yield AgentPayload(
                paciente_id=c["paciente_id"],
                medico_id=c["medico_id"],
                extra={
                    "consulta_id": str(c["id"]),
                    "consulta_inicia_em": c["inicia_em"].isoformat(),
                    "contagem_entradas": count,
                },
            )

    async def execute(self, payload: AgentPayload) -> InsightOutput:
        entradas = await self._carregar_entradas(payload.paciente_id)
        nome = await self._get_nome(payload.paciente_id)
        settings = get_settings()

        call = await ainvoke_structured(
            sonnet(temperature=0.2),
            DiarioLLMOutput,
            [
                SystemMessage(content=await get_prompt("agents", "diario")),
                HumanMessage(
                    content=_build_user_prompt(
                        nome, entradas, settings.diario_janela_dias
                    )
                ),
            ],
        )
        out: DiarioLLMOutput = call.parsed  # type: ignore[assignment]

        conteudo_md = _format_markdown(out, len(entradas))

        return InsightOutput(
            paciente_id=payload.paciente_id,
            medico_id=payload.medico_id,
            titulo=out.titulo,
            conteudo=conteudo_md,
            severidade=out.severidade,
            metadata={
                "agente_versao": "v1",
                "consulta_id": payload.extra["consulta_id"],
                "consulta_inicia_em": payload.extra["consulta_inicia_em"],
                "contagem_entradas": len(entradas),
                "temas_recorrentes": out.temas_recorrentes,
                "sugestoes_topicos": out.sugestoes_topicos,
                "severidade_llm": out.severidade,
            },
            valido_ate=datetime.fromisoformat(payload.extra["consulta_inicia_em"]),
            tokens_in=call.tokens_in,
            tokens_out=call.tokens_out,
            custo_usd=call.custo_usd,
            modelo=call.model_id or settings.model_sonnet,
        )

    # ─── Helpers ────────────────────────────────────────────────────────────

    async def _contar_entradas(self, paciente_id: UUID) -> int:
        settings = get_settings()
        desde = datetime.now(UTC) - timedelta(days=settings.diario_janela_dias)
        async with acquire() as conn:
            count = await conn.fetchval(
                """
                SELECT COUNT(*) FROM diario_entradas
                WHERE paciente_id = $1
                  AND compartilhada_com_medico = TRUE
                  AND criada_em > $2
                """,
                paciente_id,
                desde,
            )
        return int(count or 0)

    async def _carregar_entradas(self, paciente_id: UUID) -> list[dict]:
        settings = get_settings()
        desde = datetime.now(UTC) - timedelta(days=settings.diario_janela_dias)
        # Chave de cifragem em repouso (ADR-018). None ⇒ legado plaintext (no-op).
        key = (
            settings.encryption_key.get_secret_value()
            if settings.encryption_key
            else None
        )
        async with acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT titulo, conteudo, humor, tags, criada_em
                FROM diario_entradas
                WHERE paciente_id = $1
                  AND compartilhada_com_medico = TRUE
                  AND criada_em > $2
                ORDER BY criada_em DESC
                LIMIT 30
                """,
                paciente_id,
                desde,
            )
        # Decifra titulo/conteudo SEPARADAMENTE (cada campo é um v1:<base64>
        # independente — nunca decifrar uma concatenação dos dois).
        entradas: list[dict] = []
        for r in rows:
            d = dict(r)
            d["titulo"] = crypto.decrypt(d["titulo"], key) if d["titulo"] else d["titulo"]
            d["conteudo"] = crypto.decrypt(d["conteudo"], key) if d["conteudo"] else d["conteudo"]
            entradas.append(d)
        return entradas

    async def _get_nome(self, paciente_id: UUID) -> str:
        async with acquire() as conn:
            row = await conn.fetchrow(
                "SELECT nome FROM clientes WHERE id = $1", paciente_id
            )
        return row["nome"] if row and row["nome"] else ""


# ─── Renderizador Markdown ─────────────────────────────────────────────────


def _format_markdown(out: DiarioLLMOutput, n_entradas: int) -> str:
    lines = [f"## {out.titulo}", ""]
    lines.append(f"_Baseado em {n_entradas} entradas compartilhadas._")
    lines.append("")
    lines.append(out.resumo_factual)
    lines.append("")

    if out.temas_recorrentes:
        lines.append("### Temas recorrentes")
        lines.extend(f"- {t}" for t in out.temas_recorrentes)
        lines.append("")

    if out.sugestoes_topicos:
        lines.append("### Sugestões de tópicos para a consulta")
        lines.extend(f"- {s}" for s in out.sugestoes_topicos)
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"
