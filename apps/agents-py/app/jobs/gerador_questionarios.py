"""Gera check-ins de questionários clínicos (PHQ-9, GAD-7) agendados.

Schedule:
  - PHQ-9 (depressão): toda segunda às 09:00 UTC
  - GAD-7 (ansiedade): toda quinta às 09:00 UTC

Janela: gera próximas 24h. Roda a cada tick, idempotente.

Critério de elegibilidade:
  - Paciente ativo (cliente com pacientes_credenciais válidas)
  - Não tem check-in pendente do mesmo tipo (evita acumular)

Resposta processada pelo api-gateway em `CheckinsEndpoints.cs` →
`ProcessarRespostaQuestionario`, que insere em `questionarios_respostas`
com score + interpretação (já implementado).
"""

from __future__ import annotations

from datetime import UTC, datetime, time, timedelta
from typing import Any, ClassVar

import structlog

from app.core.db import acquire
from app.jobs.base import BaseJob

logger = structlog.get_logger(__name__)

# Janela de 24h pra gerar checkins futuros
JANELA_HORAS = 168

# Schedule por questionário: (weekday_python, hora_utc)
# weekday: 0=segunda, 1=terça, 2=quarta, 3=quinta, 4=sexta, 5=sábado, 6=domingo
SCHEDULE: dict[str, tuple[int, int]] = {
    "phq9": (0, 9),   # segunda 09:00 UTC
    "gad7": (3, 9),   # quinta 09:00 UTC
}


class GeradorQuestionariosJob(BaseJob):
    """Produtor de check-ins de questionários clínicos."""

    name: ClassVar[str] = "gerador_questionarios"

    async def run_once(self) -> dict[str, Any]:
        log = logger.bind(job=self.name)
        agora = datetime.now(UTC)
        ate = agora + timedelta(hours=JANELA_HORAS)

        stats = {
            "pacientes_avaliados": 0,
            "checkins_criados": 0,
            "skipped_ja_pendente": 0,
            "skipped_fora_janela": 0,
            "erros": 0,
        }

        try:
            async with acquire() as conn:
                # Lista pacientes ativos
                pacientes = await conn.fetch(
                    """
                    SELECT p.cliente_id, p.medico_responsavel_id
                    FROM pacientes p
                    JOIN pacientes_credenciais pc ON pc.paciente_id = p.cliente_id
                    WHERE p.automacao_pausada = FALSE
                    """
                )

                stats["pacientes_avaliados"] = len(pacientes)

                # Override por paciente (conduta 'questionario').
                condutas = await self._carregar_condutas(conn, "questionario")

                for paciente in pacientes:
                    paciente_id = paciente["cliente_id"]
                    cfg = condutas.get(paciente_id, {})
                    if cfg.get("ativo") is False:
                        continue  # médico desligou questionários deste paciente

                    for codigo, (weekday, hora) in self._schedule_para(cfg).items():
                        # Calcula próximo slot do questionário
                        slot = self._proximo_slot(agora, weekday, hora)

                        # Está dentro da janela?
                        if slot > ate:
                            stats["skipped_fora_janela"] += 1
                            continue

                        tipo_checkin = f"questionario_{codigo}"

                        # Idempotência: já existe pendente?
                        existe = await conn.fetchval(
                            """
                            SELECT 1 FROM checkins
                            WHERE paciente_id = $1
                              AND tipo = $2
                              AND respondido_em IS NULL
                              AND (expirado_em IS NULL OR expirado_em > NOW())
                            LIMIT 1
                            """,
                            paciente_id,
                            tipo_checkin,
                        )
                        if existe:
                            stats["skipped_ja_pendente"] += 1
                            continue

                        # Cria check-in com payload do questionário
                        try:
                            await conn.execute(
                                """
                                INSERT INTO checkins
                                    (paciente_id, tipo, payload,
                                     agendado_para, expirado_em)
                                VALUES ($1, $2, $3::jsonb, $4, $5)
                                """,
                                paciente_id,
                                tipo_checkin,
                                __import__("json").dumps({
                                    "questionario_codigo": codigo,
                                    "questionario_nome": (
                                        "PHQ-9 — Depressão" if codigo == "phq9"
                                        else "GAD-7 — Ansiedade"
                                    ),
                                }),
                                slot,
                                slot + timedelta(hours=72),  # expira em 3 dias
                            )
                            stats["checkins_criados"] += 1
                        except Exception as exc:
                            stats["erros"] += 1
                            log.warning(
                                "checkin.insert_failed",
                                paciente_id=str(paciente_id),
                                tipo=tipo_checkin,
                                error=str(exc),
                            )

            log.info("job.done", **stats)
            await self._audit_execucao(stats, sucesso=True)
            return stats

        except Exception as exc:
            log.exception("job.failed", error=str(exc))
            await self._audit_execucao(stats, sucesso=False, erro=str(exc))
            raise

    def _schedule_para(self, cfg: dict) -> dict[str, tuple[int, int]]:
        """Schedule efetivo por paciente: override da conduta sobre o global.

        cfg pode trazer `<codigo>_weekday` e `hora_utc`; ausentes caem no
        SCHEDULE global. cfg vazio => schedule global inalterado.
        """
        out: dict[str, tuple[int, int]] = {}
        for codigo, (wd, hr) in SCHEDULE.items():
            wd_ov = cfg.get(f"{codigo}_weekday")
            hr_ov = cfg.get("hora_utc")
            out[codigo] = (
                int(wd_ov) if wd_ov is not None else wd,
                int(hr_ov) if hr_ov is not None else hr,
            )
        return out

    def _proximo_slot(
        self, agora: datetime, weekday_alvo: int, hora_utc: int
    ) -> datetime:
        """Calcula o próximo datetime no dia da semana e hora especificados.

        Se hoje é o weekday certo MAS já passou da hora, vai pra próxima semana.
        """
        # Quantos dias até o próximo weekday alvo
        dias_ate = (weekday_alvo - agora.weekday()) % 7

        slot = datetime.combine(
            agora.date() + timedelta(days=dias_ate),
            time(hour=hora_utc),
            tzinfo=UTC,
        )

        # Se o slot calculado já passou (mesmo dia mas hora menor), pula 7 dias
        if slot <= agora:
            slot += timedelta(days=7)

        return slot
