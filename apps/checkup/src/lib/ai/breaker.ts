/**
 * Circuit breaker GLOBAL de chamadas ao LLM (anti denial-of-wallet).
 *
 * PORQUÊ: o rate limit por IP/sessão (`ratelimit.ts`) protege contra um cliente
 * isolado, mas o único teto de GASTO total era o spend-limit MENSAL do Console
 * Anthropic — que é o último recurso e, quando dispara, mata o produto para todos
 * pelo resto do mês. Este breaker impõe um teto DURO em código, por hora e por dia:
 * quando estoura, a devolutiva degrada para o fallback estático (que é produto —
 * ver `src/lib/ai/CLAUDE.md`), o gasto fica capped num valor conhecido em USD, e o
 * produto não quebra.
 *
 * Estado atômico no Postgres (`checkup.rate_limits`, mesma tabela/UPSERT do rate
 * limit — migration 0040, SEM migration nova). In-memory NÃO serve: cada instância
 * do ASG teria seu próprio teto e o "global" viraria N×.
 *
 * Postura sob falha: se o DB está indisponível, o breaker FALHA ABERTO (não conta →
 * permite). O caminho por request já é fail-CLOSED nessa condição (ver
 * `checkDevolutivaLimit`), então o flood não passa mesmo assim; o breaker é o teto
 * macro e não deve derrubar o produto num soluço de DB.
 *
 * LGPD: os baldes globais (`llm:global:hour`/`llm:global:day`) não guardam IP, sessão
 * nem qualquer PII — só um contador.
 */
import { getSql } from "@/lib/db";

// Cap inteiro positivo da env; valor inválido (NaN, ≤0, não-inteiro) → default. SEM
// isto, `Number("abc")=NaN` e `hits > NaN` é sempre false → o breaker NUNCA dispararia
// (fail-open silencioso do teto de gasto).
function intCap(name: string, def: number): number {
  const raw = process.env[name];
  if (raw === undefined) return def;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : def;
}
const HOURLY_CAP = intCap("CHECKUP_LLM_HOURLY_CAP", 500);
const DAILY_CAP = intCap("CHECKUP_LLM_DAILY_CAP", 3000);

const HOUR_SEC = 60 * 60;
const DAY_SEC = 24 * 60 * 60;

export type LlmBudgetResult = { allowed: true } | { allowed: false; scope: "hour" | "day" };

// UPSERT atômico fixed-window: incrementa o balde e diz se passou do teto.
// Retorna null se não há DB ou se a query falhou (caller decide a postura).
async function hitGlobal(bucket: string, windowSec: number, cap: number): Promise<{ over: boolean; hits: number } | null> {
  const sql = getSql();
  if (!sql) return null;
  try {
    const rows = await sql<{ hits: number }[]>`
      INSERT INTO checkup.rate_limits (bucket, hits, window_start)
      VALUES (${bucket}, 1, now())
      ON CONFLICT (bucket) DO UPDATE SET
        hits = CASE
          WHEN checkup.rate_limits.window_start < now() - make_interval(secs => ${windowSec})
          THEN 1 ELSE checkup.rate_limits.hits + 1 END,
        window_start = CASE
          WHEN checkup.rate_limits.window_start < now() - make_interval(secs => ${windowSec})
          THEN now() ELSE checkup.rate_limits.window_start END
      RETURNING hits
    `;
    const hits = Number(rows[0].hits);
    return { over: hits > cap, hits };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: breaker DB falhou (${bucket}): ${msg}`);
    return null;
  }
}

/**
 * Consome 1 unidade do orçamento global de chamadas LLM e diz se a chamada pode
 * prosseguir. Chamar IMEDIATAMENTE antes de `client.messages.create` (depois do
 * short-circuit das escalas sem LLM, para não gastar orçamento à toa).
 */
export async function tryConsumeLlmBudget(): Promise<LlmBudgetResult> {
  // Checa a janela horária PRIMEIRO. Se estourou, retorna SEM tocar o balde diário —
  // senão tentativas já recusadas pelo cap de 1h inflariam o teto de 24h, e um burst de
  // 1h derrubaria a IA por 1 dia inteiro a custo-zero de LLM. Assim o balde diário só
  // conta requests que passaram no gate horário (≈ chamadas reais ao LLM).
  const hour = await hitGlobal("llm:global:hour", HOUR_SEC, HOURLY_CAP);
  // DB indisponível → fail-open (o caminho por request já é fail-closed nessa condição;
  // o breaker é o teto macro e não deve derrubar o produto num soluço de DB).
  if (hour === null) return { allowed: true };
  if (hour.over) {
    // Log estruturado p/ metric filter + alarme CloudWatch (observabilidade de gasto).
    console.warn(`llm.breaker.tripped scope=hour cap=${HOURLY_CAP} hits=${hour.hits}`);
    return { allowed: false, scope: "hour" };
  }

  const day = await hitGlobal("llm:global:day", DAY_SEC, DAILY_CAP);
  if (day === null) return { allowed: true };
  if (day.over) {
    console.warn(`llm.breaker.tripped scope=day cap=${DAILY_CAP} hits=${day.hits}`);
    return { allowed: false, scope: "day" };
  }
  return { allowed: true };
}
