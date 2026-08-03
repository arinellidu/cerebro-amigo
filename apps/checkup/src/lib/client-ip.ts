/**
 * Derivação confiável do IP do cliente para rate limit.
 *
 * PORQUÊ: a versão antiga lia `x-forwarded-for.split(",")[0]` (o PRIMEIRO elemento =
 * valor que o viewer pode FORJAR). Como os proxies confiáveis *anexam* à direita, o
 * atacante injetava `X-Forwarded-For: <aleatório>` e ganhava um "IP novo" por request,
 * zerando o rate limit por IP (denial-of-wallet — ADR-075).
 *
 * TOPOLOGIA (decide quantos hops descartar da direita):
 *  - HOJE o checkup serve DIRETO do ALB (ASG+ALB próprio, ADR-045; DNS aponta no ALB).
 *    1 proxy confiável (o ALB) anexa o IP TCP do viewer no fim do XFF → o IP real é a
 *    ÚLTIMA entrada → descartar 0 da direita (`CHECKUP_TRUSTED_PROXY_HOPS=0`, default).
 *  - Quando o CloudFront for fronteado e ENFORÇADO (origin-secret no :443, ADR-047 —
 *    follow-up deferido do ADR-075), passam a existir 2 proxies (CF anexa o viewer, ALB
 *    anexa o egress do CF) → setar `CHECKUP_TRUSTED_PROXY_HOPS=1`. Enquanto o :443 do ALB
 *    estiver alcançável direto, NÃO use 1 (o caminho de bypass leria entrada forjada).
 *
 * Valor não-inteiro/negativo na env → cai para o default (nunca reabrir o spoof em
 * silêncio). O backstop topology-independent do gasto é o circuit breaker global
 * (`ai/breaker.ts`), não este helper.
 *
 * `CloudFront-Viewer-Address` (header não-spoofável que o CF injeta da conexão TCP) só
 * é confiado quando `CHECKUP_TRUST_CF_VIEWER_HEADER=true` — porque, enquanto o ALB :443
 * estiver aberto, um atacante batendo direto no ALB poderia FORJAR esse header.
 *
 * Sem PII persistida: o IP é só chave efêmera de rate limit.
 */

// Nº de proxies confiáveis cujas entradas (à direita) descartar. Lido em runtime
// (testável; sem captura no load). Inválido → 0.
function trustedHops(): number {
  const raw = process.env.CHECKUP_TRUSTED_PROXY_HOPS;
  if (raw === undefined) return 0;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

function stripPort(addr: string): string {
  const v = addr.trim();
  if (!v) return "";
  // IPv6 entre colchetes: "[2001:db8::1]:443"
  if (v.startsWith("[")) {
    const end = v.indexOf("]");
    return end > 0 ? v.slice(1, end) : v;
  }
  // CloudFront-Viewer-Address sempre traz ":porta" no fim. Tira o último segmento se
  // ele for a porta (só dígitos) — funciona p/ IPv4 ("1.2.3.4:567") E IPv6 sem colchetes
  // ("2001:db8::1:567"), formato real da AWS. (Só chamado no header do CF, que tem porta.)
  const lastColon = v.lastIndexOf(":");
  if (lastColon > 0 && /^\d+$/.test(v.slice(lastColon + 1))) {
    return v.slice(0, lastColon);
  }
  return v;
}

interface HeaderGetter {
  headers: { get(name: string): string | null };
}

export function getClientIp(req: HeaderGetter): string {
  // 1) Header gerenciado do CloudFront — só quando o CF for o caminho enforçado.
  if (process.env.CHECKUP_TRUST_CF_VIEWER_HEADER === "true") {
    const cfViewer = req.headers.get("cloudfront-viewer-address");
    if (cfViewer) {
      const ip = stripPort(cfViewer);
      if (ip) return ip;
    }
  }

  // 2) XFF descartando os hops confiáveis da direita.
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length > 0) {
      const idx = parts.length - 1 - trustedHops();
      // Cadeia mais curta que o esperado: melhor esforço (entrada mais à esquerda).
      return parts[idx >= 0 ? idx : 0];
    }
  }

  // 3) Último recurso.
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}
