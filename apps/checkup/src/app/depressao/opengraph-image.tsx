import { brandOgImage, OG_SIZE } from "@/lib/seo/og-template";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Teste de depressão online gratuito — PHQ-9 em português";

export default function Image() {
  return brandOgImage({
    eyebrow: "Triagem gratuita · PHQ-9",
    title: "Teste de depressão online",
  });
}
