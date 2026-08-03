/* CSP ENFORCING (hardening P1). Antes era Report-Only; flipado p/ enforce após inventário
   exaustivo dos recursos client-side (2026-06-29): todo recurso carregado pelo browser foi
   mapeado e está na policy abaixo. MANTÉM 'unsafe-inline'/'unsafe-eval' em script-src —
   exigidos por React Compiler + bootstrap inline do Next + eval de chunks Turbopack; nonce
   exigiria render dinâmico e quebraria SSG/PPR + cacheComponents. Trade-off REGISTRADO: isso
   esvazia o valor anti-XSS no eixo script (um XSS injetado executaria); a CSP ainda barra
   exfiltração trivial (connect-src allowlist), clickjacking (frame-ancestors), base-hijack
   (base-uri) e plugins (object-src). Futuro: nonce + 'strict-dynamic' quando o inventário
   inline fechar.
   Hosts externos legítimos (SAS do Azure Blob, ADR-082 — um host único por storage
   account; containers ficam no path, então uma origem cobre docs/foto/áudio):
     - img-src:     foto de perfil do médico — <img> CRU (não next/image), container medico-docs.
     - connect-src: uploads PUT via SAS (foto/docs/áudio) + viacep (CEP /p/perfil).
     - media-src:   playback do áudio do paciente pelo médico (ADR-064), container audio-msgs.
   NEXT_PUBLIC_BLOB_ORIGIN (build-time, Vercel) aponta pro storage account do ambiente;
   o default cobre o dev. Turnstile (ADR-055) em script-src/frame-src. worker-src/
   manifest-src explícitos p/ o PWA. upgrade-insecure-requests espelha o checkup. */
const BLOB_ORIGIN =
  process.env.NEXT_PUBLIC_BLOB_ORIGIN ?? "https://stcerebro7zcnncyxvk.blob.core.windows.net";
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${BLOB_ORIGIN}`,
  "font-src 'self' data:",
  `connect-src 'self' https://viacep.com.br ${BLOB_ORIGIN}`,
  `media-src 'self' ${BLOB_ORIGIN}`,
  "frame-src https://challenges.cloudflare.com",
  "worker-src 'self'",
  "manifest-src 'self'",
  "upgrade-insecure-requests",
].join("; ");

/** @type {import('next').NextConfig} */
const nextConfig = {
  /* Standalone output só para Docker; Vercel ignora/usa seu próprio modelo */
  output: process.env.VERCEL ? undefined : "standalone",

  /* React Compiler: memoização automática de componentes (React 19) */
  reactCompiler: true,

  /* Cache Components: explicit caching model (Next.js 16) */
  cacheComponents: true,

  /* Segurança: remove header X-Powered-By */
  poweredByHeader: false,

  /* Compressão Gzip/Brotli habilitada por padrão; deixamos explícito */
  compress: true,

  /* Imagens: Vercel tem optimizer nativo — serve WebP/AVIF automaticamente.
     Em Docker standalone (dev local) mantemos unoptimized para evitar
     dependência de loader externo sem configuração adicional. */
  images: {
    /* Otimização on-the-fly (WebP/AVIF/resize) também fora da Vercel: no EC2
       standalone o Next usa `sharp` (em dependencies) p/ servir /_next/image. */
    unoptimized: false,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
    ],
  },

  /* Redirects de SEO (404 sinalizados pelo Google Search Console em
     cerebroamigo.com.br). `source` casa só o caminho exato.

     1. /medicos: o segmento não tem page.tsx no nível pai (só /medicos/cadastro
        existe) → 404. A landing real do médico é /medico (singular). 308 leva o
        link morto à página certa; /medicos/cadastro (rota real) não é afetado.

     2. /checkup: o Check-up vive no subdomínio próprio, não em path no domínio
        principal — palpite comum de quem digita pelo nome do produto. 308 manda
        ao subdomínio em vez de 404 (destino externo, basePath:false). */
  async redirects() {
    return [
      {
        source: "/medicos",
        destination: "/medico",
        permanent: true,
      },
      {
        source: "/checkup",
        destination: "https://checkup.cerebroamigo.com.br",
        basePath: false,
        permanent: true,
      },
    ]
  },

  /* Headers de cache e segurança para rotas estáticas */
  async headers() {
    return [
      {
        /* Assets versionados (hash no nome) = imutáveis. Reforça o default do Next
           e garante o header atrás do ALB/CloudFront. */
        source: "/_next/static/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        /* Imagens otimizadas (/_next/image): cache + revalidação em background. */
        source: "/_next/image",
        headers: [
          { key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" },
        ],
      },
      /* X-Robots-Tag: noindex nas áreas privadas. Substitui a enumeração que antes
         vivia no robots.txt (público → revelava topologia sensível). Mesmo efeito de
         não-indexação, sem mapa pra atacante. `:path*` casa o prefixo e a base. */
      ...[
        "/admin",
        "/dashboard",
        "/p",
        "/paciente",
        "/ativar-conta",
        "/api",
        "/login",
        "/medicos/cadastro",
      ].map((prefix) => ({
        source: `${prefix}/:path*`,
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      })),
      {
        source: "/:path*",
        headers: [
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            /* HSTS: força HTTPS no browser (prod serve atrás do ALB com TLS).
               2 anos + includeSubDomains; sem `preload` (não submetido à lista). */
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains",
          },
          {
            /* Permissions-Policy: trava recursos não usados. ATENÇÃO: câmera e
               microfone ficam liberados p/ `self` — a teleconsulta (WebRTC, ADR-026)
               depende deles; lockar quebraria o vídeo. Geolocalização e FLoC off. */
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(self), geolocation=(), interest-cohort=()",
          },
          {
            /* COOP: corta o vínculo com janelas/openers cross-origin (vetor Spectre
               cross-window). `allow-popups` preserva popups que NÓS abrimos (ex.: checkout
               Asaas) — isola sem quebrar fluxo. Não ativa crossOriginIsolated (não
               precisamos de SharedArrayBuffer). */
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin-allow-popups",
          },
          {
            /* CORP: impede que outras origens carreguem nossas respostas como recurso
               no-cors (side-channel). App é privado, não serve recurso cross-origin. */
            key: "Cross-Origin-Resource-Policy",
            value: "same-origin",
          },
          /* COEP (require-corp/credentialless) DEIXADO DE FORA de propósito: quebraria o
             iframe do Turnstile (ADR-055) e imagens/áudio em S3 cross-origin (não mandam
             CORP). COOP+CORP já cobrem o grosso do side-channel sem crossOriginIsolated.
             Reavaliar só se precisar de SharedArrayBuffer. */
          {
            /* CSP ENFORCING (ver CSP acima). Inventário de recursos client-side fechado em
               2026-06-29 (foto/áudio S3 nas diretivas img/connect/media). Gate de deploy:
               smoke do avatar do médico + playback de áudio em prod (CSP bloqueia silencioso
               se o host S3 divergir do default). */
            key: "Content-Security-Policy",
            value: CSP,
          },
        ],
      },
    ]
  },
}

export default nextConfig;
