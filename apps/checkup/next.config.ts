// next.config.ts — espelhar a config de apps/web (PPR/cacheComponents + React Compiler).
// Se as flags em apps/web estiverem em outro formato/posição, copiar de lá: a
// fonte de verdade é o app web, não este stub.

import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

// CSP da superfície pública anônima (P1 hardening). `'unsafe-inline'` é necessário em
// script-src (JSON-LD do SEO via dangerouslySetInnerHTML + bootstrap de hidratação do
// Next) e style-src (experimental.inlineCss + Tailwind + estilos da tela de crise);
// nonce exigiria render dinâmico, incompatível com o modelo SSG/PPR do checkup. Sem
// recurso externo (sem GA/pixels — CLAUDE.md), então connect/img/font ficam em 'self'.
// `'unsafe-eval'` só em dev: React/Turbopack usam eval() p/ debugging (nunca em prod).
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP },
  // HSTS sem `preload` de propósito: preload é compromisso do apex (hstspreload.org),
  // não de um subdomínio. 2 anos + includeSubDomains já é forte. checkup é HTTPS-only (ALB 80→443).
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  reactCompiler: true,
  output: process.env.VERCEL ? undefined : "standalone",

  // Headers de segurança em todas as rotas (P1 hardening — checkup não tinha nenhum).
  async headers() {
    return [
      // noindex na superfície de API (saiu do robots.txt público; mesmo efeito, sem reveal).
      { source: "/api/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
      { source: "/:path*", headers: SECURITY_HEADERS },
    ];
  },
  // LCP/FCP: inline do CSS crítico no <head> (sem <link> render-blocking). Tira
  // um RTT do critical path — sob throttle slow-4G (Lantern) o CSS deixa de
  // serializar antes do primeiro paint. Landing é estática, CSS pequeno → ganho limpo.
  experimental: { inlineCss: true },
  // @react-pdf/renderer quebra quando empacotado pelo Turbopack — o reconciler estoura
  // "Cannot read properties of undefined (reading 'S')" em runtime (appendChild). Externalizar
  // carrega o pacote nativo de node_modules no servidor, sem bundlar. NÃO usar transpilePackages.
  serverExternalPackages: ["@react-pdf/renderer"],
};

export default nextConfig;
