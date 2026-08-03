import { NextRequest } from "next/server";
import { getSql } from "@/lib/db";

/**
 * Cancelar lembretes de re-rastreio (ADR-050 Parte 2, Fase 3).
 * Cérebro Amigo — https://www.cerebroamigo.com.br
 *
 * GET one-click pelo link do e-mail (?t=series_token). Operação reversível e
 * NÃO destrutiva (só marca unsubscribed) → seguro como GET mesmo com prefetch de
 * cliente de e-mail. Para APAGAR dados (destrutivo) há a página /descadastrar (POST).
 *
 * Responde sempre a MESMA página, válido ou não o token → sem enumeração.
 */

function page(msg: string, status = 200): Response {
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Check-up Mental</title>
<style>body{font-family:system-ui,sans-serif;background:#0b0b12;color:#e7e7ef;display:flex;
min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px}
.card{max-width:30rem;text-align:center;line-height:1.6}a{color:#b89cff}</style></head>
<body><div class="card"><p>${msg}</p>
<p><a href="https://www.cerebroamigo.com.br">Cérebro Amigo</a></p></div></body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest) {
  const t = new URL(req.url).searchParams.get("t");
  if (!t) return page("Link inválido.", 400);

  const sql = getSql();
  if (sql) {
    try {
      await sql`
        UPDATE checkup.tracking_reminders AS r
        SET unsubscribed = TRUE, unsubscribed_at = now()
        FROM checkup.tracking_series AS s
        WHERE s.id = r.series_id AND s.series_token = ${t} AND r.unsubscribed = FALSE
      `;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Error: tracking/unsubscribe falhou: ${msg}`);
    }
  }
  // mesma resposta sempre (sem revelar se o token existia).
  return page("Pronto — você não vai mais receber lembretes de acompanhamento do Check-up Mental.");
}
