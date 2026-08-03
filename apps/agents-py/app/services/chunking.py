"""Chunking de texto p/ indexação RAG (ADR-028).

Registros clínicos costumam ser curtos (uma entrada de diário, uma nota de
sintoma) e cabem num único chunk. Textos longos quebram em janelas de ~max_chars
com sobreposição, preferindo cortar em fronteira de espaço (não no meio da palavra).
"""

from __future__ import annotations

import hashlib


def hash_fonte(texto: str) -> str:
    """SHA-256 do texto-fonte — chave de reindex incremental (fonte inalterada
    ⇒ não re-embeda)."""
    return hashlib.sha256(texto.encode("utf-8")).hexdigest()


def chunk_text(texto: str, *, max_chars: int, overlap: int) -> list[str]:
    """Divide `texto` em chunks de até `max_chars` com `overlap` de sobreposição."""
    texto = (texto or "").strip()
    if not texto:
        return []
    if len(texto) <= max_chars:
        return [texto]

    chunks: list[str] = []
    start = 0
    n = len(texto)
    while start < n:
        end = min(start + max_chars, n)
        if end < n:
            corte = texto.rfind(" ", start, end)
            if corte > start:
                end = corte
        trecho = texto[start:end].strip()
        if trecho:
            chunks.append(trecho)
        if end >= n:
            break
        start = max(end - overlap, start + 1)
    return chunks
