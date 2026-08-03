import type { Metadata } from "next";
import { Suspense } from "react";
import EvolucaoClient from "./EvolucaoClient";

// Página utilitária por token (link de e-mail) — fora do índice.
export const metadata: Metadata = {
  title: "Sua evolução — Check-up Mental",
  robots: { index: false, follow: false },
};

export default function EvolucaoPage() {
  return (
    <Suspense fallback={null}>
      <EvolucaoClient />
    </Suspense>
  );
}
