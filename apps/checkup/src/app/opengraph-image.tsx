import { brandOgImage, OG_SIZE } from "@/lib/seo/og-template";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Check-up Mental gratuito e anônimo — Cérebro Amigo";

export default function Image() {
  return brandOgImage({
    eyebrow: "Check-up Mental · gratuito e anônimo",
    title: "Como você está se sentindo?",
  });
}
