"""Classe base dos agentes analíticos.

Cada agente herda de `BaseAgent` e implementa:

* `name` — discriminator usado em `insights.agente` e `agente_execucoes.agente`.
* `find_pending()` — async iterator de payloads (paciente_id + contexto)
  que devem ser processados na próxima rodada.
* `execute(payload)` — gera o insight para um payload. Retorna um
  `InsightOutput` (titulo, conteudo, severidade, metadata).

A base cuida de:

* Abrir/fechar `agente_execucoes` (inicio, conclusão, sucesso, erro,
  tokens, custo, modelo).
* Inserir o `insights` resultante e vincular pelo `insight_id` na
  trilha.
* Idempotência por janela — não roda duas vezes para o mesmo
  `paciente_id` no mesmo dia (ou janela configurável por agente).
* LangSmith tracing automático via callbacks do langchain.
"""

from __future__ import annotations

import abc
from datetime import UTC, datetime, timedelta
from typing import Any, ClassVar
from uuid import UUID

import structlog
from pydantic import BaseModel, Field

from app.core.db import acquire

logger = structlog.get_logger(__name__)


class InsightOutput(BaseModel):
    """Output que cada execução de agente entrega."""

    paciente_id: UUID
    medico_id: UUID
    titulo: str = Field(..., max_length=200)
    conteudo: str
    severidade: str = Field(default="info", pattern=r"^(info|baixa|media|alta|critica)$")
    metadata: dict[str, Any] = Field(default_factory=dict)
    valido_ate: datetime | None = None
    # Métricas opcionais — vão pra agente_execucoes
    tokens_in: int | None = None
    tokens_out: int | None = None
    custo_usd: float | None = None
    modelo: str | None = None


class AgentPayload(BaseModel):
    """Entrada genérica que `find_pending` devolve. Cada agente especializa
    o que coloca em `extra` (ex.: consulta_id, periodo a analisar)."""

    paciente_id: UUID
    medico_id: UUID
    extra: dict[str, Any] = Field(default_factory=dict)


class BaseAgent(abc.ABC):
    """Implementação base. Subclasses só precisam definir name,
    find_pending e execute."""

    # Discriminator em DB
    name: ClassVar[str]

    # Janela de idempotência: não roda se já existe execução de sucesso
    # para o mesmo paciente nesse intervalo (em horas).
    dedup_window_hours: ClassVar[int] = 24

    async def run_once(self) -> dict[str, Any]:
        """Roda um ciclo completo: busca pendentes, executa cada um.

        Returns:
            Resumo: `{processed: int, succeeded: int, failed: int, skipped: int}`
        """
        log = logger.bind(agente=self.name)
        stats = {"processed": 0, "succeeded": 0, "failed": 0, "skipped": 0}

        async for payload in self.find_pending():
            stats["processed"] += 1
            if await self._already_run_recently(payload.paciente_id):
                stats["skipped"] += 1
                log.info("run.skipped_dedup", paciente_id=str(payload.paciente_id))
                continue

            try:
                await self._run_for_payload(payload)
                stats["succeeded"] += 1
            except Exception as exc:
                stats["failed"] += 1
                log.exception(
                    "run.failed",
                    paciente_id=str(payload.paciente_id),
                    error=str(exc),
                )

        log.info("run.done", **stats)
        return stats

    async def _already_run_recently(self, paciente_id: UUID) -> bool:
        cutoff = datetime.now(UTC) - timedelta(hours=self.dedup_window_hours)
        async with acquire() as conn:
            existing = await conn.fetchval(
                """
                SELECT 1 FROM agente_execucoes
                WHERE agente = $1 AND paciente_id = $2
                  AND sucesso = TRUE AND iniciado_em > $3
                LIMIT 1
                """,
                self.name,
                paciente_id,
                cutoff,
            )
            return existing is not None

    async def _run_for_payload(self, payload: AgentPayload) -> UUID | None:
        log = logger.bind(agente=self.name, paciente_id=str(payload.paciente_id))

        async with acquire() as conn:
            execucao_id: UUID = await conn.fetchval(
                """
                INSERT INTO agente_execucoes (agente, paciente_id)
                VALUES ($1, $2)
                RETURNING id
                """,
                self.name,
                payload.paciente_id,
            )
        log.info("execucao.started", execucao_id=str(execucao_id))

        # persist_insight E finalize ficam DENTRO do try: se a gravação do
        # insight ou o UPDATE final falharem, a execução é marcada como FALHA
        # (concluido_em preenchido) em vez de ficar "em aberto" (concluido_em
        # NULL) — zumbi que o dedup (sucesso=TRUE) não enxerga e o scheduler
        # reprocessa indefinidamente, queimando LLM. Bug histórico: 1085
        # execuções de adesao travadas em maio/2026.
        try:
            output = await self.execute(payload)
            insight_id = await self._persist_insight(output)
            await self._finalize_execution(
                execucao_id,
                sucesso=True,
                insight_id=insight_id,
                tokens_in=output.tokens_in,
                tokens_out=output.tokens_out,
                custo_usd=output.custo_usd,
                modelo=output.modelo,
            )
        except Exception as exc:
            await self._finalize_execution(
                execucao_id, sucesso=False, erro=str(exc),
            )
            raise

        log.info(
            "execucao.done",
            execucao_id=str(execucao_id),
            insight_id=str(insight_id),
            tokens_in=output.tokens_in,
            tokens_out=output.tokens_out,
        )
        return insight_id

    async def _persist_insight(self, output: InsightOutput) -> UUID:
        async with acquire() as conn:
            return await conn.fetchval(
                """
                INSERT INTO insights
                    (paciente_id, medico_id, agente, titulo, conteudo,
                     severidade, metadata, valido_ate)
                VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
                RETURNING id
                """,
                output.paciente_id,
                output.medico_id,
                self.name,
                output.titulo,
                output.conteudo,
                output.severidade,
                __import__("json").dumps(output.metadata, ensure_ascii=False, default=str),
                output.valido_ate,
            )

    async def _finalize_execution(
        self,
        execucao_id: UUID,
        *,
        sucesso: bool,
        insight_id: UUID | None = None,
        erro: str | None = None,
        tokens_in: int | None = None,
        tokens_out: int | None = None,
        custo_usd: float | None = None,
        modelo: str | None = None,
    ) -> None:
        async with acquire() as conn:
            await conn.execute(
                """
                UPDATE agente_execucoes
                SET concluido_em = NOW(),
                    sucesso = $1,
                    erro = $2,
                    insight_id = $3,
                    tokens_in = $4,
                    tokens_out = $5,
                    custo_usd = $6,
                    modelo = $7
                WHERE id = $8
                """,
                sucesso,
                erro,
                insight_id,
                tokens_in,
                tokens_out,
                custo_usd,
                modelo,
                execucao_id,
            )

    # ─── Hooks abstratos ───────────────────────────────────────────────

    @abc.abstractmethod
    def find_pending(self):
        """Async iterator de AgentPayload."""
        raise NotImplementedError

    @abc.abstractmethod
    async def execute(self, payload: AgentPayload) -> InsightOutput:
        """Roda o trabalho específico do agente para um payload."""
        raise NotImplementedError
