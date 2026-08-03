"""Pool asyncpg compartilhado entre agentes."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import asyncpg
import structlog

from app.core.config import get_settings
from app.core.rds_ca import ssl_context_for_dsn

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
        max_size=6,  # ADR-043 item D: orçamento de conexões (RDS max_connections=181)
        command_timeout=30,
    )
    logger.info("db.pool.ready", min_size=2, max_size=6, ssl_verify_full=ssl_ctx is not None)
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None
        logger.info("db.pool.closed")


def get_pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("DB pool não inicializado")
    return _pool


@asynccontextmanager
async def acquire() -> AsyncIterator[asyncpg.Connection]:
    pool = get_pool()
    async with pool.acquire() as conn:
        yield conn
