import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { RDS_CA_SA_EAST_1 } from "./rds-ca";

let _client: ReturnType<typeof postgres> | null = null;
let _db: ReturnType<typeof drizzle> | null = null;

// Cliente postgres.js cru — compartilhado com o drizzle. Usado p/ SQL cru (rate limit).
// Null se não há CHECKUP_DATABASE_URL (dev/CI → callers usam fallback).
export function getSql() {
  if (_client) return _client;
  const dsn = process.env.CHECKUP_DATABASE_URL;
  if (!dsn) return null;
  // RDS tinha rds.force_ssl=1. Host RDS: verify-full — valida a cadeia (CA da RDS) E o
  // hostname (rejectUnauthorized) → anti-MITM (CK-3). Local: sem SSL (detecta localhost).
  // Postgres self-hosted na VPC (ADR-077): cert self-signed → TLS cifra sem validar CA
  // (o anti-MITM intra-VPC fica por conta do SG: 5432 aceita só o SG do checkup).
  // Evolução registrada: cert com SAN (IP / db.cerebro.internal) + CA própria via env
  // → volta a verify-full também no caminho interno.
  const isLocal = /@(localhost|127\.0\.0\.1|host\.docker\.internal)[:/]/.test(dsn);
  const isVpcPrivate = /@(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(dsn);
  _client = postgres(dsn, {
    max: 5,
    ssl: isLocal
      ? false
      : isVpcPrivate
        ? { rejectUnauthorized: false }
        : { ca: RDS_CA_SA_EAST_1, rejectUnauthorized: true },
  });
  return _client;
}

export function getDb() {
  if (_db) return _db;
  const client = getSql();
  if (!client) return null;
  _db = drizzle(client, { schema });
  return _db;
}
