"""T1-4: SSL verify-full para hosts RDS — dev/CI seguem intactos."""

import ssl
from pathlib import Path
from urllib.parse import parse_qsl, urlsplit

from app.rds_ca import ssl_context_for_dsn, verify_full_dsn

DSN_RDS = "postgresql://u:p@db.abc123.sa-east-1.rds.amazonaws.com:5432/cerebro_v3?sslmode=require"
DSN_LOCAL = "postgresql://t:t@localhost:5432/t"


def test_dsn_local_nao_recebe_contexto():
    assert ssl_context_for_dsn(DSN_LOCAL) is None
    assert ssl_context_for_dsn("postgresql://t:t@postgres:5432/t?sslmode=require") is None


def test_dsn_rds_recebe_verify_full():
    ctx = ssl_context_for_dsn(DSN_RDS)
    assert isinstance(ctx, ssl.SSLContext)
    assert ctx.check_hostname is True
    assert ctx.verify_mode == ssl.CERT_REQUIRED


def test_verify_full_dsn_reescreve_host_rds():
    dsn = verify_full_dsn(DSN_RDS)
    query = dict(parse_qsl(urlsplit(dsn).query))
    assert query["sslmode"] == "verify-full"
    rootcert = Path(query["sslrootcert"])
    assert rootcert.exists()
    assert rootcert.read_text().startswith("-----BEGIN CERTIFICATE-----")


def test_verify_full_dsn_nao_toca_host_local():
    assert verify_full_dsn(DSN_LOCAL) == DSN_LOCAL
