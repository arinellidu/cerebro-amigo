"""Agente `resumidor` — gera resumo pré-consulta.

Disparado para cada `consultas` com `inicia_em` numa janela [now+min, now+max],
status 'agendada'. Coleta últimos 14 dias de sinais (sintomas, adesão,
diário compartilhado, mensagens recentes, crises), pede ao Sonnet para
sumarizar em formato estruturado, e grava como `insights` com
`agente='resumo_pre_consulta'`.

Dedup: 24h por paciente (configurável em `dedup_window_hours`). Pode ser
forçado via endpoint manual.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import ClassVar
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


# ─── Output estruturado do LLM ─────────────────────────────────────────────


class ResumoLLMOutput(BaseModel):
    """Estrutura que o Sonnet vai preencher."""

    titulo: str = Field(
        ...,
        max_length=200,
        description="Frase curta (~10 palavras) capturando o ponto mais "
        "relevante. Ex.: 'Sono fragmentado e ansiedade elevada nas últimas 2 semanas'.",
    )
    pontos_chave: list[str] = Field(
        default_factory=list,
        description="3 a 6 bullets curtos com os achados clínicos do período. "
        "Parafraseados, sem trechos verbatim do paciente.",
    )
    adesao_observada: str = Field(
        ...,
        description="1 frase resumindo padrão de adesão à medicação no período "
        "('boa', 'inconsistente', 'preocupante' + contexto).",
    )
    sinais_de_alerta: list[str] = Field(
        default_factory=list,
        description="Apenas sinais clínicos que merecem atenção imediata. "
        "Vazio se não houver.",
    )
    sugestoes_topicos: list[str] = Field(
        default_factory=list,
        description="3 a 5 tópicos sugeridos para a psiquiatra explorar na "
        "consulta. NÃO são diagnósticos nem prescrições.",
    )
    severidade: str = Field(
        default="info",
        pattern=r"^(info|baixa|media|alta|critica)$",
        description="info: situação estável. "
        "baixa/media: padrões a observar. "
        "alta: piora significativa ou recusa de medicação. "
        "critica: protocolo de crise foi acionado no período ou sinais graves.",
    )


# ─── Prompts ───────────────────────────────────────────────────────────────


RESUMIDOR_SYSTEM_V1 = """Você é o agente analítico Cérebro Amigo · resumidor. Sua tarefa é \
sintetizar para a psiquiatra os pontos mais relevantes do paciente nas duas \
semanas anteriores à consulta agendada.

PRINCÍPIOS:
1. Você NÃO é médico(a). Não diagnostique. Não recomende prescrição, dose ou \
   conduta. Sugira tópicos a explorar — quem decide é a psiquiatra.
2. NUNCA copie trechos verbatim do paciente. Parafraseie em terceira pessoa.
3. Seja conciso. A psiquiatra tem 50 min de consulta e vai ler 30 segundos \
   antes. Resumo deve caber numa tela.
4. Não invente. Se um sinal não está nos dados, não escreva sobre ele.
5. Distinga FATO ("registrou ansiedade 8 em 12/05") de INTERPRETAÇÃO \
   ("relata aumento subjetivo de irritabilidade"). Prefira o primeiro.
6. Severidade reflete a urgência clínica do que você está reportando, \
   independente do tom do paciente."""


def _build_user_prompt(contexto: dict) -> str:
    return (
        f"Paciente: {contexto.get('nome', 'sem nome')}\n"
        f"Consulta agendada: {contexto.get('consulta_inicia_em')} "
        f"(modalidade: {contexto.get('consulta_modalidade')})\n"
        f"Janela analisada: últimos 14 dias\n\n"
        f"=== Sintomas registrados ({len(contexto.get('sintomas', []))} entradas) ===\n"
        f"{json.dumps(contexto.get('sintomas', []), ensure_ascii=False, default=str, indent=2)}\n\n"
        f"=== Adesão à medicação ({len(contexto.get('tomadas', []))} registros) ===\n"
        f"{json.dumps(contexto.get('tomadas', []), ensure_ascii=False, default=str, indent=2)}\n\n"
        f"=== Diário compartilhado ({len(contexto.get('diario', []))} entradas) ===\n"
        f"{json.dumps(contexto.get('diario', []), ensure_ascii=False, default=str, indent=2)}\n\n"
        f"=== Protocolos de crise no período ({len(contexto.get('crises', []))}) ===\n"
        f"{json.dumps(contexto.get('crises', []), ensure_ascii=False, default=str, indent=2)}\n\n"
        f"=== Prescrições ativas ===\n"
        f"{json.dumps(contexto.get('prescricoes', []), ensure_ascii=False, default=str, indent=2)}"
    )


# ─── O Agente ──────────────────────────────────────────────────────────────


class ResumidorAgent(BaseAgent):
    name: ClassVar[str] = "resumo_pre_consulta"
    dedup_window_hours: ClassVar[int] = 12  # pode regerar se faltar pouco pra consulta

    async def find_pending(self) -> AsyncIterator[AgentPayload]:
        settings = get_settings()
        lo = timedelta(minutes=settings.resumidor_lead_min_min)
        hi = timedelta(minutes=settings.resumidor_lead_min_max)

        async with acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT id, paciente_id, medico_id, inicia_em, modalidade
                FROM consultas
                WHERE status = 'agendada'
                  AND inicia_em BETWEEN NOW() + $1 AND NOW() + $2
                ORDER BY inicia_em
                """,
                lo,
                hi,
            )

        for row in rows:
            yield AgentPayload(
                paciente_id=row["paciente_id"],
                medico_id=row["medico_id"],
                extra={
                    "consulta_id": str(row["id"]),
                    "consulta_inicia_em": row["inicia_em"].isoformat(),
                    "consulta_modalidade": row["modalidade"],
                },
            )

    async def execute(self, payload: AgentPayload) -> InsightOutput:
        contexto = await self._carregar_contexto(
            paciente_id=payload.paciente_id,
            consulta_inicia_em=payload.extra["consulta_inicia_em"],
            consulta_modalidade=payload.extra["consulta_modalidade"],
        )

        call = await ainvoke_structured(
            sonnet(temperature=0.2),
            ResumoLLMOutput,
            [
                SystemMessage(content=await get_prompt("agents", "resumidor")),
                HumanMessage(content=_build_user_prompt(contexto)),
            ],
        )
        resumo: ResumoLLMOutput = call.parsed  # type: ignore[assignment]

        conteudo_md = _format_resumo_markdown(resumo)
        settings = get_settings()

        return InsightOutput(
            paciente_id=payload.paciente_id,
            medico_id=payload.medico_id,
            titulo=resumo.titulo,
            conteudo=conteudo_md,
            severidade=resumo.severidade,
            metadata={
                "consulta_id": payload.extra["consulta_id"],
                "consulta_inicia_em": payload.extra["consulta_inicia_em"],
                "agente_versao": "v1",
                "pontos_chave": resumo.pontos_chave,
                "adesao_observada": resumo.adesao_observada,
                "sinais_de_alerta": resumo.sinais_de_alerta,
                "sugestoes_topicos": resumo.sugestoes_topicos,
            },
            valido_ate=datetime.fromisoformat(payload.extra["consulta_inicia_em"]),
            tokens_in=call.tokens_in,
            tokens_out=call.tokens_out,
            custo_usd=call.custo_usd,
            modelo=call.model_id or settings.model_sonnet,
        )

    async def _carregar_contexto(
        self,
        *,
        paciente_id: UUID,
        consulta_inicia_em: str,
        consulta_modalidade: str,
    ) -> dict:
        janela_dias = 14
        desde = datetime.now(UTC) - timedelta(days=janela_dias)

        async with acquire() as conn:
            paciente_row = await conn.fetchrow(
                "SELECT nome FROM clientes WHERE id = $1", paciente_id
            )
            nome = paciente_row["nome"] if paciente_row else ""

            sintomas = await conn.fetch(
                """
                SELECT humor, ansiedade, sono_horas, sono_qualidade, energia,
                       apetite, irritabilidade, nota, registrado_em
                FROM sintomas
                WHERE paciente_id = $1 AND registrado_em > $2
                ORDER BY registrado_em DESC
                LIMIT 60
                """,
                paciente_id,
                desde,
            )

            tomadas = await conn.fetch(
                """
                SELECT t.status, t.horario_previsto, t.horario_real, t.nota_paciente,
                       p.medicamento, p.dose_descricao
                FROM tomadas_medicacao t
                JOIN prescricoes p ON p.id = t.prescricao_id
                WHERE t.paciente_id = $1 AND t.horario_previsto > $2
                ORDER BY t.horario_previsto DESC
                LIMIT 80
                """,
                paciente_id,
                desde,
            )

            diario_rows = await conn.fetch(
                """
                SELECT titulo, conteudo, humor, tags, criada_em
                FROM diario_entradas
                WHERE paciente_id = $1
                  AND compartilhada_com_medico = TRUE
                  AND criada_em > $2
                ORDER BY criada_em DESC
                LIMIT 20
                """,
                paciente_id,
                desde,
            )
            # Decifra titulo/conteudo SEPARADAMENTE (ADR-018; cada campo é um
            # v1:<base64> independente — nunca decifrar a concatenação dos dois).
            # None ⇒ legado plaintext (no-op).
            _settings = get_settings()
            _key = (
                _settings.encryption_key.get_secret_value()
                if _settings.encryption_key
                else None
            )
            diario = []
            for r in diario_rows:
                d = dict(r)
                d["titulo"] = crypto.decrypt(d["titulo"], _key) if d["titulo"] else d["titulo"]
                d["conteudo"] = (
                    crypto.decrypt(d["conteudo"], _key) if d["conteudo"] else d["conteudo"]
                )
                diario.append(d)

            # Minimização LGPD (clinical-safety Regra 4): só metadados do evento
            # de crise vão ao LLM externo — NÃO `palavras_detectadas` (frase crua
            # do paciente). `revisado_humano` não existe no schema (era coluna
            # fantasma; causava `column does not exist` e quebrava o agente 100%).
            crises = await conn.fetch(
                """
                SELECT gatilho, confianca, medico_notificado, criado_em
                FROM protocolos_crise_acionados
                WHERE paciente_id = $1 AND criado_em > $2
                ORDER BY criado_em DESC
                """,
                paciente_id,
                desde,
            )

            prescricoes = await conn.fetch(
                """
                SELECT medicamento, dose_descricao, horarios, inicio_em, fim_em
                FROM prescricoes
                WHERE paciente_id = $1 AND ativa = TRUE
                ORDER BY inicio_em DESC
                """,
                paciente_id,
            )

        return {
            "nome": nome,
            "consulta_inicia_em": consulta_inicia_em,
            "consulta_modalidade": consulta_modalidade,
            "sintomas": [dict(r) for r in sintomas],
            "tomadas": [dict(r) for r in tomadas],
            "diario": diario,  # já são dicts com titulo/conteudo decifrados
            "crises": [dict(r) for r in crises],
            "prescricoes": [dict(r) for r in prescricoes],
        }


def _format_resumo_markdown(resumo: ResumoLLMOutput) -> str:
    """Renderiza o resumo estruturado em Markdown para `insights.conteudo`."""
    lines = [f"## {resumo.titulo}", ""]

    if resumo.pontos_chave:
        lines.append("### Pontos-chave")
        lines.extend(f"- {p}" for p in resumo.pontos_chave)
        lines.append("")

    lines.append("### Adesão")
    lines.append(resumo.adesao_observada)
    lines.append("")

    if resumo.sinais_de_alerta:
        lines.append("### Sinais de alerta")
        lines.extend(f"- {s}" for s in resumo.sinais_de_alerta)
        lines.append("")

    if resumo.sugestoes_topicos:
        lines.append("### Sugestões de tópicos para a consulta")
        lines.extend(f"- {s}" for s in resumo.sugestoes_topicos)

    return "\n".join(lines).rstrip() + "\n"
