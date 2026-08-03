"""Recall de pacientes inativos (item 2 / ADR-033) — recuperação de receita.

Determinístico (sem LLM): detecta pacientes que JÁ consultaram mas não retornam
há N dias (RECALL_INATIVO_DIAS) e não têm consulta futura agendada → notifica o
médico para reengajar (oportunidade de retorno = receita recuperada).

É comunicação ADMINISTRATIVA ao médico (não ao paciente, não clínica): "fulano
sem retorno há N dias". A decisão de chamar é do médico.

clinical-safety: respeita `pacientes.automacao_pausada` (circuit-breaker de crise)
e o gate `SHADOW_MODE`. Dedup: no máximo 1 recall por paciente a cada
RECALL_DEDUP_DIAS (via notificacoes_medico tipo 'recall_inativo').
"""

from __future__ import annotations

from typing import Any, ClassVar

import structlog

from app.core.config import get_settings
from app.core.db import acquire
from app.jobs.base import BaseJob

logger = structlog.get_logger(__name__)


class RecallInativosJob(BaseJob):
    name: ClassVar[str] = "recall_inativos"

    async def run_once(self) -> dict[str, Any]:
        settings = get_settings()
        dias = settings.recall_inativo_dias
        dedup = settings.recall_dedup_dias
        shadow = settings.shadow_mode
        log = logger.bind(job=self.name)
        stats = {"inativos": 0, "notificados": 0, "shadow_skipped": 0, "erros": 0}
        try:
            async with acquire() as conn:
                # Pacientes que JÁ consultaram, mas cuja última consulta realizada
                # é antiga e que não têm retorno agendado — e sem recall recente.
                rows = await conn.fetch(
                    """
                    SELECT p.cliente_id AS paciente_id,
                           p.medico_responsavel_id AS medico_id,
                           c.nome AS paciente_nome,
                           MAX(k.inicia_em)::date AS ultima
                    FROM pacientes p
                    JOIN clientes c ON c.id = p.cliente_id
                    JOIN consultas k ON k.paciente_id = p.cliente_id AND k.status = 'realizada'
                    WHERE p.automacao_pausada = FALSE
                      AND p.medico_responsavel_id IS NOT NULL
                    GROUP BY p.cliente_id, p.medico_responsavel_id, c.nome
                    HAVING MAX(k.inicia_em) < NOW() - ($1)::int * INTERVAL '1 day'
                       AND NOT EXISTS (
                           SELECT 1 FROM consultas f
                           WHERE f.paciente_id = p.cliente_id
                             AND f.status IN ('agendada', 'confirmada')
                             AND f.inicia_em > NOW())
                       AND NOT EXISTS (
                           SELECT 1 FROM notificacoes_medico n
                           WHERE n.paciente_id = p.cliente_id
                             AND n.tipo = 'recall_inativo'
                             AND n.criada_em > NOW() - ($2)::int * INTERVAL '1 day')
                    """,
                    dias, dedup,
                )
                stats["inativos"] = len(rows)

                for r in rows:
                    if shadow:
                        stats["shadow_skipped"] += 1
                        log.info(
                            "shadow.would_recall",
                            paciente_id=str(r["paciente_id"]),
                            ultima=str(r["ultima"]),
                        )
                        continue
                    try:
                        await conn.execute(
                            """
                            INSERT INTO notificacoes_medico
                                (medico_id, paciente_id, severidade, tipo, titulo, mensagem)
                            VALUES ($1, $2, 'info', 'recall_inativo', $3, $4)
                            """,
                            r["medico_id"], r["paciente_id"],
                            "Paciente para retorno",
                            f"{r['paciente_nome'] or 'Paciente'}: sem retorno desde "
                            f"{r['ultima']}. Oportunidade de reengajamento.",
                        )
                        stats["notificados"] += 1
                    except Exception as exc:
                        stats["erros"] += 1
                        log.warning("recall.insert_failed", error=str(exc))

            log.info("job.done", shadow=shadow, **stats)
            await self._audit_execucao(stats, sucesso=True)
            return stats
        except Exception as exc:
            log.exception("job.failed", error=str(exc))
            await self._audit_execucao(stats, sucesso=False, erro=str(exc))
            raise
