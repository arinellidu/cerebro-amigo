import { brandOgImage, OG_SIZE } from "@/lib/seo/og-template";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Teste de ansiedade online gratuito — GAD-7 em português";

export default function Image() {
  return brandOgImage({
    eyebrow: "Triagem gratuita · GAD-7",
    title: "Teste de ansiedade online",
  });
}
