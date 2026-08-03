#!/usr/bin/env python3
"""Migração one-off: cifra dados legados de mensagens.conteudo (ADR-018 Fase 1).

Deve ser executado OFF-LINE (fora do fluxo de aplicação), com o serviço parado
ou em modo de manutenção, para evitar race conditions.

Uso:
    export ENCRYPTION_KEY=$(openssl rand -hex 32)
    cd apps/orchestrator-py
    python3 ../../infra/scripts/migrate_mensagens_cifra.py

O script:
  1. Varre mensagens onde conteudo NÃO começa com 'v1:' (dado legado).
  2. Cifra cada conteúdo com app.core.crypto.encrypt().
  3. Atualiza a linha com UPDATE (transação por lote).
  4. Gera relatório: total, cifrados, já-cifrados, erros.

Segurança:
  - Não loga o conteúdo das mensagens (PII clínica).
  - Loga apenas IDs e contadores.
  - Rollback automático em caso de erro (transação por lote).
"""

from __future__ import annotations

import asyncio
import os
import sys

# Adiciona o orchestrator-py ao path para importar app.core.crypto
_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
_PROJECT_ROOT = os.path.join(_SCRIPT_DIR, "..")
_ORCHESTRATOR = os.path.join(_PROJECT_ROOT, "apps", "orchestrator-py")
sys.path.insert(0, _ORCHESTRATOR)

from app.core.crypto import encrypt  # noqa: E402


# Precisamos do asyncpg — carregamos diretamente para não depender de app.db
import asyncpg  # noqa: E402


BATCH_SIZE = 200


async def _run(dsn: str, key: str) -> None:
    pool = await asyncpg.create_pool(dsn, min_size=1, max_size=2)
    assert pool is not None

    total = 0
    cifrados = 0
    ja_cifrados = 0
    erros = 0

    try:
        async with pool.acquire() as conn:
            # Conta total
            total = await conn.fetchval(
                "SELECT COUNT(*) FROM mensagens"
            ) or 0
            ja_cifrados = await conn.fetchval(
                "SELECT COUNT(*) FROM mensagens WHERE conteudo LIKE 'v1:%'"
            ) or 0
            print(f"Total mensagens: {total} | Já cifrados: {ja_cifrados} | Pendentes: {total - ja_cifrados}")

            if ja_cifrados == total:
                print("Nada a fazer — todas as mensagens já estão cifradas.")
                return

            offset = 0
            while True:
                rows = await conn.fetch(
                    """
                    SELECT id, conteudo FROM mensagens
                    WHERE conteudo NOT LIKE 'v1:%'
                    ORDER BY id
                    LIMIT $1 OFFSET $2
                    """,
                    BATCH_SIZE,
                    offset,
                )
                if not rows:
                    break

                async with conn.transaction():
                    for row in rows:
                        try:
                            ct = encrypt(row["conteudo"], key)
                            await conn.execute(
                                "UPDATE mensagens SET conteudo = $1 WHERE id = $2",
                                ct,
                                row["id"],
                            )
                            cifrados += 1
                        except Exception as exc:
                            print(f"ERRO id={row['id']}: {exc}", file=sys.stderr)
                            erros += 1

                offset += BATCH_SIZE
                print(f"  Batch processado: {cifrados} cifrados, {erros} erros")

    finally:
        await pool.close()

    print("\n=== RESUMO ===")
    print(f"Total mensagens:     {total}")
    print(f"Já cifrados:         {ja_cifrados}")
    print(f"Cifrados agora:      {cifrados}")
    print(f"Erros:               {erros}")
    print(f"Restam plaintext:    {total - ja_cifrados - cifrados}")


if __name__ == "__main__":
    dsn = os.environ.get("POSTGRES_DSN_URL")
    if not dsn:
        print("Erro: defina POSTGRES_DSN_URL", file=sys.stderr)
        sys.exit(1)

    key = os.environ.get("ENCRYPTION_KEY")
    if not key:
        print("Erro: defina ENCRYPTION_KEY", file=sys.stderr)
        sys.exit(1)

    asyncio.run(_run(dsn, key))
