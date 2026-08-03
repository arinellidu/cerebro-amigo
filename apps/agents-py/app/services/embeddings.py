"""Embeddings via AWS Bedrock — Cohere Multilingual v3, on-demand IN-REGION (sa-east-1).

Diferente do chat (`core/llm.py`, provider-switchável ADR-015), embedding é
SEMPRE Bedrock, por dois motivos:
  1. Anthropic não expõe API de embedding.
  2. LGPD (regra clínica #4 / ADR-008 / ADR-028) exige inferência no Brasil.
     `cohere.embed-multilingual-v3` roda on-demand em sa-east-1 — sem o inference
     profile `global.*` (que rotearia cross-region e violaria a residência).

`input_type` (exigido pela Cohere):
  - 'search_document'  ao INDEXAR o corpus.
  - 'search_query'     ao BUSCAR (query do médico).
Os dois espaços são treinados p/ casar no mesmo índice.

Saída: vetores de 1024 dimensões (config.embed_dim).
"""

from __future__ import annotations

import asyncio
import json
from typing import Literal

import boto3
import structlog
from botocore.config import Config

from app.core.config import get_settings

logger = structlog.get_logger(__name__)

InputType = Literal["search_document", "search_query"]

_COHERE_MAX_BATCH = 96  # limite de textos por chamada da API Cohere embed
_client = None  # cache do client boto3


class EmbeddingsDisabledError(RuntimeError):
    """EMBEDDINGS_ENABLED=false — busca/indexação semântica indisponível."""


def _bedrock_runtime():
    global _client
    if _client is None:
        s = get_settings()
        _client = boto3.client(
            "bedrock-runtime",
            region_name=s.bedrock_region,
            # standard mode faz backoff exponencial em ThrottlingException.
            config=Config(retries={"max_attempts": 5, "mode": "standard"}),
        )
    return _client


def _invoke_cohere(texts: list[str], input_type: InputType) -> list[list[float]]:
    """Chamada SÍNCRONA a um batch (<= 96 textos). Roda em thread via `embed_texts`."""
    s = get_settings()
    body = json.dumps(
        {
            "texts": texts,
            "input_type": input_type,
            "truncate": "END",  # trunca texto longo no fim em vez de estourar erro
            "embedding_types": ["float"],
        }
    )
    resp = _bedrock_runtime().invoke_model(
        modelId=s.bedrock_embed_model,
        contentType="application/json",
        accept="application/json",
        body=body,
    )
    payload = json.loads(resp["body"].read())
    emb = payload.get("embeddings")
    # com embedding_types → {"embeddings": {"float": [[...]]}}; legado → {"embeddings": [[...]]}
    if isinstance(emb, dict):
        return emb["float"]
    return emb


async def embed_texts(
    texts: list[str], *, input_type: InputType
) -> list[list[float]]:
    """Gera embeddings (1024-dim) para uma lista de textos, preservando a ordem.

    Batcheia em grupos de 96 (limite Cohere); boto3 é síncrono, então roda em
    thread p/ não travar o event loop. NUNCA loga `texts` — é PII clínica
    (regra #4); só metadados (contagem/dimensão).
    """
    s = get_settings()
    if not s.embeddings_enabled:
        raise EmbeddingsDisabledError(
            "EMBEDDINGS_ENABLED=false — habilite e configure credenciais AWS (IAM role)."
        )
    if not texts:
        return []

    out: list[list[float]] = []
    for i in range(0, len(texts), _COHERE_MAX_BATCH):
        batch = texts[i : i + _COHERE_MAX_BATCH]
        vecs = await asyncio.to_thread(_invoke_cohere, batch, input_type)
        out.extend(vecs)

    logger.info(
        "embeddings.generated",
        n=len(out),
        dim=len(out[0]) if out else 0,
        input_type=input_type,
        model=s.bedrock_embed_model,
    )
    return out


async def embed_one(text: str, *, input_type: InputType) -> list[float]:
    """Conveniência p/ um único texto (ex.: a query da busca)."""
    vecs = await embed_texts([text], input_type=input_type)
    return vecs[0]


def to_pgvector(vec: list[float]) -> str:
    """Serializa p/ literal pgvector ('[v1,v2,...]'), bindável com `$n::vector`.

    Evita registrar um codec asyncpg para o tipo `vector`.
    """
    return "[" + ",".join(repr(float(x)) for x in vec) + "]"


def estimar_tokens(texto: str) -> int:
    """Estimativa grosseira de tokens (~4 chars/token) p/ telemetria de custo.

    Custo é telemetria — nunca deve quebrar o caminho clínico (ver pricing.py).
    """
    return max(1, len(texto) // 4)
