"use client";

// Popup de entrada com convite ao Instagram (pedido do dono, 2026-07-15).
// - Montar SÓ na home. NUNCA em /crise nem no fluxo do teste (clinical-safety:
//   zero marketing em superfície de crise; o gate é de quem monta a página).
// - Aparece uma vez por visitante: flag funcional em localStorage (guarda só
//   "já vi" — sem cookie, sem identificador, mesma postura anônima do produto).
// - Fecha por botão, backdrop e Escape; foco inicial no fechar; animação vem do
//   utilitário .reveal do globals.css (reduced-motion já zera tudo lá).

import { useCallback, useEffect, useRef, useState } from "react";
import { InstagramCta } from "./instagram-cta";

const SEEN_KEY = "checkup:ig-popup-seen";
const OPEN_DELAY_MS = 1800;

export function InstagramPopup() {
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  const dismiss = useCallback(() => {
    setOpen(false);
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {
      // storage bloqueado → segue sem persistir; o guard de abertura já não roda de novo nesta visita
    }
  }, []);

  useEffect(() => {
    try {
      if (localStorage.getItem(SEEN_KEY)) return;
    } catch {
      return; // sem storage não dá pra lembrar o "já vi" — melhor não insistir a cada visita
    }
    const t = setTimeout(() => setOpen(true), OPEN_DELAY_MS);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, dismiss]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ig-popup-titulo"
    >
      <button
        type="button"
        aria-label="Fechar"
        onClick={dismiss}
        className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-sm"
        tabIndex={-1}
      />
      <div className="reveal glass-noir relative w-full max-w-sm rounded-2xl p-6">
        <button
          ref={closeRef}
          type="button"
          onClick={dismiss}
          aria-label="Fechar"
          className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:text-foreground"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            className="h-4 w-4"
            aria-hidden
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>

        <h2 id="ig-popup-titulo" className="pr-10 text-base font-semibold text-foreground">
          Acompanhe o Cérebro Amigo
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Conteúdo sobre saúde mental, direto de quem cuida — sem sensacionalismo.
        </p>

        {/* Clicar no CTA também conta como "já vi" (não reabrir na volta da aba) */}
        <div className="mt-4" onClickCapture={dismiss}>
          <InstagramCta />
        </div>

        <button
          type="button"
          onClick={dismiss}
          className="mt-3 flex min-h-[44px] w-full items-center justify-center rounded-xl text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          Agora não
        </button>
      </div>
    </div>
  );
}
