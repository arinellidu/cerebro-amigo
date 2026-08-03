#!/usr/bin/env bash
# Fix do CloudFront do checkup: /api/* só aceitava GET/HEAD → todo POST dava 403
# (events, devolutiva, email-report e o tracking da ADR-050 Parte 2). Este script
# habilita os 7 métodos no behavior /api/* (cache segue CachingDisabled; OriginRequest
# segue AllViewer → Authorization e body chegam ao ALB). Idempotente.
#
# Distribution: EIGK9ET6L19TE (checkup.cerebroamigo.com.br). Requer aws cli + jq.
# A fonte (infra/aws/cloudfront-checkup.yaml) já foi corrigida; este script aplica no
# recurso vivo sem esperar um redeploy completo do stack.
set -euo pipefail

DIST_ID="${1:-EIGK9ET6L19TE}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "→ get-distribution-config ($DIST_ID)"
aws cloudfront get-distribution-config --id "$DIST_ID" --output json > "$TMP/full.json"
ETAG="$(jq -r '.ETag' "$TMP/full.json")"

# já corrigido?
CUR="$(jq -r '.DistributionConfig.CacheBehaviors.Items[] | select(.PathPattern=="/api/*") | .AllowedMethods.Items | sort | join(",")' "$TMP/full.json")"
if echo "$CUR" | grep -q "POST"; then
  echo "✓ /api/* já permite POST ($CUR) — nada a fazer."
  exit 0
fi
echo "  atual /api/* AllowedMethods: $CUR"

jq '.DistributionConfig
    | (.CacheBehaviors.Items[] | select(.PathPattern=="/api/*").AllowedMethods) = {
        "Quantity": 7,
        "Items": ["GET","HEAD","OPTIONS","PUT","POST","PATCH","DELETE"],
        "CachedMethods": {"Quantity": 2, "Items": ["GET","HEAD"]}
      }' "$TMP/full.json" > "$TMP/config.json"

echo "→ update-distribution (if-match $ETAG)"
aws cloudfront update-distribution \
  --id "$DIST_ID" \
  --if-match "$ETAG" \
  --distribution-config "file://$TMP/config.json" \
  --query 'Distribution.Status' --output text

echo "✓ aplicado. CloudFront propaga em ~5-15 min. Validar depois:"
echo "  curl -s -o /dev/null -w '%{http_code}\\n' -X POST -H 'Content-Type: application/json' \\"
echo "    -d '{\"event\":\"test_started\",\"sessionId\":\"00000000-0000-4000-8000-000000000000\",\"scaleId\":\"phq9\"}' \\"
echo "    https://checkup.cerebroamigo.com.br/api/events   # espera 200 {\"ok\":true}"
