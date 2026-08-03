"""Indexador RAG (ADR-028) — popula `conhecimento` com embeddings do corpus.

Dois alvos, ambos doctor-facing e retrieval-only:

  A — base de conhecimento: catálogo `medicamentos` (referência NÃO-PII), sob o
      tenant SENTINELA global. `conteudo` em plaintext (não é dado sensível).
  B — prontuário por paciente: fala do paciente (`mensagens.papel='user'`), diário
      COMPARTILHADO, notas de sintoma/evento/consulta. tenant_id =
      `medico_responsavel_id`. Texto clínico é SENSÍVEL (ADR-018): guarda-se só o
      vetor + ponteiro (`conteudo` NULL); o texto é re-buscado e decifrado no read
      (retrieval.py).

Guardas (clinical-safety):
  - NUNCA indexa `mensagens.papel='assistant'` — não ressurgir texto de IA como fato.
  - Só indexa `diario_entradas` com `compartilhada_com_medico = TRUE` (consentimento
    do paciente; minimização LGPD #4).
  - Reindex incremental por `fonte_hash`: fonte inalterada não é re-embeddada.
  - `conhecimento` NÃO é trilha de auditoria — reindex pode DELETE/INSERT nela. O
    indexador jamais toca protocolos_crise_acionados/notificacoes_medico/agente_execucoes.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from uuid import UUID

import structlog

from app.core import crypto
from app.core.config import get_settings
from app.core.db import acquire
from app.core.pricing import compute_embedding_cost
from app.jobs.base import BaseJob
from app.services.chunking import chunk_text, hash_fonte
from app.services.embeddings import embed_texts, estimar_tokens, to_pgvector

logger = structlog.get_logger(__name__)

# Tenant sentinela p/ a KB global (referência não-PII). SÓ dado não-PII pode usá-lo.
SENTINEL_TENANT = UUID("00000000-0000-0000-0000-000000000000")


@dataclass
class _Pendente:
    """Um chunk pronto p/ embeddar + inserir."""

    fonte_tipo: str
    fonte_id: UUID
    chunk_idx: int
    texto: str
    metadata: dict
    fonte_hash: str
    sensivel: bool  # True ⇒ conteudo NULL (pointer-only, ADR-018)


def _enc_key() -> str | None:
    s = get_settings()
    return s.encryption_key.get_secret_value() if s.encryption_key else None


class IndexadorRagJob(BaseJob):
    """Reindexação incremental do corpus RAG (KB global + prontuários)."""

    name = "indexador_rag"

    # ─── ciclo agendado ────────────────────────────────────────────────────

    async def run_once(self) -> dict[str, Any]:
        s = get_settings()
        if not s.embeddings_enabled:
            logger.info("indexador_rag.skip", motivo="EMBEDDINGS_ENABLED=false")
            return {"skipped": True}

        stats: dict[str, Any] = {
            "kb_chunks": 0,
            "pacientes_tocados": 0,
            "chunks": 0,
            "fontes_reindexadas": 0,
        }
        sucesso = True
        erro: str | None = None
        try:
            async with acquire() as conn:
                kb = await self._index_kb(conn)
                stats["kb_chunks"] = kb["chunks"]
                stats["fontes_reindexadas"] += kb["fontes"]

                pacientes = await conn.fetch(
                    "SELECT cliente_id, medico_responsavel_id FROM pacientes"
                )
                for row in pacientes:
                    try:
                        r = await self._index_paciente(
                            conn, row["medico_responsavel_id"], row["cliente_id"]
                        )
                    except Exception as exc:  # isola falha por paciente
                        logger.warning(
                            "indexador_rag.paciente_falhou",
                            paciente_id=str(row["cliente_id"]),
                            error=str(exc),
                        )
                        continue
                    stats["chunks"] += r["chunks"]
                    stats["fontes_reindexadas"] += r["fontes"]
                    if r["chunks"]:
                        stats["pacientes_tocados"] += 1
        except Exception as exc:
            sucesso = False
            erro = str(exc)
            logger.exception("indexador_rag.failed", error=erro)

        await self._audit_execucao(stats, sucesso, erro)
        return stats

    # ─── alvo A: catálogo de medicamentos (KB global) ──────────────────────

    async def _index_kb(self, conn) -> dict[str, int]:
        rows = await conn.fetch(
            "SELECT id, nome_generico, nome_comercial, classe_terapeutica, "
            "indicacoes_resumo, observacoes, dosagens "
            "FROM medicamentos WHERE ativo = TRUE"
        )
        desejado: dict[tuple[str, UUID], tuple[str, str, dict]] = {}
        for r in rows:
            texto = self._texto_medicamento(r)
            if not texto:
                continue
            desejado[("medicamento", r["id"])] = (
                texto,
                hash_fonte(texto),
                {"fonte": "medicamento", "nome": r["nome_generico"]},
            )
        # KB não é PII → conteudo em plaintext (sensivel=False).
        return await self._reconciliar(
            conn, SENTINEL_TENANT, None, desejado, sensivel=False
        )

    @staticmethod
    def _texto_medicamento(r) -> str:
        partes = [r["nome_generico"]]
        if r["nome_comercial"]:
            partes.append(f"({r['nome_comercial']})")
        partes.append(f"— classe: {r['classe_terapeutica']}.")
        if r["indicacoes_resumo"]:
            partes.append(f"Indicações: {r['indicacoes_resumo']}.")
        if r["dosagens"]:
            partes.append(f"Dosagens: {', '.join(r['dosagens'])}.")
        if r["observacoes"]:
            partes.append(r["observacoes"])
        return " ".join(p for p in partes if p).strip()

    # ─── alvo B: prontuário de um paciente ─────────────────────────────────

    async def _index_paciente(self, conn, medico_id: UUID, paciente_id: UUID) -> dict[str, int]:
        key = _enc_key()
        desejado: dict[tuple[str, UUID], tuple[str, str, dict]] = {}
        for tipo, fid, raw, meta in await self._coletar_fontes_paciente(conn, paciente_id, key):
            plain = crypto.decrypt(raw, key).strip() if raw else ""
            if not plain:
                continue
            desejado[(tipo, fid)] = (plain, hash_fonte(plain), meta)
        # Prontuário é sensível ⇒ pointer-only (conteudo NULL).
        return await self._reconciliar(
            conn, medico_id, paciente_id, desejado, sensivel=True
        )

    @staticmethod
    async def _coletar_fontes_paciente(conn, paciente_id: UUID, key: str | None):
        """Coleta (fonte_tipo, fonte_id, texto_cru, metadata) das fontes do paciente.

        `paciente_id` = clientes.id. Mensagens ligam ao paciente via conversas.

        `key`: chave de cifragem (ADR-018). Necessária aqui SÓ para o diário, cujos
        campos `titulo`/`conteudo` são cifrados SEPARADAMENTE — a concatenação tem
        de ser feita sobre os PLAINTEXTS, senão o decrypt único downstream quebra.
        As demais fontes seguem CRUAS (decifradas em `_index_paciente`).
        """
        fontes: list[tuple[str, UUID, str, dict]] = []

        # Fala do paciente (NUNCA papel='assistant').
        for r in await conn.fetch(
            "SELECT m.id, m.conteudo, m.criada_em "
            "FROM mensagens m JOIN conversas c ON c.id = m.conversa_id "
            "WHERE c.cliente_id = $1 AND m.papel = 'user'",
            paciente_id,
        ):
            fontes.append(("mensagem", r["id"], r["conteudo"],
                           {"fonte": "mensagem", "data": r["criada_em"].isoformat()}))

        # Diário — só o que o paciente COMPARTILHOU com o médico (consentimento).
        # titulo/conteudo são cifrados SEPARADAMENTE (ADR-018): decifra cada um e
        # junta os PLAINTEXTS. O `crypto.decrypt` downstream vira no-op inofensivo.
        for r in await conn.fetch(
            "SELECT id, titulo, conteudo, criada_em FROM diario_entradas "
            "WHERE paciente_id = $1 AND compartilhada_com_medico = TRUE",
            paciente_id,
        ):
            titulo = crypto.decrypt(r["titulo"], key) if r["titulo"] else r["titulo"]
            conteudo = crypto.decrypt(r["conteudo"], key) if r["conteudo"] else r["conteudo"]
            texto = "\n".join(p for p in [titulo, conteudo] if p)
            fontes.append(("diario", r["id"], texto,
                           {"fonte": "diario", "data": r["criada_em"].isoformat()}))

        # Notas de sintoma.
        for r in await conn.fetch(
            "SELECT id, nota, registrado_em FROM sintomas "
            "WHERE paciente_id = $1 AND nota IS NOT NULL AND nota <> ''",
            paciente_id,
        ):
            fontes.append(("sintoma", r["id"], r["nota"],
                           {"fonte": "sintoma", "data": r["registrado_em"].isoformat()}))

        # Eventos relatados.
        for r in await conn.fetch(
            "SELECT id, titulo, descricao, criado_em FROM eventos WHERE paciente_id = $1",
            paciente_id,
        ):
            texto = "\n".join(p for p in [r["titulo"], r["descricao"]] if p)
            fontes.append(("evento", r["id"], texto,
                           {"fonte": "evento", "data": r["criado_em"].isoformat()}))

        # Notas de consulta (do médico).
        for r in await conn.fetch(
            "SELECT id, notas, inicia_em FROM consultas "
            "WHERE paciente_id = $1 AND notas IS NOT NULL AND notas <> ''",
            paciente_id,
        ):
            fontes.append(("consulta", r["id"], r["notas"],
                           {"fonte": "consulta", "data": r["inicia_em"].isoformat()}))

        return fontes

    # ─── reconciliação incremental + escrita ───────────────────────────────

    async def _reconciliar(
        self,
        conn,
        tenant_id: UUID,
        paciente_id: UUID | None,
        desejado: dict[tuple[str, UUID], tuple[str, str, dict]],
        *,
        sensivel: bool,
    ) -> dict[str, int]:
        """Compara o estado desejado com o indexado e aplica só o delta.

        `IS NOT DISTINCT FROM` casa o escopo NULL (KB) e não-NULL (paciente) numa
        query só. Fonte com hash igual ⇒ pulada (sem re-embed). Fonte sumida do
        corpus ⇒ chunks removidos.
        """
        s = get_settings()
        existing = await conn.fetch(
            "SELECT fonte_tipo, fonte_id, fonte_hash FROM conhecimento "
            "WHERE tenant_id = $1 AND paciente_id IS NOT DISTINCT FROM $2",
            tenant_id, paciente_id,
        )
        existing_hash = {(r["fonte_tipo"], r["fonte_id"]): r["fonte_hash"] for r in existing}

        pendentes: list[_Pendente] = []
        a_deletar: list[tuple[str, UUID]] = []
        fontes_reindex = 0

        for (tipo, fid), (plain, h, meta) in desejado.items():
            if existing_hash.get((tipo, fid)) == h:
                continue  # inalterado
            a_deletar.append((tipo, fid))  # limpa versão antiga (se houver)
            for i, ch in enumerate(
                chunk_text(plain, max_chars=s.rag_chunk_max_chars,
                           overlap=s.rag_chunk_overlap_chars)
            ):
                pendentes.append(_Pendente(tipo, fid, i, ch, meta, h, sensivel))
            fontes_reindex += 1

        # Fontes que sumiram do corpus (presentes no índice, ausentes agora).
        for tipo, fid in existing_hash:
            if (tipo, fid) not in desejado:
                a_deletar.append((tipo, fid))

        for tipo, fid in a_deletar:
            await conn.execute(
                "DELETE FROM conhecimento WHERE tenant_id = $1 "
                "AND paciente_id IS NOT DISTINCT FROM $2 AND fonte_tipo = $3 AND fonte_id = $4",
                tenant_id, paciente_id, tipo, fid,
            )

        chunks = await self._embed_insert(conn, tenant_id, paciente_id, pendentes)
        return {"chunks": chunks, "fontes": fontes_reindex}

    @staticmethod
    async def _embed_insert(
        conn, tenant_id: UUID, paciente_id: UUID | None, pendentes: list[_Pendente]
    ) -> int:
        if not pendentes:
            return 0
        s = get_settings()
        vecs = await embed_texts([p.texto for p in pendentes], input_type="search_document")

        rows = [
            (
                tenant_id,
                paciente_id,
                None if p.sensivel else p.texto,   # pointer-only p/ fonte sensível
                to_pgvector(v),
                p.fonte_tipo,
                p.fonte_id,
                p.chunk_idx,
                json.dumps(p.metadata),
                s.bedrock_embed_model,
                p.fonte_hash,
            )
            for p, v in zip(pendentes, vecs, strict=True)
        ]
        await conn.executemany(
            "INSERT INTO conhecimento "
            "(tenant_id, paciente_id, conteudo, embedding, fonte_tipo, fonte_id, "
            " chunk_idx, metadata, modelo_embed, fonte_hash, atualizado_em) "
            "VALUES ($1, $2, $3, $4::vector, $5, $6, $7, $8::jsonb, $9, $10, NOW())",
            rows,
        )

        # Telemetria de custo — só metadados, NUNCA o texto (PII, regra #4).
        tokens = sum(estimar_tokens(p.texto) for p in pendentes)
        logger.info(
            "indexador_rag.embedded",
            n=len(pendentes),
            tokens_estimados=tokens,
            custo_usd=compute_embedding_cost(s.bedrock_embed_model, tokens),
        )
        return len(pendentes)


# ─── disparo on-demand (endpoints HTTP) ────────────────────────────────────

async def reindexar_kb() -> dict[str, int]:
    """Reindexa o catálogo de medicamentos (KB global)."""
    async with acquire() as conn:
        return await IndexadorRagJob()._index_kb(conn)


async def reindexar_paciente(paciente_id: UUID) -> dict[str, int]:
    """Reindexa o prontuário de um paciente. Deriva o tenant (médico) do paciente."""
    job = IndexadorRagJob()
    async with acquire() as conn:
        medico_id = await conn.fetchval(
            "SELECT medico_responsavel_id FROM pacientes WHERE cliente_id = $1",
            paciente_id,
        )
        if medico_id is None:
            raise ValueError("paciente sem medico_responsavel_id")
        return await job._index_paciente(conn, medico_id, paciente_id)
