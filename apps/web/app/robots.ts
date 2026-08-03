import type { MetadataRoute } from "next";

const SITE_URL = "https://www.cerebroamigo.com.br";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/medico", "/precos", "/sobre", "/privacy", "/terms"],
        // Áreas privadas (admin, dashboard, portal do paciente /p/*, /api, fluxos de
        // auth) NÃO são enumeradas aqui de propósito: robots.txt é público e listar
        // caminhos sensíveis vira mapa pra atacante. A proteção real é auth + o header
        // `X-Robots-Tag: noindex, nofollow` aplicado a esses prefixos no next.config.mjs
        // (mantém o mesmo efeito de não-indexação, sem revelar a topologia).
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
