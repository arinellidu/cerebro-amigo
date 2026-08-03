"""Testes do módulo de cifra de aplicação (ADR-018)."""

from __future__ import annotations

import pytest

from app.core.crypto import decrypt, encrypt, is_encrypted

_TEST_KEY = "a" * 64


def test_roundtrip():
    original = "Dado sensível"
    ct = encrypt(original, _TEST_KEY)
    assert is_encrypted(ct)
    assert decrypt(ct, _TEST_KEY) == original


def test_different_nonces():
    ct1 = encrypt("oi", _TEST_KEY)
    ct2 = encrypt("oi", _TEST_KEY)
    assert ct1 != ct2


def test_decrypt_with_wrong_key_fails():
    ct = encrypt("segredo", _TEST_KEY)
    with pytest.raises(Exception):  # noqa: B017
        decrypt(ct, "b" * 64)


def test_legacy_mode():
    original = "plaintext"
    assert encrypt(original, None) == original
    assert decrypt(original, None) == original


def test_decrypt_legacy_plaintext():
    legacy = "texto antigo"
    assert decrypt(legacy, _TEST_KEY) == legacy
    assert not is_encrypted(legacy)
