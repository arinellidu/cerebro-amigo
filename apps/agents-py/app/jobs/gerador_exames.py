"""Gera a agenda de exames de monitoramento a partir das prescrições ativas.

Determinístico (sem LLM): para cada prescrição ativa, o protocolo
(exame_protocolo.py) diz quais exames são exigidos, com cadência e faixa de
referência — a faixa é COPIADA para a linha do exame (factual, auditável).
Idempotente: não recria exame já pendente para (paciente, tipo, prescrição).
Reagenda o próximo ciclo a partir do último resultado registrado.

clinical-safety: a agenda é dado operacional/factual para o médico; respeita
`pacientes.automacao_pausada` (circuit-breaker de crise). Não contata o paciente
aqui (por isso, sem gate de SHADOW_MODE — como o gerador de check-ins).
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any, ClassVar

import structlog

from app.core.db import acquire
from app.jobs.base import BaseJob
from app.jobs.exame_protocolo import PROTOCOLO_VERSAO, protocolos_para

logger = structlog.get_logger(__name__)

# Carência até o exame basal quando a prescrição ativa é detectada.
CARENCIA_BASAL_DIAS = 7


class GeradorExamesJob(BaseJob):
    name: ClassVar[str] = "gerador_exames"

    async def run_once(self) -> dict[str, Any]:
        log = logger.bind(job=self.name)
        hoje = date.today()
        stats = {
            "prescricoes_avaliadas": 0,
            "exames_agendados": 0,
            "skipped_ja_existem": 0,
            "sem_protocolo": 0,
            "erros": 0,
        }
        try:
            async with acquire() as conn:
                prescricoes = await conn.fetch(
                    """
                    SELECT pr.id, pr.paciente_id, pr.medicamento,
                           p.medico_responsavel_id AS medico_id
                    FROM prescricoes pr
                    JOIN pacientes p ON p.cliente_id = pr.paciente_id
                    WHERE pr.ativa = TRUE AND p.automacao_pausada = FALSE
                    """
                )
                stats["prescricoes_avaliadas"] = len(prescricoes)

                for pr in prescricoes:
                    protos = protocolos_para(pr["medicamento"] or "")
                    if not protos:
                        stats["sem_protocolo"] += 1
                        continue

                    for e in protos:
                        # Idempotência: já há exame pendente p/ (paciente, tipo, prescrição)?
                        existe = await conn.fetchval(
                            """
                            SELECT 1 FROM exames_agenda
                            WHERE paciente_id = $1 AND tipo_exame = $2
                              AND prescricao_id = $3 AND status = 'agendado'
                            LIMIT 1
                            """,
                            pr["paciente_id"], e.tipo_exame, pr["id"],
                        )
                        if existe:
                            stats["skipped_ja_existem"] += 1
                            continue

                        # Próximo ciclo: último resultado + periodicidade; senão basal.
                        ultimo = await conn.fetchval(
                            """
                            SELECT resultado_em FROM exames_agenda
                            WHERE paciente_id = $1 AND tipo_exame = $2
                              AND prescricao_id = $3 AND status = 'realizado'
                              AND resultado_em IS NOT NULL
                            ORDER BY resultado_em DESC LIMIT 1
                            """,
                            pr["paciente_id"], e.tipo_exame, pr["id"],
                        )
                        devido = (
                            ultimo + timedelta(days=e.periodicidade_dias)
                            if ultimo
                            else hoje + timedelta(days=CARENCIA_BASAL_DIAS)
                        )

                        try:
                            await conn.execute(
                                """
                                INSERT INTO exames_agenda
                                    (paciente_id, medico_id, prescricao_id, tipo_exame,
                                     motivo, protocolo_versao, devido_em, periodicidade_dias,
                                     ref_label, ref_unidade, ref_min, ref_max)
                                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
                                """,
                                pr["paciente_id"], pr["medico_id"], pr["id"], e.tipo_exame,
                                (pr["medicamento"] or "")[:120], PROTOCOLO_VERSAO, devido,
                                e.periodicidade_dias, e.ref_label, e.ref_unidade,
                                e.ref_min, e.ref_max,
                            )
                            stats["exames_agendados"] += 1
                        except Exception as exc:
                            # UNIQUE parcial pode barrar corrida entre ticks — ok.
                            stats["erros"] += 1
                            log.warning(
                                "exame.insert_failed",
                                prescricao_id=str(pr["id"]),
                                tipo=e.tipo_exame,
                                error=str(exc),
                            )

            log.info("job.done", **stats)
            await self._audit_execucao(stats, sucesso=True)
            return stats
        except Exception as exc:
            log.exception("job.failed", error=str(exc))
            await self._audit_execucao(stats, sucesso=False, erro=str(exc))
            raise
