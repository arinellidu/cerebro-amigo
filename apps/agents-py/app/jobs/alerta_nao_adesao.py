"""Alerta de não-adesão dirigido por conduta `alerta_nao_adesao`.

Tripwire OPERACIONAL por paciente (sem LLM, sem interpretação clínica): conta
doses registradas como 'esquecida' na janela; se ≥ limiar configurado pelo
médico, registra uma `notificacao_medico`. Complementa o agente analítico
`adesao` (análise rica periódica) com o gatilho explícito que o médico definiu.

clinical-safety: organizacional (contagem + aviso), não-clínico. Respeita
`pacientes.automacao_pausada` e o gate `SHADOW_MODE`. Dedup evita spam.
"""

from __future__ import annotations

import json
from typing import Any, ClassVar

import structlog

from app.core.config import get_settings
from app.core.db import acquire
from app.jobs.base import BaseJob

logger = structlog.get_logger(__name__)


class AlertaNaoAdesaoJob(BaseJob):
    """Avisa o médico quando o paciente passa do limiar de doses não tomadas."""

    name: ClassVar[str] = "alerta_nao_adesao"

    async def run_once(self) -> dict[str, Any]:
        log = logger.bind(job=self.name)
        settings = get_settings()
        shadow = settings.shadow_mode

        stats = {
            "pacientes": 0,
            "alertas_criados": 0,
            "shadow_skipped": 0,
            "skipped_dedup": 0,
            "abaixo_limiar": 0,
            "erros": 0,
        }

        try:
            async with acquire() as conn:
                rows = await conn.fetch(
                    """
                    SELECT ca.paciente_id, ca.config,
                           p.medico_responsavel_id AS medico_id,
                           c.nome AS paciente_nome
                    FROM condutas_automacao ca
                    JOIN pacientes p ON p.cliente_id = ca.paciente_id
                    JOIN clientes c ON c.id = ca.paciente_id
                    WHERE ca.tipo = 'alerta_nao_adesao' AND ca.ativa = TRUE
                      AND p.automacao_pausada = FALSE
                    """
                )
                stats["pacientes"] = len(rows)

                for r in rows:
                    cfg = self._parse_cfg(r["config"])
                    if cfg.get("ativo") is False:
                        continue
                    limiar = int(cfg.get("limiar", settings.alerta_nao_adesao_limiar_default) or 2)
                    janela = int(
                        cfg.get("janela_dias", settings.alerta_nao_adesao_janela_dias_default) or 7
                    )

                    faltas = (
                        await conn.fetchval(
                            """
                            SELECT COUNT(*) FROM tomadas_medicacao
                            WHERE paciente_id = $1 AND status = 'esquecida'
                              AND horario_previsto > NOW() - make_interval(days => $2)
                            """,
                            r["paciente_id"],
                            janela,
                        )
                        or 0
                    )
                    if faltas < limiar:
                        stats["abaixo_limiar"] += 1
                        continue

                    # Dedup: já avisou nas últimas N horas?
                    recente = await conn.fetchval(
                        """
                        SELECT 1 FROM notificacoes_medico
                        WHERE paciente_id = $1 AND tipo = 'alerta_nao_adesao'
                          AND criada_em > NOW() - make_interval(hours => $2)
                        LIMIT 1
                        """,
                        r["paciente_id"],
                        settings.alerta_nao_adesao_dedup_horas,
                    )
                    if recente:
                        stats["skipped_dedup"] += 1
                        continue

                    if shadow:
                        stats["shadow_skipped"] += 1
                        log.info(
                            "shadow.would_alert_nao_adesao",
                            paciente_id=str(r["paciente_id"]),
                            faltas=faltas,
                            limiar=limiar,
                        )
                        continue

                    try:
                        sev = "urgente" if faltas >= limiar * 2 else "atencao"
                        await conn.execute(
                            """
                            INSERT INTO notificacoes_medico
                                (medico_id, paciente_id, severidade, tipo, titulo, mensagem)
                            VALUES ($1, $2, $3, 'alerta_nao_adesao', $4, $5)
                            """,
                            r["medico_id"],
                            r["paciente_id"],
                            sev,
                            "Possível não-adesão",
                            f"{r['paciente_nome'] or 'Paciente'}: {faltas} dose(s) registrada(s) "
                            f"como não tomada(s) nos últimos {janela} dias (limiar {limiar}).",
                        )
                        stats["alertas_criados"] += 1
                    except Exception as exc:
                        stats["erros"] += 1
                        log.warning("alerta_nao_adesao.insert_failed", error=str(exc))

            log.info("job.done", shadow=shadow, **stats)
            await self._audit_execucao(stats, sucesso=True)
            return stats
        except Exception as exc:
            log.exception("job.failed", error=str(exc))
            await self._audit_execucao(stats, sucesso=False, erro=str(exc))
            raise

    @staticmethod
    def _parse_cfg(raw: Any) -> dict:
        if isinstance(raw, str):
            try:
                return json.loads(raw) or {}
            except Exception:
                return {}
        return raw or {}
