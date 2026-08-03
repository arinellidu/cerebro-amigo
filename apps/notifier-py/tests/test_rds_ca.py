"""T1-4: SSL verify-full para hosts RDS — dev/CI seguem intactos."""

import ssl

from app.core.rds_ca import ssl_context_for_dsn

DSN_RDS = "postgresql://u:p@db.abc123.sa-east-1.rds.amazonaws.com:5432/cerebro_v3?sslmode=require"


def test_dsn_local_nao_recebe_contexto():
    assert ssl_context_for_dsn("postgresql://t:t@localhost:5432/t") is None
    assert ssl_context_for_dsn("postgresql://t:t@postgres:5432/t?sslmode=require") is None


def test_dsn_rds_recebe_verify_full():
    ctx = ssl_context_for_dsn(DSN_RDS)
    assert isinstance(ctx, ssl.SSLContext)
    assert ctx.check_hostname is True
    assert ctx.verify_mode == ssl.CERT_REQUIRED
