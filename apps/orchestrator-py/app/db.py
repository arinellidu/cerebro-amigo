"""Acesso ao Postgres.

Duas conexões distintas:

* `pool` (asyncpg)  → queries de domínio (pacientes, prescrições, sintomas...).
* `checkpoint_dsn`  → DSN passada ao LangGraph AsyncPostgresSaver. Usa o driver
  psycopg3 sob o capô e gerencia o próprio pool.

Por que dois drivers? O checkpointer oficial do LangGraph para Postgres usa
psycopg3. Para o resto do projeto asyncpg é mais ergonômico e performático.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import asyncpg
import structlog

from app.config import get_settings
from app.rds_ca import ssl_context_for_dsn, verify_full_dsn

logger = structlog.get_logger(__name__)

_pool: asyncpg.Pool | None = None


async def init_pool() -> asyncpg.Pool:
    global _pool
    if _pool is not None:
        return _pool

    settings = get_settings()
    dsn = settings.postgres_dsn.get_secret_value()
    # T1-4: hosts RDS conectam com SSL verify-full (CA regional + hostname).
    ssl_ctx = ssl_context_for_dsn(dsn)
    _pool = await asyncpg.create_pool(
        dsn=dsn,
        ssl=ssl_ctx,
        min_size=2,
        max_size=12,  # ADR-043 item D: orçamento de conexões (RDS max_connections=181)
        command_timeout=15,
    )
    logger.info("db.pool.ready", min_size=2, max_size=12, ssl_verify_full=ssl_ctx is not None)
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None
        logger.info("db.pool.closed")


def get_pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("DB pool não inicializado. Chame init_pool() no startup.")
    return _pool


@asynccontextmanager
async def acquire() -> AsyncIterator[asyncpg.Connection]:
    pool = get_pool()
    async with pool.acquire() as conn:
        yield conn


def checkpoint_dsn() -> str:
    """DSN para AsyncPostgresSaver do LangGraph (driver psycopg3).

    Hosts RDS sobem para sslmode=verify-full + sslrootcert (T1-4).
    """
    return verify_full_dsn(get_settings().postgres_dsn.get_secret_value())
