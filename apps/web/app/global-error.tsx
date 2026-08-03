"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global-error]", error);
  }, [error]);

  // Boundary raiz: fica fora do layout do app (renderiza o proprio <html>/<body>),
  // entao usamos estilos inline para nao depender de globals.css/tokens de tema.
  // E o ultimo fallback inclusive do portal do paciente (/p/*) — por isso o tom
  // e calmo e a mensagem e generica em pt-BR, sem stack trace nem detalhe tecnico.
  return (
    <html lang="pt-BR">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1.5rem",
          fontFamily:
            'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          backgroundColor: "#f8fafc",
          color: "#0f172a",
        }}
      >
        <div style={{ textAlign: "center", maxWidth: "28rem" }}>
          <div
            aria-hidden="true"
            style={{
              width: "4rem",
              height: "4rem",
              margin: "0 auto 1rem",
              borderRadius: "9999px",
              backgroundColor: "#fee2e2",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "1.75rem",
            }}
          >
            ⚠️
          </div>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 600, margin: "0 0 0.5rem" }}>
            Algo deu errado
          </h1>
          <p
            style={{
              fontSize: "0.95rem",
              lineHeight: 1.5,
              color: "#475569",
              margin: "0 0 1.5rem",
            }}
          >
            Não foi possível carregar a tela. Atualize a página; se o problema
            continuar, tente de novo em alguns minutos ou fale com o suporte.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              cursor: "pointer",
              border: "none",
              borderRadius: "0.5rem",
              padding: "0.625rem 1.25rem",
              fontSize: "0.95rem",
              fontWeight: 500,
              color: "#ffffff",
              backgroundColor: "#0f172a",
            }}
          >
            Tentar novamente
          </button>
        </div>
      </body>
    </html>
  );
}
