"""Geração, auditoria e escalada da resposta ao paciente."""

from __future__ import annotations

import json

import structlog
from langchain_core.messages import HumanMessage, SystemMessage

from app.config import get_settings
from app.conversation.llm import haiku, resolve_model_id, sonnet, with_schema
from app.conversation.pricing import LLMProvider, ModelTier, compute_cost
from app.conversation.prompt_loader import get_prompt
from app.conversation.schemas import AuditOutput
from app.conversation.state import ConversaState
from app.db import acquire

logger = structlog.get_logger(__name__)


async def generate_response(state: ConversaState) -> dict:
    settings = get_settings()
    sintomas_resumo = json.dumps(state.get("sintomas") or {}, ensure_ascii=False)

    # ADR-044 / LGPD categoria especial: NÃO enviar identificador direto do
    # paciente (nome real) junto do conteúdo clínico na mesma chamada ao LLM.
    # O prompt já instrui resposta em 2ª pessoa ("você"); o nome próprio é
    # dispensável e não é mais injetado. `state["nome_paciente"]` permanece no
    # state para outros nós, mas jamais vai para o prompt do gerador.
    system = (await get_prompt("orchestrator", "response_generation")).format(
        sintomas_resumo=sintomas_resumo,
    )

    msgs: list = [SystemMessage(content=system)]
    if state.get("retry_count", 0) > 0 and state.get("audit"):
        msgs.append(
            SystemMessage(
                content=(
                    "Sua resposta anterior foi reprovada na auditoria. "
                    f"Motivo: {state['audit']['motivo']}. "
                    f"Flags: {state['audit']['flags']}. "
                    "Reescreva corrigindo esses pontos."
                )
            )
        )
    msgs.append(HumanMessage(content=state["mensagem"]))

    try:
        response = await sonnet(temperature=0.3).ainvoke(msgs)
    except Exception as exc:  # pragma: no cover
        # Falha do gerador (ex.: Bedrock indisponível). NÃO deixar a exceção
        # subir e morrer silenciosa: degrada graciosamente forçando uma
        # auditoria 'bloquear', o que faz o grafo rotear para
        # `escalate_to_human` e preservar a trilha em `notificacoes_medico`
        # (médico no loop). Loga só `str(exc)` — nunca a mensagem do paciente.
        logger.exception(
            "response.generate.failed",
            retry_count=state.get("retry_count", 0),
            error=str(exc),
        )
        return {
            "resposta_rascunho": "",
            "resposta_final": None,
            "retry_count": state.get("retry_count", 0),
            "audit": {
                "decisao": "bloquear",
                "motivo": "gerador_indisponivel",
                "flags": ["gerador_error"],
            },
        }

    rascunho = (
        response.content if isinstance(response.content, str) else str(response.content)
    ).strip()

    usage = getattr(response, "usage_metadata", None) or {}
    tokens_in = usage.get("input_tokens")
    tokens_out = usage.get("output_tokens")

    provider = LLMProvider(settings.llm_provider)
    modelo = resolve_model_id(provider, ModelTier.SONNET)
    custo_usd = compute_cost(provider, modelo, tokens_in, tokens_out)

    logger.info(
        "response.generate.done",
        retry_count=state.get("retry_count", 0),
        len_chars=len(rascunho),
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        custo_usd=custo_usd,
    )

    return {
        "resposta_rascunho": rascunho,
        "retry_count": state.get("retry_count", 0),
        "modelo_resposta": modelo,
        "tokens_in": tokens_in,
        "tokens_out": tokens_out,
        "custo_usd": custo_usd,
    }


async def audit_response(state: ConversaState) -> dict:
    rascunho = state["resposta_rascunho"]

    # O gerador falhou (rascunho vazio + audit 'bloquear' já forçado). Não há o
    # que auditar; preserva a decisão de bloqueio para o grafo escalar ao médico
    # em vez de rodar o auditor sobre texto vazio (que sobrescreveria o estado).
    if not rascunho.strip():
        audit = state.get("audit") or {
            "decisao": "bloquear",
            "motivo": "gerador_indisponivel",
            "flags": ["gerador_error"],
        }
        logger.warning("audit.skipped_empty_draft", motivo=audit.get("motivo"))
        return {
            "audit": audit,
            "retry_count": state.get("retry_count", 0),
            "resposta_final": None,
        }

    llm = with_schema(haiku(), AuditOutput)

    try:
        result: AuditOutput = await llm.ainvoke(
            [
                SystemMessage(content=await get_prompt("orchestrator", "audit")),
                HumanMessage(content=f"Resposta proposta ao paciente:\n\n{rascunho}"),
            ]
        )
    except Exception as exc:  # pragma: no cover
        logger.exception("audit.failed", error=str(exc))
        return {
            "audit": {
                "decisao": "bloquear",
                "motivo": "auditor_indisponivel",
                "flags": ["auditor_error"],
            }
        }

    logger.info(
        "audit.done", decisao=result.decisao, flags=result.flags, motivo=result.motivo
    )

    # Promove rascunho a `resposta_final` quando aprovado. Para 'reescrever'
    # ou 'bloquear', mantém None — `finalize` vê falta de texto e não persiste.
    promoted = (
        state["resposta_rascunho"] if result.decisao == "enviar" else None
    )

    return {
        "audit": {
            "decisao": result.decisao,
            "motivo": result.motivo,
            "flags": result.flags,
        },
        "retry_count": state.get("retry_count", 0)
        + (1 if result.decisao == "reescrever" else 0),
        "resposta_final": promoted,
    }


async def escalate_to_human(state: ConversaState) -> dict:
    metadata = {
        "motivo": state["audit"]["motivo"],
        "flags": state["audit"]["flags"],
        "retry_count": state.get("retry_count", 0),
        "mensagem_db_id": str(state.get("mensagem_db_id")),
        "rascunho_bloqueado": state.get("resposta_rascunho"),
    }

    async with acquire() as conn, conn.transaction():
        await conn.execute(
            """
            INSERT INTO notificacoes_medico
                (medico_id, paciente_id, severidade, tipo,
                 titulo, mensagem, metadata)
            VALUES ($1, $2, 'alta', 'escalada_auditor', $3, $4, $5::jsonb)
            """,
            state["medico_responsavel_id"],
            state["paciente_id"],
            "Resposta automática bloqueada para revisão",
            (
                f"O auditor automático bloqueou uma resposta gerada para o "
                f"paciente. Motivo: {state['audit']['motivo']}. "
                f"A automação foi escalada para revisão humana."
            ),
            json.dumps(metadata, ensure_ascii=False),
        )
        # Não envia nada ao paciente; também marca conversa pra humano cuidar
        await conn.execute(
            "UPDATE conversas SET status = 'humano' WHERE id = $1",
            state["conversa_id"],
        )

    logger.warning(
        "audit.escalated",
        paciente_id=str(state["paciente_id"]),
        motivo=state["audit"]["motivo"],
    )
    return {"resposta_final": None, "conversa_status": "humano"}
