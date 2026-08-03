"""Renovação de receita de controle especial (A4, ADR-032).

Determinístico (sem LLM): a partir das prescrições ATIVAS com `receita_validade`
preenchida, monta uma fila de renovação e notifica o médico ANTES do vencimento
(antecedência configurável), evitando ruptura de tratamento por receita vencida.

A reemissão LEGAL da receita é sempre do médico (via MEMED). A IA não decide
renovar, não ajusta dose, não contata o paciente aqui. Apenas organiza um fato
("receita X vence em N dias") para o médico agir.

clinical-safety: respeita `pacientes.automacao_pausada` (circuit-breaker de crise)
e o gate `SHADOW_MODE` para a NOTIFICAÇÃO (como alerta_exames_vencidos). A linha
de fila é dado operacional/factual; a notificação ao médico é doctor-facing.
Idempotente: não recria renovação para a mesma (prescrição, vencimento).
"""

from __future__ import annotations

from typing import Any, ClassVar

import structlog

from app.core.config import get_settings
from app.core.db import acquire
from app.jobs.base import BaseJob

logger = structlog.get_logger(__name__)

PROTOCOLO_VERSAO = "A4-v1"


class GeradorRenovacaoReceitaJob(BaseJob):
    name: ClassVar[str] = "gerador_renovacao_receita"

    async def run_once(self) -> dict[str, Any]:
        settings = get_settings()
        antecedencia = settings.renovacao_antecedencia_dias
        shadow = settings.shadow_mode
        proto = f"{PROTOCOLO_VERSAO}:{antecedencia}d"
        log = logger.bind(job=self.name)
        stats = {
            "candidatas": 0,
            "filas_criadas": 0,
            "notificadas": 0,
            "shadow_skipped": 0,
            "erros": 0,
        }
        try:
            async with acquire() as conn:
                # Prescrições controladas (validade preenchida) perto do vencimento
                # e ainda sem linha de renovação para aquele vencimento.
                candidatas = await conn.fetch(
                    """
                    SELECT pr.id AS prescricao_id, pr.paciente_id, pr.medicamento,
                           pr.receita_tipo, pr.receita_validade AS vence_em,
                           p.medico_responsavel_id AS medico_id,
                           c.nome AS paciente_nome,
                           (pr.receita_validade - CURRENT_DATE) AS dias_para_vencer
                    FROM prescricoes pr
                    JOIN pacientes p ON p.cliente_id = pr.paciente_id
                    JOIN clientes c ON c.id = pr.paciente_id
                    WHERE pr.ativa = TRUE
                      AND p.automacao_pausada = FALSE
                      AND p.medico_responsavel_id IS NOT NULL
                      AND pr.receita_validade IS NOT NULL
                      AND pr.receita_validade <= (CURRENT_DATE + ($1)::int)
                      AND pr.receita_validade >= (CURRENT_DATE - 60)
                      AND NOT EXISTS (
                          SELECT 1 FROM receita_renovacoes rr
                          WHERE rr.prescricao_id = pr.id
                            AND rr.vence_em = pr.receita_validade
                      )
                    """,
                    antecedencia,
                )
                stats["candidatas"] = len(candidatas)

                for r in candidatas:
                    try:
                        nova = await conn.fetchrow(
                            """
                            INSERT INTO receita_renovacoes
                                (paciente_id, medico_id, prescricao_id, medicamento,
                                 receita_tipo, vence_em, protocolo_versao)
                            VALUES ($1, $2, $3, $4, $5, $6, $7)
                            ON CONFLICT (prescricao_id, vence_em)
                                WHERE status = 'pendente' DO NOTHING
                            RETURNING id
                            """,
                            r["paciente_id"], r["medico_id"], r["prescricao_id"],
                            (r["medicamento"] or "")[:200], r["receita_tipo"],
                            r["vence_em"], proto,
                        )
                        if nova is None:
                            continue  # corrida/duplicata — já existe pendente
                        stats["filas_criadas"] += 1

                        if shadow:
                            stats["shadow_skipped"] += 1
                            log.info(
                                "shadow.would_notify_renovacao",
                                paciente_id=str(r["paciente_id"]),
                                medicamento=(r["medicamento"] or "")[:60],
                                dias=int(r["dias_para_vencer"]),
                            )
                            continue

                        dias = int(r["dias_para_vencer"])
                        sev = "urgente" if dias < 0 else "atencao"
                        venc_txt = (
                            f"vence em {dias} dia(s)" if dias > 0
                            else "vence hoje" if dias == 0
                            else f"venceu há {abs(dias)} dia(s)"
                        )
                        await conn.execute(
                            """
                            INSERT INTO notificacoes_medico
                                (medico_id, paciente_id, severidade, tipo, titulo, mensagem)
                            VALUES ($1, $2, $3, 'renovacao_receita', $4, $5)
                            """,
                            r["medico_id"], r["paciente_id"], sev,
                            "Renovação de receita",
                            f"{r['paciente_nome'] or 'Paciente'}: receita de "
                            f"{(r['medicamento'] or 'medicamento')} {venc_txt} "
                            f"(validade {r['vence_em']}).",
                        )
                        await conn.execute(
                            "UPDATE receita_renovacoes SET notificado_em = NOW() WHERE id = $1",
                            nova["id"],
                        )
                        stats["notificadas"] += 1
                    except Exception as exc:
                        stats["erros"] += 1
                        log.warning("renovacao.insert_failed", error=str(exc))

            log.info("job.done", shadow=shadow, **stats)
            await self._audit_execucao(stats, sucesso=True)
            return stats
        except Exception as exc:
            log.exception("job.failed", error=str(exc))
            await self._audit_execucao(stats, sucesso=False, erro=str(exc))
            raise
