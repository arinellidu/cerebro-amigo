"""Agente de desfecho — Measurement-Based Care (S1).

Avalia a TRAJETÓRIA das escalas (PHQ-9/GAD-7) após uma mudança de medicação e
gera o insight clínico de ouro: **resposta** (queda ≥ 50% do score), **remissão**
(score < 5) e, sobretudo, **não-resposta em 4-6 semanas** após início/troca de
medicação.

clinical-safety:
  #1 IA não pratica medicina — este agente é DETERMINÍSTICO (sem LLM): só agrega
     fatos (scores, datas, queda %). Não sugere conduta nem dose. O médico decide.
  #4 LGPD — só números/datas no insight; nada de conteúdo conversacional.
  Shadow-safe: produz apenas `insights` (não envia nada ao paciente).
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Any, ClassVar
from uuid import UUID

import structlog

from app.agents.base import AgentPayload, BaseAgent, InsightOutput
from app.core.db import acquire

logger = structlog.get_logger(__name__)

# Escalas suportadas (pontuação máxima só para referência/documentação).
_NOME = {"phq9": "PHQ-9", "gad7": "GAD-7"}


def _interpretar(codigo: str, score: int) -> str:
    """Faixas de severidade (cutoffs padrão; espelham o catálogo do gateway)."""
    if codigo == "phq9":
        if score < 5:
            return "mínima"
        if score < 10:
            return "leve"
        if score < 15:
            return "moderada"
        if score < 20:
            return "moderadamente grave"
        return "grave"
    # gad7
    if score < 5:
        return "mínima"
    if score < 10:
        return "leve"
    if score < 15:
        return "moderada"
    return "grave"


class DesfechoAgent(BaseAgent):
    name: ClassVar[str] = "desfecho"
    # 1 insight por paciente por semana (a janela de avaliação muda devagar).
    dedup_window_hours: ClassVar[int] = 168

    async def find_pending(self) -> AsyncIterator[AgentPayload]:
        candidatos = await self._candidatos()
        log = logger.bind(agente=self.name)

        for paciente_id, medico_id, ultima_troca in candidatos:
            try:
                outcomes = await self._avaliar(paciente_id, ultima_troca)
            except Exception as exc:
                log.exception("avaliar.failed", paciente_id=str(paciente_id), error=str(exc))
                continue

            if not outcomes:
                continue  # sem escala avaliável após a troca

            yield AgentPayload(
                paciente_id=paciente_id,
                medico_id=medico_id,
                extra={
                    "ultima_troca": ultima_troca.isoformat(),
                    "outcomes_json": json.dumps(outcomes, default=str),
                },
            )

    async def execute(self, payload: AgentPayload) -> InsightOutput:
        outcomes: list[dict[str, Any]] = json.loads(payload.extra["outcomes_json"])
        troca_iso: str = payload.extra["ultima_troca"]
        try:
            troca_data = datetime.fromisoformat(troca_iso).strftime("%d/%m/%Y")
        except ValueError:
            troca_data = troca_iso[:10]

        sem_resposta = [o for o in outcomes if not o["resposta"] and o["semanas_desde_troca"] >= 4]
        houve_resposta = [o for o in outcomes if o["resposta"]]

        linhas = []
        for o in outcomes:
            if o["remissao"]:
                estado = "remissão"
            elif o["resposta"]:
                estado = "resposta"
            else:
                estado = f"sem resposta há {o['semanas_desde_troca']} semanas"
            linhas.append(
                f"- **{o['nome']}:** {o['baseline']} → {o['atual']} "
                f"(queda de {o['queda_pct']}%) — {estado}. "
                f"Severidade atual: {o['severidade_atual']}."
            )

        if sem_resposta:
            titulo = "Sem resposta às escalas após mudança de medicação"
            severidade = "alta"
        elif outcomes and all(o["remissao"] for o in outcomes):
            titulo = "Remissão nas escalas após mudança de medicação"
            severidade = "info"
        elif houve_resposta:
            titulo = "Resposta às escalas após mudança de medicação"
            severidade = "info"
        else:
            titulo = "Evolução das escalas após mudança de medicação"
            severidade = "media"

        conteudo = (
            f"**Mudança de medicação em {troca_data}.** Evolução das escalas desde então:\n\n"
            + "\n".join(linhas)
            + "\n\nResposta = queda ≥ 50% do score anterior à mudança · "
            "Remissão = score < 5. Agregação factual; a interpretação e a conduta "
            "clínica são do médico."
        )

        return InsightOutput(
            paciente_id=payload.paciente_id,
            medico_id=payload.medico_id,
            titulo=titulo,
            conteudo=conteudo,
            severidade=severidade,
            metadata={
                "agente_versao": "v1",
                "ultima_troca_medicacao": troca_iso,
                "outcomes": outcomes,
            },
            valido_ate=datetime.now(UTC) + timedelta(days=14),
        )

    # ─── Candidatos ─────────────────────────────────────────────────────────

    async def _candidatos(self) -> list[tuple[UUID, UUID, datetime]]:
        """Pacientes cuja ÚLTIMA mudança de medicação foi há 4-17 semanas — janela
        em que faz sentido cobrar resposta (≥4 sem para avaliar; ≤17 para não
        cobrar eternamente). Mudanças mais novas que 28 dias ainda são cedo."""
        async with acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT p.cliente_id AS paciente_id,
                       p.medico_responsavel_id AS medico_id,
                       MAX(pe.criado_em) AS ultima_troca
                FROM prescricao_eventos pe
                JOIN pacientes p ON p.cliente_id = pe.paciente_id
                WHERE pe.tipo IN ('adicao', 'troca', 'ajuste')
                  AND p.medico_responsavel_id IS NOT NULL
                GROUP BY p.cliente_id, p.medico_responsavel_id
                HAVING MAX(pe.criado_em) BETWEEN NOW() - INTERVAL '120 days'
                                             AND NOW() - INTERVAL '28 days'
                """
            )
        return [(r["paciente_id"], r["medico_id"], r["ultima_troca"]) for r in rows]

    async def _avaliar(
        self, paciente_id: UUID, ultima_troca: datetime
    ) -> list[dict[str, Any]]:
        """Para cada escala: baseline (último score antes/no dia da troca),
        atual (último score após a troca), queda %, resposta, remissão. Só
        avalia escalas que tenham pelo menos um registro APÓS a troca."""
        async with acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT q.codigo, qr.score_total, qr.respondido_em
                FROM questionarios_respostas qr
                JOIN questionarios q ON q.id = qr.questionario_id
                WHERE qr.paciente_id = $1
                ORDER BY qr.respondido_em
                """,
                paciente_id,
            )

        agora = datetime.now(UTC)
        por_escala: dict[str, list[tuple[int, datetime]]] = {}
        for r in rows:
            por_escala.setdefault(r["codigo"], []).append(
                (r["score_total"], r["respondido_em"])
            )

        outcomes: list[dict[str, Any]] = []
        for codigo, serie in por_escala.items():
            if codigo not in _NOME:
                continue

            antes = [s for s in serie if s[1] <= ultima_troca]
            depois = [s for s in serie if s[1] > ultima_troca]
            if not depois:
                continue  # nada após a troca → não dá pra avaliar resposta

            baseline_score, _ = antes[-1] if antes else depois[0]
            atual_score, _ = depois[-1]
            if baseline_score <= 0:
                continue

            queda_pct = round((baseline_score - atual_score) / baseline_score * 100)
            outcomes.append(
                {
                    "codigo": codigo,
                    "nome": _NOME[codigo],
                    "baseline": baseline_score,
                    "atual": atual_score,
                    "queda_pct": queda_pct,
                    "resposta": atual_score <= baseline_score * 0.5,
                    "remissao": atual_score < 5,
                    "severidade_atual": _interpretar(codigo, atual_score),
                    "semanas_desde_troca": max(0, (agora - ultima_troca).days // 7),
                    "registros_pos_troca": len(depois),
                }
            )
        return outcomes
