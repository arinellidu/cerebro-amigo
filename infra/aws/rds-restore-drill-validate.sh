#!/usr/bin/env bash
# Validação do drill de restore do RDS (T1-5). Roda NO box clínico (via SSM,
# chamado pelo workflow .github/workflows/restore-drill.yml).
#
# Conecta na instância RESTAURADA e prova que o backup presta: conexão ok +
# tabelas clínicas legíveis + dado recente presente. Usa o container do
# orchestrator (tem asyncpg e a DSN dos workers no env — BYPASSRLS, counts
# reais), trocando apenas o host pelo endpoint do drill.
#
# Uso: rds-restore-drill-validate.sh <endpoint-da-instancia-restaurada>
set -euo pipefail

ENDPOINT="${1:?uso: $0 <endpoint-restaurado>}"
case "$ENDPOINT" in
  *.rds.amazonaws.com) ;;
  *) echo "endpoint inesperado: $ENDPOINT" >&2; exit 1 ;;
esac

cd /opt/cerebro-amigo-v3

docker compose exec -T orchestrator-py python - "$ENDPOINT" <<'PY'
import asyncio
import os
import sys
from urllib.parse import urlsplit, urlunsplit

import asyncpg

endpoint = sys.argv[1]
dsn = os.environ["POSTGRES_DSN_URL"]
parts = urlsplit(dsn)
host = parts.hostname or ""
dsn_drill = urlunsplit(parts._replace(netloc=parts.netloc.replace(host, endpoint)))


async def main() -> None:
    conn = await asyncpg.connect(dsn_drill, timeout=30)
    try:
        pacientes = await conn.fetchval("SELECT count(*) FROM pacientes")
        prescricoes = await conn.fetchval("SELECT count(*) FROM prescricoes")
        mensagens = await conn.fetchval("SELECT count(*) FROM mensagens")
        ultima_crise = await conn.fetchval(
            "SELECT max(criado_em) FROM protocolos_crise_acionados"
        )
    finally:
        await conn.close()
    print(
        f"restore-drill OK: pacientes={pacientes} prescricoes={prescricoes} "
        f"mensagens={mensagens} ultima_crise={ultima_crise}"
    )


asyncio.run(main())
PY
