import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import QRCode from "qrcode";
import { CheckupPDF, buildQrUrl } from "@/components/CheckupPDF";
import { checkPdfLimit } from "@/lib/ratelimit";
import { getClientIp } from "@/lib/client-ip";

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  const limit = await checkPdfLimit(ip);
  if (!limit.allowed) {
    const retryAfter = Math.ceil((limit.retryAfterMs ?? 3600000) / 1000);
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    );
  }

  const { searchParams } = new URL(req.url);
  const scale = searchParams.get("scale") ?? "";
  const scoreStr = searchParams.get("score") ?? "0";
  const band = searchParams.get("band") ?? "";
  const sub = searchParams.get("sub") ?? "";
  const inj = searchParams.get("inj") === "1";
  const label = searchParams.get("label") ?? "";
  const crisis = searchParams.get("crisis") === "true";
  // rid normal é `sid.slice(0,8)` (hex). Valida o mesmo padrão de events/route.ts para
  // impedir injeção de query params extras / destino manipulado no QR (rid entra cru na
  // URL via buildQrUrl). Inválido → tratado como ausente (sem QR), não quebra o fluxo.
  const ridRaw = searchParams.get("rid") ?? "";
  const rid = /^[A-Za-z0-9-]{1,32}$/.test(ridRaw) ? ridRaw : "";

  const score = parseInt(scoreStr, 10);
  if (!scale || !band) {
    return NextResponse.json({ error: "missing_params" }, { status: 400 });
  }
  // Limites de tamanho: estas strings entram cruas no react-pdf (renderToBuffer) numa
  // superfície pública. Sem teto, query params gigantes inflam CPU/RAM do container
  // (256m/0.5cpu) e o tamanho do PDF — DoS de recurso. `sub` (ASSIST) é multi-linha:
  // cap por tamanho E por nº de entradas. Score num range sano. Anti-abuso do checkup.
  if (
    scale.length > 24 ||
    band.length > 24 ||
    label.length > 64 ||
    sub.length > 500 ||
    sub.split(/[\n,;|]/).length > 30 ||
    !Number.isFinite(score) ||
    score < 0 ||
    score > 999
  ) {
    return NextResponse.json({ error: "invalid_params" }, { status: 400 });
  }

  // QR real (PNG data-URL) gerado server-side — react-pdf não roda <canvas>,
  // então o componente recebe a imagem pronta. Omitido na versão crise.
  let qrDataUrl = "";
  if (!crisis && rid) {
    try {
      qrDataUrl = await QRCode.toDataURL(buildQrUrl(rid), {
        width: 240,
        margin: 1,
        errorCorrectionLevel: "M",
        color: { dark: "#0F2137", light: "#FFFFFF" },
      });
    } catch {
      // sem QR o PDF ainda sai com o link em texto
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer = await renderToBuffer(createElement(CheckupPDF, { scale, score, band, label, crisis, rid, qrDataUrl, sub, inj }) as any);

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="checkup-${scale}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
