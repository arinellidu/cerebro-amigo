/**
 * Rate limiting do checkup (CK-5).
 *
 * Padrão: fixed-window atômico no Postgres (checkup.rate_limits) — sobrevive a
 * restart e funciona com múltiplas instâncias. Se não houver DB (dev/CI) ou o DB
 * falhar, cai no limitador in-memory (instância única) — fail-soft, nunca derruba
 * o produto.
 *
 * Limites:
 *  - devolutiva: 3/sessão (janela 24h) + 20/IP/h
 *  - pdf/e-mail: 30/IP/h
 */
import { getSql } from "./db";

const SESSION_DEVOLUTIVA_LIMIT = 3;
const IP_DEVOLUTIVA_LIMIT = 20;
const IP_PDF_LIMIT = 30;
const WINDOW_MS = 60 * 60 * 1000; // 1 hora
const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000; // cap por sessão: janela de 1 dia

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; reason: "session_exceeded" | "ip_exceeded"; retryAfterMs?: number };

// Resultado do caminho Postgres, distinguindo "não há DB" (dev/CI → usar in-memory)
// de "DB configurado mas falhou" (incidente em prod → o caller paga decide a postura:
// fail-soft no PDF/dev, fail-CLOSED no caminho que gasta dinheiro). Anti denial-of-wallet.
type DbOutcome =
  | { ok: true; res: RateLimitResult }
  | { ok: false; reason: "no-db" | "db-error" };

// Postura sob falha de DB no caminho pago (LLM/e-mail): negar por uma janela.
const DB_DOWN_RETRY_MS = WINDOW_MS;

// ─── Caminho Postgres (atômico) ─────────────────────────────────────────────
async function dbHit(
  bucket: string,
  windowMs: number,
  limit: number,
  reason: "session_exceeded" | "ip_exceeded"
): Promise<DbOutcome> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: "no-db" }; // dev/CI: sem DSN
  const windowSec = Math.ceil(windowMs / 1000);
  try {
    const rows = await sql<{ hits: number; retry_ms: string }[]>`
      INSERT INTO checkup.rate_limits (bucket, hits, window_start)
      VALUES (${bucket}, 1, now())
      ON CONFLICT (bucket) DO UPDATE SET
        hits = CASE
          WHEN checkup.rate_limits.window_start < now() - make_interval(secs => ${windowSec})
          THEN 1 ELSE checkup.rate_limits.hits + 1 END,
        window_start = CASE
          WHEN checkup.rate_limits.window_start < now() - make_interval(secs => ${windowSec})
          THEN now() ELSE checkup.rate_limits.window_start END
      RETURNING
        hits,
        ceil(extract(epoch from (window_start + make_interval(secs => ${windowSec}) - now())) * 1000)::bigint AS retry_ms
    `;
    const row = rows[0];
    if (Number(row.hits) > limit) {
      return { ok: true, res: { allowed: false, reason, retryAfterMs: Math.max(0, Number(row.retry_ms)) } };
    }
    return { ok: true, res: { allowed: true } };
  } catch (err: unknown) {
    // DB configurado, mas a query falhou (incidente). Loga (CK-1/CK-2); o caller decide.
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: rate_limit DB falhou (${bucket}): ${msg}`);
    return { ok: false, reason: "db-error" };
  }
}

// ─── Fallback in-memory (instância única) ───────────────────────────────────
const ipDevolutivaWindows = new Map<string, number[]>();
const ipPdfWindows = new Map<string, number[]>();
const sessionDevolutivaCounts = new Map<string, number>();

function pruneWindow(timestamps: number[], now: number): number[] {
  return timestamps.filter((t) => now - t < WINDOW_MS);
}

function memDevolutiva(ip: string, sessionId: string): RateLimitResult {
  const now = Date.now();
  const sessionCount = sessionDevolutivaCounts.get(sessionId) ?? 0;
  if (sessionCount >= SESSION_DEVOLUTIVA_LIMIT) {
    return { allowed: false, reason: "session_exceeded" };
  }
  const ipWindow = pruneWindow(ipDevolutivaWindows.get(ip) ?? [], now);
  if (ipWindow.length >= IP_DEVOLUTIVA_LIMIT) {
    const retryAfterMs = WINDOW_MS - (now - Math.min(...ipWindow));
    return { allowed: false, reason: "ip_exceeded", retryAfterMs };
  }
  sessionDevolutivaCounts.set(sessionId, sessionCount + 1);
  ipWindow.push(now);
  ipDevolutivaWindows.set(ip, ipWindow);
  return { allowed: true };
}

function memPdf(ip: string): RateLimitResult {
  const now = Date.now();
  const ipWindow = pruneWindow(ipPdfWindows.get(ip) ?? [], now);
  if (ipWindow.length >= IP_PDF_LIMIT) {
    const retryAfterMs = WINDOW_MS - (now - Math.min(...ipWindow));
    return { allowed: false, reason: "ip_exceeded", retryAfterMs };
  }
  ipWindow.push(now);
  ipPdfWindows.set(ip, ipWindow);
  return { allowed: true };
}

// ─── API pública (async) ────────────────────────────────────────────────────

// Caminho LLM (devolutiva) = FAIL-CLOSED sob falha de DB: numa superfície anônima
// paga, sem como rate-limitar honestamente é melhor degradar para o fallback
// estático do que abrir a torneira. "no-db" (dev/CI) ainda usa o in-memory.
export async function checkDevolutivaLimit(ip: string, sessionId: string): Promise<RateLimitResult> {
  const sess = await dbHit(`dev:sess:${sessionId}`, SESSION_WINDOW_MS, SESSION_DEVOLUTIVA_LIMIT, "session_exceeded");
  if (sess.ok) {
    if (!sess.res.allowed) return sess.res;
  } else if (sess.reason === "db-error") {
    return { allowed: false, reason: "session_exceeded", retryAfterMs: DB_DOWN_RETRY_MS };
  } else {
    return memDevolutiva(ip, sessionId); // no-db → in-memory (dev/CI)
  }
  const ipr = await dbHit(`dev:ip:${ip}`, WINDOW_MS, IP_DEVOLUTIVA_LIMIT, "ip_exceeded");
  if (ipr.ok) return ipr.res;
  if (ipr.reason === "db-error") return { allowed: false, reason: "ip_exceeded", retryAfterMs: DB_DOWN_RETRY_MS };
  return memDevolutiva(ip, sessionId);
}

// PDF = fail-SOFT (só custo de CPU, sem gasto externo). E-mail (Resend) = passar
// `failClosed: true` (custo externo + reputação do domínio clínico compartilhado).
export async function checkPdfLimit(ip: string, failClosed = false): Promise<RateLimitResult> {
  const r = await dbHit(`pdf:ip:${ip}`, WINDOW_MS, IP_PDF_LIMIT, "ip_exceeded");
  if (r.ok) return r.res;
  if (r.reason === "db-error" && failClosed) {
    return { allowed: false, reason: "ip_exceeded", retryAfterMs: DB_DOWN_RETRY_MS };
  }
  return memPdf(ip); // no-db (dev/CI) ou db-error em caminho fail-soft
}

// Opt-in do acompanhamento longitudinal (ADR-050 Parte 2): escrita por sessão na
// superfície pública → mesmo perfil da devolutiva (3/sessão/24h + 20/IP/h). Baldes
// próprios no DB (`trk:*`); fail-soft (sem custo externo de LLM/e-mail aqui — a
// rota já é fail-closed sem DB para gravar).
export async function checkTrackingLimit(ip: string, sessionId: string): Promise<RateLimitResult> {
  const sess = await dbHit(`trk:sess:${sessionId}`, SESSION_WINDOW_MS, SESSION_DEVOLUTIVA_LIMIT, "session_exceeded");
  if (sess.ok) {
    if (!sess.res.allowed) return sess.res;
  } else {
    return memDevolutiva(ip, sessionId);
  }
  const ipr = await dbHit(`trk:ip:${ip}`, WINDOW_MS, IP_DEVOLUTIVA_LIMIT, "ip_exceeded");
  return ipr.ok ? ipr.res : memDevolutiva(ip, sessionId);
}

// Expõe o caminho in-memory para teste (vitest roda sem DB → usa o fallback).
export const _testOnly = {
  resetAll() {
    ipDevolutivaWindows.clear();
    ipPdfWindows.clear();
    sessionDevolutivaCounts.clear();
  },
  setSessionCount(sessionId: string, count: number) {
    sessionDevolutivaCounts.set(sessionId, count);
  },
  fillIpWindow(ip: string, count: number, nowFn = Date.now) {
    const ts = nowFn();
    ipDevolutivaWindows.set(ip, Array.from({ length: count }, () => ts));
  },
};
