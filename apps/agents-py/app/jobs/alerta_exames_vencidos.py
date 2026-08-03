"""Alerta o médico sobre exames de monitoramento ATRASADOS (S2, ADR-029).

Factual: "exame X vencido há N dias". Sem conduta, sem LLM. Dedup por
`alerta_atraso_em` (re-alerta no máximo a cada 7 dias). Respeita
`pacientes.automacao_pausada` e o gate `SHADOW_MODE` (como alerta_nao_adesao).
"""

from __future__ import annotations

from typing import Any, ClassVar

import structlog

from app.core.config import get_settings
from app.core.db import acquire
from app.jobs.base import BaseJob

logger = structlog.get_logger(__name__)

_LABEL = {
    "litemia": "Litemia",
    "hemograma": "Hemograma",
    "funcao_hepatica": "Função hepática",
    "perfil_metabolico": "Perfil metabólico",
    "peso": "Peso",
    "ecg_qt": "ECG (QTc)",
}


class AlertaExamesVencidosJob(BaseJob):
    name: ClassVar[str] = "alerta_exames_vencidos"

    async def run_once(self) -> dict[str, Any]:
        log = logger.bind(job=self.name)
        shadow = get_settings().shadow_mode
        stats = {"vencidos": 0, "alertas_criados": 0, "shadow_skipped": 0, "erros": 0}
        try:
            async with acquire() as conn:
                rows = await conn.fetch(
                    """
                    SELECT ea.id, ea.paciente_id, ea.medico_id, ea.tipo_exame,
                           ea.devido_em, c.nome AS paciente_nome,
                           (CURRENT_DATE - ea.devido_em) AS dias_atraso
                    FROM exames_agenda ea
                    JOIN pacientes p ON p.cliente_id = ea.paciente_id
                    JOIN clientes c ON c.id = ea.paciente_id
                    WHERE ea.status = 'agendado'
                      AND ea.devido_em < CURRENT_DATE
                      AND ea.medico_id IS NOT NULL
                      AND p.automacao_pausada = FALSE
                      AND (ea.alerta_atraso_em IS NULL
                           OR ea.alerta_atraso_em < NOW() - INTERVAL '7 days')
                    """
                )
                stats["vencidos"] = len(rows)

                for r in rows:
                    if shadow:
                        stats["shadow_skipped"] += 1
                        log.info(
                            "shadow.would_alert_exame",
                            paciente_id=str(r["paciente_id"]),
                            tipo=r["tipo_exame"],
                            dias=int(r["dias_atraso"]),
                        )
                        continue

                    label = _LABEL.get(r["tipo_exame"], r["tipo_exame"])
                    # Hemograma atrasado (clozapina/agranulocitose) é mais grave.
                    sev = "urgente" if r["tipo_exame"] == "hemograma" else "atencao"
                    try:
                        await conn.execute(
                            """
                            INSERT INTO notificacoes_medico
                                (medico_id, paciente_id, severidade, tipo, titulo, mensagem)
                            VALUES ($1, $2, $3, 'exame_atrasado', $4, $5)
                            """,
                            r["medico_id"], r["paciente_id"], sev,
                            f"Exame de monitoramento atrasado: {label}",
                            f"{r['paciente_nome'] or 'Paciente'}: {label} vencido há "
                            f"{int(r['dias_atraso'])} dia(s) (previsto para {r['devido_em']}).",
                        )
                        await conn.execute(
                            "UPDATE exames_agenda SET alerta_atraso_em = NOW() WHERE id = $1",
                            r["id"],
                        )
                        stats["alertas_criados"] += 1
                    except Exception as exc:
                        stats["erros"] += 1
                        log.warning("alerta_exame.insert_failed", error=str(exc))

            log.info("job.done", shadow=shadow, **stats)
            await self._audit_execucao(stats, sucesso=True)
            return stats
        except Exception as exc:
            log.exception("job.failed", error=str(exc))
            await self._audit_execucao(stats, sucesso=False, erro=str(exc))
            raise
