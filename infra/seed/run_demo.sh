#!/usr/bin/env bash
# =============================================================================
# Cérebro Amigo V3 — Seed de demonstração
# Uso: bash infra/seed/run_demo.sh [--gateway-url URL] [--db-url URL]
#
# Padrão: gateway em localhost:5050, DB via POSTGRES_DSN_URL do .env
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

GATEWAY_URL="${GATEWAY_URL:-http://localhost:5050}"
DB_URL="${POSTGRES_DSN_URL:-}"

# Carrega .env se não tiver POSTGRES_DSN_URL
if [[ -z "$DB_URL" && -f "$ROOT_DIR/.env" ]]; then
  DB_URL="$(grep '^POSTGRES_DSN_URL=' "$ROOT_DIR/.env" | cut -d= -f2-)"
fi

if [[ -z "$DB_URL" ]]; then
  echo "Erro: POSTGRES_DSN_URL não encontrado (.env ou variável de ambiente)."
  exit 1
fi

# ---------------------------------------------------------------------------
# 1. Criar primeiro médico via API (seed endpoint)
# ---------------------------------------------------------------------------
echo ""
echo "=== Passo 1: Criar médico via POST $GATEWAY_URL/api/v1/seed/primeiro-medico ==="
echo ""

MEDICO_RESP=$(curl -sf -X POST "$GATEWAY_URL/api/v1/seed/primeiro-medico" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "demo@cerebroamigo.com",
    "senha": "Demo@2026!",
    "nome": "Dr. Adonai Arinelli",
    "crm": "CRM-SP 123456",
    "waId": null
  }' 2>&1) || {
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
    "$GATEWAY_URL/api/v1/seed/primeiro-medico" \
    -H "Content-Type: application/json" \
    -d '{"email":"demo@cerebroamigo.com","senha":"Demo@2026!","nome":"Dr. Adonai Arinelli","crm":"CRM-SP 123456","waId":null}')
  if [[ "$HTTP_CODE" == "409" ]]; then
    echo "Médico já existe (409 Conflict) — continuando com seed de pacientes."
  else
    echo "Erro ao criar médico (HTTP $HTTP_CODE). Verifique se o gateway está rodando em $GATEWAY_URL."
    exit 1
  fi
}

if [[ -n "$MEDICO_RESP" ]]; then
  echo "Médico criado: $MEDICO_RESP"
fi

# ---------------------------------------------------------------------------
# 2. Rodar SQL de demo via psql
# ---------------------------------------------------------------------------
echo ""
echo "=== Passo 2: Inserir dados demo via psql ==="
echo ""

# psql aceita a URL diretamente
psql "$DB_URL" -f "$SCRIPT_DIR/demo.sql" -v ON_ERROR_STOP=1

echo ""
echo "=== Seed de demonstração concluído! ==="
echo ""
echo "Login: demo@cerebroamigo.com / Demo@2026!"
echo "URL:   $GATEWAY_URL"
