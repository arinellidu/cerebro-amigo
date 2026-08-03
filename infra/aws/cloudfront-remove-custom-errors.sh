#!/usr/bin/env bash
# Remove os CustomErrorResponses da distribution do checkup (EIGK9ET6L19TE).
# Eram nocivos num app SSR (Next já serve /404 + erros com status certo):
#   - 404->/404, 500/503->/500 mascaravam erro JSON de /api/* com página HTML;
#   - /500 não existe no Next → 500/503 cascateavam p/ 404 (ex.: retention sem token
#     virava 404 em vez de 503).
# Depois disto: /api/* devolve erro JSON real; páginas 404 do usuário seguem iguais
# (origin serve a not-found do Next). Idempotente. Requer aws cli + jq.
set -euo pipefail

DIST_ID="${1:-EIGK9ET6L19TE}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "→ get-distribution-config ($DIST_ID)"
aws cloudfront get-distribution-config --id "$DIST_ID" --output json > "$TMP/full.json"
ETAG="$(jq -r '.ETag' "$TMP/full.json")"

QTY="$(jq -r '.DistributionConfig.CustomErrorResponses.Quantity' "$TMP/full.json")"
if [ "$QTY" = "0" ]; then
  echo "✓ já sem CustomErrorResponses — nada a fazer."
  exit 0
fi
echo "  CustomErrorResponses atuais: $QTY"

jq '.DistributionConfig.CustomErrorResponses = {"Quantity": 0, "Items": []}' \
  "$TMP/full.json" | jq '.DistributionConfig' > "$TMP/config.json"

echo "→ update-distribution (if-match $ETAG)"
aws cloudfront update-distribution \
  --id "$DIST_ID" \
  --if-match "$ETAG" \
  --distribution-config "file://$TMP/config.json" \
  --query 'Distribution.Status' --output text

echo "✓ aplicado. Propaga ~5-15 min. Validar depois:"
echo "  curl -s -o /dev/null -w '%{http_code}\\n' -X POST https://checkup.cerebroamigo.com.br/api/tracking/retention  # espera 503 (sem token), não 404"
echo "  curl -s -o /dev/null -w '%{http_code}\\n' https://checkup.cerebroamigo.com.br/naoexiste              # 404 (página do Next, igual)"
