import { ImageResponse } from "next/og"

export const runtime = "edge"
export const alt = "Cérebro Amigo — Acompanhamento entre consultas para psiquiatria"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #07070D 0%, #0E0E18 60%, #14141F 100%)",
          position: "relative",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {/* Neural dots decorativos */}
        {[
          [80, 120, 4], [200, 280, 3], [950, 90, 5], [1100, 200, 3],
          [350, 500, 4], [800, 450, 3], [150, 400, 2], [1050, 520, 2],
        ].map(([x, y, r], i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x,
              top: y,
              width: r * 2,
              height: r * 2,
              borderRadius: "50%",
              background: i % 3 === 0 ? "#E57373" : "#9486C9",
              opacity: 0.5,
            }}
          />
        ))}

        {/* aurora glow */}
        <div
          style={{
            position: "absolute",
            top: -100,
            left: "50%",
            transform: "translateX(-50%)",
            width: 800,
            height: 400,
            borderRadius: "50%",
            background: "radial-gradient(ellipse, rgba(94,75,139,0.25) 0%, transparent 70%)",
          }}
        />

        {/* brain emoji grande */}
        <div style={{ fontSize: 80, marginBottom: 24 }}>🧠</div>

        {/* wordmark */}
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 20 }}>
          <span style={{ fontSize: 56, fontWeight: 400, color: "#ECEBF5", letterSpacing: "-1px" }}>
            Cérebro
          </span>
          <span style={{ fontSize: 56, fontWeight: 600, color: "#9486C9", letterSpacing: "-1px" }}>
            Amigo
          </span>
        </div>

        {/* tagline */}
        <div
          style={{
            fontSize: 22,
            color: "#9B96B5",
            textAlign: "center",
            maxWidth: 700,
            lineHeight: 1.4,
          }}
        >
          Acompanhamento entre consultas para psiquiatria.
          <br />
          Paciente registra. IA organiza. Médico chega preparado.
        </div>

        {/* trust bar */}
        <div
          style={{
            display: "flex",
            gap: 32,
            marginTop: 40,
            fontSize: 14,
            color: "#6F6B86",
            fontFamily: "monospace",
          }}
        >
          <span>LGPD</span>
          <span>·</span>
          <span>AZURE · EASTUS2 · FICTIONAL DATA</span>
          <span>·</span>
          <span>PROTOCOLO DE CRISE</span>
        </div>

        {/* url */}
        <div style={{ position: "absolute", bottom: 32, right: 48, fontSize: 16, color: "#6F6B86" }}>
          cerebroamigo.com.br
        </div>
      </div>
    ),
    { ...size },
  )
}
