"""Gera check-ins de medicação a partir de prescrições ativas.

Algoritmo:
  1. Para cada prescrição ativa com inicio_em <= today e
     (fim_em IS NULL OR fim_em >= today):
  2. Para cada horário no array `prescricoes.horarios`:
  3. Para as próximas 48h (janela de geração):
  4. Se NÃO existe `tomadas_medicacao` para o par
     (prescricao_id, horario_previsto):
       a. INSERT tomadas_medicacao (status='pendente')
       b. INSERT checkins (tipo='medicacao', payload={tomada_id, ...})
         com `agendado_para = horario_previsto` para o dispatcher disparar.

Janela de 48h: gera tomadas futuras com folga, sem encher banco com
linhas distantes no tempo. Roda a cada N segundos (mesmo intervalo
do scheduler) — idempotente via UNIQUE check.

`checkins.tipo='medicacao'` consumido pelo dispatcher do notifier-py,
que pega copy de `checkin_copy.py` (ver notifier-py para texto).
"""

from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta
from typing import Any, ClassVar
from zoneinfo import ZoneInfo

import structlog

from app.core.db import acquire
from app.core.tz import local_slot_to_utc, resolve_patient_tz
from app.jobs.base import BaseJob

logger = structlog.get_logger(__name__)

# Janela: gera tomadas até 48h no futuro a partir do tick atual
GERAR_HORAS_NO_FUTURO = 48


class GeradorCheckinsMedicacaoJob(BaseJob):
    """Produtor de check-ins de medicação."""

    name: ClassVar[str] = "gerador_checkins_medicacao"

    async def run_once(self) -> dict[str, Any]:
        log = logger.bind(job=self.name)
        agora = datetime.now(UTC)
        ate = agora + timedelta(hours=GERAR_HORAS_NO_FUTURO)
        today = agora.date()

        stats = {
            "prescricoes_avaliadas": 0,
            "tomadas_criadas": 0,
            "checkins_criados": 0,
            "skipped_ja_existem": 0,
            "erros": 0,
        }

        try:
            async with acquire() as conn:
                # 1. Busca prescrições ativas no intervalo.
                #    Pula pacientes com automação pausada (circuit-breaker de crise).
                prescricoes = await conn.fetch(
                    """
                    SELECT pr.id, pr.paciente_id, pr.medicamento, pr.dose_descricao,
                           pr.horarios, pr.inicio_em, pr.fim_em,
                           pa.config_lembretes
                    FROM prescricoes pr
                    JOIN pacientes pa ON pa.cliente_id = pr.paciente_id
                    WHERE pr.ativa = TRUE
                      AND pa.automacao_pausada = FALSE
                      AND pr.inicio_em <= $1
                      AND (pr.fim_em IS NULL OR pr.fim_em >= $1)
                    """,
                    today,
                )

                stats["prescricoes_avaliadas"] = len(prescricoes)

                # Override por paciente (conduta 'lembrete_medicacao'): pode
                # desligar o lembrete ou ajustar a janela de expiração.
                condutas = await self._carregar_condutas(conn, "lembrete_medicacao")

                for p in prescricoes:
                    cfg = condutas.get(p["paciente_id"], {})
                    if cfg.get("ativo") is False:
                        continue  # médico desligou o lembrete deste paciente
                    expira_horas = int(cfg.get("expira_horas", 4) or 4)

                    # Horários da prescrição são horários de parede LOCAIS do
                    # paciente (DEBT G-4): resolve o fuso
                    # (config_lembretes.timezone → default do produto).
                    tz = resolve_patient_tz(p["config_lembretes"])

                    # 2. Para cada horário do dia atual + amanhã
                    horarios_a_gerar = self._gerar_horarios_na_janela(
                        horarios=list(p["horarios"]),
                        agora=agora,
                        ate=ate,
                        inicio_prescricao=p["inicio_em"],
                        fim_prescricao=p["fim_em"],
                        tz=tz,
                    )

                    for horario_previsto in horarios_a_gerar:
                        # 3. Idempotência: já existe tomada pra esse slot?
                        existe = await conn.fetchval(
                            """
                            SELECT 1 FROM tomadas_medicacao
                            WHERE prescricao_id = $1 
                              AND horario_previsto = $2
                            LIMIT 1
                            """,
                            p["id"],
                            horario_previsto,
                        )
                        if existe:
                            stats["skipped_ja_existem"] += 1
                            continue

                        # 4. Cria tomada
                        try:
                            tomada_id = await conn.fetchval(
                                """
                                INSERT INTO tomadas_medicacao
                                    (prescricao_id, paciente_id, 
                                     horario_previsto, status)
                                VALUES ($1, $2, $3, 'pendente')
                                RETURNING id
                                """,
                                p["id"],
                                p["paciente_id"],
                                horario_previsto,
                            )
                            stats["tomadas_criadas"] += 1
                        except Exception as exc:
                            stats["erros"] += 1
                            log.warning(
                                "tomada.insert_failed",
                                prescricao_id=str(p["id"]),
                                horario=horario_previsto.isoformat(),
                                error=str(exc),
                            )
                            continue

                        # 5. Cria checkin apontando pra tomada
                        try:
                            await conn.execute(
                                """
                                INSERT INTO checkins
                                    (paciente_id, tipo, payload, 
                                     agendado_para, expirado_em)
                                VALUES ($1, 'medicacao', $2::jsonb, $3, $4)
                                """,
                                p["paciente_id"],
                                __import__("json").dumps({
                                    "tomada_id": str(tomada_id),
                                    "prescricao_id": str(p["id"]),
                                    "medicamento": p["medicamento"],
                                    "dose_descricao": p["dose_descricao"],
                                }),
                                horario_previsto,
                                horario_previsto + timedelta(hours=expira_horas),
                            )
                            stats["checkins_criados"] += 1
                        except Exception as exc:
                            stats["erros"] += 1
                            log.warning(
                                "checkin.insert_failed",
                                tomada_id=str(tomada_id),
                                error=str(exc),
                            )

            log.info("job.done", **stats)
            await self._audit_execucao(stats, sucesso=True)
            return stats

        except Exception as exc:
            log.exception("job.failed", error=str(exc))
            await self._audit_execucao(stats, sucesso=False, erro=str(exc))
            raise

    def _gerar_horarios_na_janela(
        self,
        horarios: list[time],
        agora: datetime,
        ate: datetime,
        inicio_prescricao: date,
        fim_prescricao: date | None,
        tz: ZoneInfo,
    ) -> list[datetime]:
        """Gera datetimes (UTC) na janela [agora, ate] a partir de horários por dia.

        Os horários da prescrição são horários de PAREDE no fuso do paciente
        (`tz`), convertidos para UTC (DEBT G-4). Itera sobre dias LOCAIS para
        não perder nem duplicar slots na borda do dia. Retorna apenas horários
        dentro da janela e da vigência da prescrição.
        """
        out: list[datetime] = []
        cursor_dia = agora.astimezone(tz).date()
        fim_local = ate.astimezone(tz).date()
        while cursor_dia <= fim_local:
            # Respeita vigência da prescrição (datas locais)
            if cursor_dia < inicio_prescricao:
                cursor_dia += timedelta(days=1)
                continue
            if fim_prescricao and cursor_dia > fim_prescricao:
                break
            for h in horarios:
                slot = local_slot_to_utc(cursor_dia, h, tz)
                if agora <= slot <= ate:
                    out.append(slot)
            cursor_dia += timedelta(days=1)
        return out
