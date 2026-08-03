"""Registry de agentes."""

from app.agents.adesao import AdesaoAgent
from app.agents.base import AgentPayload, BaseAgent, InsightOutput
from app.agents.desfecho import DesfechoAgent
from app.agents.diario import DiarioAgent
from app.agents.padroes import PadroesAgent
from app.agents.resumidor import ResumidorAgent
from app.agents.risco_silencioso import RiscoSilenciosoAgent

# Registry: cada novo agente é adicionado aqui e ganha endpoint manual + slot
# de schedule automático.
AGENT_REGISTRY: dict[str, type[BaseAgent]] = {
    ResumidorAgent.name: ResumidorAgent,
    AdesaoAgent.name: AdesaoAgent,
    RiscoSilenciosoAgent.name: RiscoSilenciosoAgent,
    PadroesAgent.name: PadroesAgent,
    DiarioAgent.name: DiarioAgent,
    DesfechoAgent.name: DesfechoAgent,
}


def get_agent(name: str) -> BaseAgent:
    cls = AGENT_REGISTRY.get(name)
    if cls is None:
        raise KeyError(f"agente desconhecido: {name}")
    return cls()


__all__ = ["AGENT_REGISTRY", "AgentPayload", "BaseAgent", "InsightOutput", "get_agent"]
