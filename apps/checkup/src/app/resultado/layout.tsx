import type { Metadata } from "next";
import type { ReactNode } from "react";

// A página /resultado é "use client" (lê escore/faixa da URL) e não pode exportar
// metadata. Este layout server adiciona noindex: resultado é efêmero e traz o escore
// na query string — não deve ser indexado (privacidade/SEO). Espelha /evolucao e /descadastrar.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function ResultadoLayout({ children }: { children: ReactNode }) {
  return children;
}
