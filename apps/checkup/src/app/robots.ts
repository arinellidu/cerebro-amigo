import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/depressao", "/ansiedade", "/tdah-adulto"],
        // /api fora da enumeração de propósito (não revelar a superfície de API no
        // robots.txt público; protegida por noindex header no next.config.ts). /teste,
        // /resultado e /crise ficam: curadoria de SEO do funil, não endpoint sensível.
        disallow: ["/teste/", "/resultado", "/crise"],
      },
    ],
    sitemap: "https://checkup.cerebroamigo.com.br/sitemap.xml",
  };
}
