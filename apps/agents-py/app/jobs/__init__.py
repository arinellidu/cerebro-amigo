"""Registry de jobs agendados.

Diferente dos `agents/` (analíticos, geram `insights` via LLM), `jobs/` 
são tarefas operacionais agendadas:
- gerador_checkins_medicacao: cria linhas em `checkins` a partir de `prescricoes`
- gerador_questionarios: agenda PHQ-9/GAD-7 periodicamente
- (futuros: limpeza, agregações, etc)

Sem LLM, sem `insights`. Apenas SQL + lógica de agendamento.
"""

from app.jobs.alerta_exames_vencidos import AlertaExamesVencidosJob
from app.jobs.alerta_nao_adesao import AlertaNaoAdesaoJob
from app.jobs.base import BaseJob, JobStats
from app.jobs.gerador_checkin_humor import GeradorCheckinHumorJob
from app.jobs.gerador_checkins_medicacao import GeradorCheckinsMedicacaoJob
from app.jobs.gerador_exames import GeradorExamesJob
from app.jobs.gerador_questionarios import GeradorQuestionariosJob
from app.jobs.gerador_renovacao_receita import GeradorRenovacaoReceitaJob
from app.jobs.recall_inativos import RecallInativosJob

# Registry: cada novo job é adicionado aqui e ganha slot no scheduler.
# Os dirigidos por conduta (checkin_humor, alerta_nao_adesao) respeitam
# automacao_pausada + SHADOW_MODE.
JOB_REGISTRY: dict[str, type[BaseJob]] = {
    GeradorCheckinsMedicacaoJob.name: GeradorCheckinsMedicacaoJob,
    GeradorQuestionariosJob.name: GeradorQuestionariosJob,
    GeradorCheckinHumorJob.name: GeradorCheckinHumorJob,
    AlertaNaoAdesaoJob.name: AlertaNaoAdesaoJob,
    GeradorExamesJob.name: GeradorExamesJob,
    AlertaExamesVencidosJob.name: AlertaExamesVencidosJob,
    GeradorRenovacaoReceitaJob.name: GeradorRenovacaoReceitaJob,
    RecallInativosJob.name: RecallInativosJob,
}


def get_job(name: str) -> BaseJob:
    cls = JOB_REGISTRY.get(name)
    if cls is None:
        raise KeyError(f"job desconhecido: {name}")
    return cls()


__all__ = ["JOB_REGISTRY", "BaseJob", "JobStats", "get_job"]
