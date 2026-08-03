import type { MetadataRoute } from "next";

const BASE = "https://checkup.cerebroamigo.com.br";

// Data fixa da última revisão das landings. Não usar new Date(): geraria
// lastModified "agora" a cada build — datas voláteis que o Google desconfia.
// Bump manual quando o conteúdo de uma landing mudar de fato.
const LAST_MODIFIED = "2026-06-12";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: BASE, lastModified: LAST_MODIFIED, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE}/depressao`, lastModified: LAST_MODIFIED, changeFrequency: "monthly", priority: 1.0 },
    { url: `${BASE}/ansiedade`, lastModified: LAST_MODIFIED, changeFrequency: "monthly", priority: 1.0 },
    { url: `${BASE}/tdah-adulto`, lastModified: LAST_MODIFIED, changeFrequency: "monthly", priority: 0.9 },
    { url: `${BASE}/bipolaridade`, lastModified: LAST_MODIFIED, changeFrequency: "monthly", priority: 0.9 },
    { url: `${BASE}/borderline`, lastModified: LAST_MODIFIED, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE}/alcool`, lastModified: LAST_MODIFIED, changeFrequency: "monthly", priority: 0.9 },
    { url: `${BASE}/tabagismo`, lastModified: LAST_MODIFIED, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE}/drogas`, lastModified: LAST_MODIFIED, changeFrequency: "monthly", priority: 0.8 },
  ];
}
