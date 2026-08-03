#!/bin/sh
set -eu

: "${POSTGRES_HOST:?POSTGRES_HOST ausente}"
: "${POSTGRES_DATABASE:?POSTGRES_DATABASE ausente}"
: "${POSTGRES_ADMIN_USER:?POSTGRES_ADMIN_USER ausente}"
: "${POSTGRES_ADMIN_PASSWORD:?POSTGRES_ADMIN_PASSWORD ausente}"
: "${DEMO_LOGIN_PASSWORD:?DEMO_LOGIN_PASSWORD ausente}"

POSTGRES_ADMIN_DSN="host=${POSTGRES_HOST} port=5432 dbname=${POSTGRES_DATABASE} user=${POSTGRES_ADMIN_USER} password=${POSTGRES_ADMIN_PASSWORD} sslmode=require"
export POSTGRES_ADMIN_DSN

psql "$POSTGRES_ADMIN_DSN" \
  -v ON_ERROR_STOP=1 \
  -v demo_login_password="$DEMO_LOGIN_PASSWORD" \
  -f /seed/portfolio.sql
echo 'Seed fictício de portfólio aplicado.'
