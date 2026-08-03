"""Gera check-ins de humor diário a partir de condutas `checkin_humor`.

Diferente dos questionários (schedule global fixo), o check-in de humor é
OPCIONAL e dirigido pela conduta que o médico configura por paciente (dias da
semana + horário). Sem conduta ativa, não gera nada.

clinical-safety: ação proativa nova → respeita `pacientes.automacao_pausada`
(circuit-breaker de crise) e o gate `SHADOW_MODE` (loga o que faria, sem
inserir) até validação clínica.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, time, timedelta
from typing import Any, ClassVar

import structlog

from app.core.config import get_settings
from app.core.db import acquire
from app.jobs.base import BaseJob

logger = structlog.get_logger(__name__)

JANELA_HORAS = 24


class GeradorCheckinHumorJob(BaseJob):
    """Cria checkins `humor_diario` conforme a conduta do paciente."""

    name: ClassVar[str] = "gerador_checkin_humor"

    async def run_once(self) -> dict[str, Any]:
        log = logger.bind(job=self.name)
        settings = get_settings()
        shadow = settings.shadow_mode
        agora = datetime.now(UTC)
        ate = agora + timedelta(hours=JANELA_HORAS)

        stats = {
            "pacientes": 0,
            "checkins_criados": 0,
            "shadow_skipped": 0,
            "skipped_ja_pendente": 0,
            "erros": 0,
        }

        try:
            async with acquire() as conn:
                # Pacientes com conduta checkin_humor ativa e automação NÃO pausada.
                rows = await conn.fetch(
                    """
                    SELECT ca.paciente_id, ca.config
                    FROM condutas_automacao ca
                    JOIN pacientes p ON p.cliente_id = ca.paciente_id
                    WHERE ca.tipo = 'checkin_humor' AND ca.ativa = TRUE
                      AND p.automacao_pausada = FALSE
                    """
                )
                stats["pacientes"] = len(rows)

                for r in rows:
                    cfg = self._parse_cfg(r["config"])
                    if cfg.get("ativo") is False:
                        continue
                    dias = cfg.get("dias") or [0, 1, 2, 3, 4, 5, 6]
                    hora = int(cfg.get("hora_utc", settings.checkin_humor_hora_utc_default) or 12)

                    for slot in self._slots(dias, hora, agora, ate):
                        existe = await conn.fetchval(
                            """
                            SELECT 1 FROM checkins
                            WHERE paciente_id = $1 AND tipo = 'humor_diario'
                              AND respondido_em IS NULL
                              AND (expirado_em IS NULL OR expirado_em > NOW())
                            LIMIT 1
                            """,
                            r["paciente_id"],
                        )
                        if existe:
                            stats["skipped_ja_pendente"] += 1
                            continue
                        if shadow:
                            stats["shadow_skipped"] += 1
                            log.info(
                                "shadow.would_create_checkin_humor",
                                paciente_id=str(r["paciente_id"]),
                                slot=slot.isoformat(),
                            )
                            continue
                        try:
                            await conn.execute(
                                """
                                INSERT INTO checkins
                                    (paciente_id, tipo, payload, agendado_para, expirado_em)
                                VALUES ($1, 'humor_diario', '{}'::jsonb, $2, $3)
                                """,
                                r["paciente_id"],
                                slot,
                                slot + timedelta(hours=12),
                            )
                            stats["checkins_criados"] += 1
                        except Exception as exc:
                            stats["erros"] += 1
                            log.warning("checkin_humor.insert_failed", error=str(exc))

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

    def _slots(
        self, dias: list[int], hora_utc: int, agora: datetime, ate: datetime
    ) -> list[datetime]:
        """Slots (datetime UTC) nos dias-da-semana pedidos dentro de [agora, ate]."""
        out: list[datetime] = []
        dia = agora.date()
        while dia <= ate.date():
            if dia.weekday() in dias:
                slot = datetime.combine(dia, time(hour=int(hora_utc) % 24), tzinfo=UTC)
                if agora <= slot <= ate:
                    out.append(slot)
            dia += timedelta(days=1)
        return out
