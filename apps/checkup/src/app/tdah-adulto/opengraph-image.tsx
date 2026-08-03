import { brandOgImage, OG_SIZE } from "@/lib/seo/og-template";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Teste de TDAH adulto — ASRS-18 em português";

export default function Image() {
  return brandOgImage({
    eyebrow: "ASRS-18 · OMS",
    title: "Teste de TDAH para adultos",
  });
}
