import type { Metadata } from "next";
import { Suspense } from "react";
import DescadastrarClient from "./DescadastrarClient";

// Página utilitária (link de e-mail) — fora do índice.
export const metadata: Metadata = {
  title: "Apagar meus dados — Check-up Mental",
  robots: { index: false, follow: false },
};

export default function DescadastrarPage() {
  return (
    <Suspense fallback={null}>
      <DescadastrarClient />
    </Suspense>
  );
}
