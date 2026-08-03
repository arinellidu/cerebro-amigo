"""Testes do módulo de cifra de aplicação (ADR-018).

AES-256-GCM com backward compatibility para dados legados (plaintext).
"""

from __future__ import annotations

import pytest

from app.core.crypto import decrypt, encrypt, is_encrypted

_TEST_KEY = "a" * 64  # 64 hex chars = 32 bytes


def test_roundtrip():
    original = "Mensagem sensível do paciente"
    ct = encrypt(original, _TEST_KEY)
    assert is_encrypted(ct)
    assert ct != original
    assert decrypt(ct, _TEST_KEY) == original


def test_different_nonces_produce_different_ciphertexts():
    """Nonce aleatório garante que cifrar o mesmo plaintext 2x gera resultados
    diferentes (protege contra análise de padrão)."""
    ct1 = encrypt("oi", _TEST_KEY)
    ct2 = encrypt("oi", _TEST_KEY)
    assert ct1 != ct2
    assert is_encrypted(ct1)
    assert is_encrypted(ct2)


def test_decrypt_with_wrong_key_fails():
    ct = encrypt("segredo", _TEST_KEY)
    with pytest.raises(Exception):  # noqa: B017 — qualquer erro criptográfico é válido
        decrypt(ct, "b" * 64)


def test_legacy_mode_no_key_returns_plaintext():
    """Sem chave, encrypt/decrypt são no-op (modo legacy)."""
    original = "plaintext"
    assert encrypt(original, None) == original
    assert encrypt(original, "") == original
    assert decrypt(original, None) == original
    assert decrypt(original, "") == original


def test_decrypt_legacy_plaintext():
    """Dados legados (não cifrados) são passados através sem alteração."""
    legacy = "texto antigo no banco"
    assert decrypt(legacy, _TEST_KEY) == legacy
    assert not is_encrypted(legacy)


def test_unicode_roundtrip():
    original = "Paciente relata: 😢 ansiedade + insônia — CPF 123.456.789-00"
    ct = encrypt(original, _TEST_KEY)
    assert decrypt(ct, _TEST_KEY) == original
