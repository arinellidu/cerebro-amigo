"""Cifra de aplicação para dados clínicos — ADR-018.

AES-256-GCM com nonce aleatório de 12 bytes por mensagem.
Formato do ciphertext: base64(nonce || tag || ciphertext), prefixado com "v1:".

Modo legacy: se ENCRYPTION_KEY não estiver definida, encrypt/decrypt são
no-op (retornam plaintext). Isso permite deploy gradual sem quebrar
instalações existentes.
"""

from __future__ import annotations

import base64
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

_VERSION_PREFIX = "v1:"
_NONCE_LEN = 12
_KEY_LEN = 32


def _derive_key(raw: str) -> bytes:
    """Deriva 32 bytes de uma string arbitrária via SHA-256.

    Não é um KDF formal (PBKDF2/Argon2), mas suficiente porque a entrada
    já deve ser uma chave aleatória de 32 bytes hex (ex.: openssl rand -hex 32).
    O hash apenas normaliza o tamanho.
    """
    import hashlib
    return hashlib.sha256(raw.encode()).digest()


def encrypt(plaintext: str, key: str | None) -> str:
    """Cifra plaintext com AES-256-GCM. Retorna string no formato v1:<base64>.

    Se key for None ou vazia, retorna plaintext sem alteração (modo legacy).
    """
    if not key:
        return plaintext

    key_bytes = _derive_key(key)
    nonce = os.urandom(_NONCE_LEN)
    aesgcm = AESGCM(key_bytes)
    ciphertext = aesgcm.encrypt(nonce, plaintext.encode("utf-8"), None)
    # ciphertext inclui a tag de 16 bytes no final (AES-GCM padrão da lib)
    payload = nonce + ciphertext
    return _VERSION_PREFIX + base64.b64encode(payload).decode("ascii")


def decrypt(ciphertext: str, key: str | None) -> str:
    """Decifra ciphertext no formato v1:<base64>.

    Se key for None ou vazia, retorna ciphertext sem alteração (modo legacy).
    Se ciphertext não começar com "v1:", assume plaintext legado e retorna
    sem alteração.
    """
    if not key:
        return ciphertext

    if not ciphertext.startswith(_VERSION_PREFIX):
        # Dado legado (plaintext) — backward compatibility
        return ciphertext

    payload = base64.b64decode(ciphertext[len(_VERSION_PREFIX):].encode("ascii"))
    nonce = payload[:_NONCE_LEN]
    encrypted = payload[_NONCE_LEN:]

    key_bytes = _derive_key(key)
    aesgcm = AESGCM(key_bytes)
    plaintext = aesgcm.decrypt(nonce, encrypted, None)
    return plaintext.decode("utf-8")


def is_encrypted(value: str) -> bool:
    """True se o valor parece estar no formato cifrado v1."""
    return value.startswith(_VERSION_PREFIX)
