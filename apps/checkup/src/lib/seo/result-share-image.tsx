import { ImageResponse } from "next/og";
import { BRAND_LOGO_PNG } from "@/lib/brand-logo";
import { OG_SIZE } from "@/lib/seo/og-template";
import { getResultShareMeta } from "@/lib/seo/result-og";

/** OG 1200×630 para preview de compartilhamento do /resultado (sem escore/PII). */
export function resultShareOgImage(scaleId?: string | null) {
  const { eyebrow, title } = getResultShareMeta(scaleId);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          backgroundColor: "#07070D",
          backgroundImage:
            "radial-gradient(closest-side at 50% -10%, rgba(110,95,176,0.45), transparent), radial-gradient(closest-side at 90% 20%, rgba(229,115,115,0.2), transparent)",
          color: "#ECEBF5",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={BRAND_LOGO_PNG}
            width={56}
            height={58}
            alt=""
            style={{ filter: "brightness(0) invert(1)" }}
          />
          <span style={{ fontSize: 34, fontWeight: 700, letterSpacing: -0.5 }}>
            Cérebro <span style={{ color: "#9486C9", marginLeft: 8 }}>Amigo</span>
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <span
            style={{
              fontSize: 24,
              letterSpacing: 6,
              textTransform: "uppercase",
              color: "#E57373",
              marginBottom: 22,
            }}
          >
            {eyebrow}
          </span>
          <span
            style={{
              fontSize: 68,
              fontWeight: 700,
              lineHeight: 1.12,
              letterSpacing: -1.5,
              maxWidth: 980,
            }}
          >
            {title}
          </span>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 24,
            color: "#9B96B5",
          }}
        >
          <span>Gratuito · Anônimo · Instrumentos validados</span>
          <span style={{ color: "#9486C9" }}>checkup.cerebroamigo.com.br</span>
        </div>
      </div>
    ),
    OG_SIZE,
  );
}
