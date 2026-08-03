"""Azure Blob — download/delete do áudio efêmero do escriba presencial (ADR-082).

O browser sobe o áudio via SAS (assinada pelo gateway); aqui só baixamos para
transcrever e DELETAMOS em seguida (LGPD — o áudio nunca persiste além do
ciclo de transcrição). Lifecycle de 1 dia no container é a rede de segurança.

Funções síncronas (SDK oficial) — chamar via asyncio.to_thread.
"""

from __future__ import annotations

from azure.core.exceptions import ResourceNotFoundError
from azure.storage.blob import BlobClient


def _blob_client(key: str, settings) -> BlobClient:
    conn = settings.azure_storage_connection_string
    if conn is None:
        raise RuntimeError(
            "AZURE_STORAGE_CONNECTION_STRING ausente — storage de áudio indisponível."
        )
    return BlobClient.from_connection_string(
        conn.get_secret_value(),
        container_name=settings.blob_container_audio,
        blob_name=key,
    )


def download_blob(key: str, settings) -> bytes:
    return _blob_client(key, settings).download_blob().readall()


def delete_blob(key: str, settings) -> None:
    """Idempotente (como o DELETE do S3 era): blob já ausente não é erro —
    o finally do pipeline não pode mascarar a exceção original."""
    try:
        _blob_client(key, settings).delete_blob()
    except ResourceNotFoundError:
        pass
