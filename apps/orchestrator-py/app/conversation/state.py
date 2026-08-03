"""Estado conversacional do grafo (alinhado ao schema real do Cérebro Amigo).

Convenções:
* `paciente_id` no estado é o UUID em `clientes.id` (todas as FKs no DB
  referenciam clientes.id; um paciente é uma especialização 1:1 de cliente).
* Conversa: criada/reaproveitada em `load_context`. Identificada por
  `conversa_id` (uuid em `conversas.id`).
* `mensagem_db_id`: UUID em `mensagens.id` do registro da mensagem do
  paciente (criado em `load_context`). `protocolos_crise_acionados.mensagem_id`
  referencia esse valor.
"""

from __future__ import annotations

from typing import Literal, NotRequired, TypedDict
from uuid import UUID


class CriseInfo(TypedDict):
    detectada: bool
    confianca: float
    nivel: Literal["nenhum", "baixo", "moderado", "alto", "critico"]
    gatilhos: list[str]


class MedicacaoInfo(TypedDict, total=False):
    eh_resposta: bool
    tomada_id: UUID | None        # tomada referenciada pelo checkin
    status: Literal["tomado", "esquecido", "atrasado", "outro"] | None
    nota_paciente: str | None


class SintomasEstruturados(TypedDict, total=False):
    """Snapshot único batendo com a tabela `sintomas` (colunas fixas)."""
    humor: int | None
    ansiedade: int | None
    sono_horas: float | None
    sono_qualidade: int | None
    energia: int | None
    apetite: int | None
    irritabilidade: int | None
    nota: str | None


class AuditDecision(TypedDict):
    decisao: Literal["enviar", "reescrever", "bloquear"]
    motivo: str
    flags: list[str]


class ConversaState(TypedDict, total=False):
    # ─── Entrada ───
    paciente_id: UUID                      # = clientes.id
    idempotency_key: str                   # UUID/hash gerado pelo cliente
    mensagem: str
    canal: Literal["pwa", "whatsapp"]

    # ─── Contexto carregado em load_context ───
    nome_paciente: str
    medico_responsavel_id: UUID
    automacao_pausada: bool
    conversa_id: UUID
    conversa_status: str                   # 'aberta', 'humano', 'encerrada'
    mensagem_db_id: UUID                   # mensagens.id da msg do paciente
    checkin_pendente: NotRequired[dict | None]   # row do checkin tipo='medicacao' se houver
    prescricoes_ativas: list[dict]

    # ─── Análise ───
    crise: CriseInfo
    medicacao: MedicacaoInfo
    sintomas: NotRequired[SintomasEstruturados | None]

    # ─── Resposta ───
    resposta_rascunho: str
    resposta_final: str | None
    audit: AuditDecision
    retry_count: int

    # ─── ADR-063 modo degradado ───
    # True quando o classificador de crise está sistemicamente indisponível e a
    # mensagem não bateu no screen determinístico (camada 1). Rota para
    # `degraded_response` (human loop + notificação técnica, sem protocolo de crise).
    modo_degradado: NotRequired[bool]

    # ─── Telemetria / billing ───
    trace_id: str
    enviado: bool
    modelo_resposta: NotRequired[str | None]
    tokens_in: NotRequired[int | None]
    tokens_out: NotRequired[int | None]
    custo_usd: NotRequired[float | None]
