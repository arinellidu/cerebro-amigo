"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";

/**
 * Error boundary raiz do checkup — superfície pública anônima.
 * Erro técnico de carregamento, NÃO evento de crise (sem CVV dramatizado).
 */
export default function CheckupError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("Check-up error:", error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[50vh] w-full max-w-lg items-center px-4 py-16 sm:px-6">
      <div className="glass-noir-deep w-full rounded-3xl p-6 text-center sm:p-8">
        <div className="mb-4 flex justify-center">
          <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-purple/25 bg-purple/10 text-purple-light">
            <RefreshCw className="h-6 w-6" aria-hidden />
          </span>
        </div>
        <h1 className="font-display text-xl font-semibold text-foreground">
          Algo deu errado por aqui
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Não conseguimos carregar esta página agora. Isso costuma ser temporário —
          tente de novo ou volte à página inicial.
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <button type="button" onClick={reset} className="btn-noir sm:min-w-[140px]">
            Tentar de novo
          </button>
          <Link href="/" className="btn-ghost-noir sm:min-w-[140px] text-center">
            Ir para o início
          </Link>
        </div>
        {process.env.NODE_ENV === "development" && (
          <pre className="mt-6 max-h-48 overflow-auto rounded-xl bg-muted p-3 text-left text-xs">
            {error.message}
            {error.digest && `\nDigest: ${error.digest}`}
          </pre>
        )}
      </div>
    </main>
  );
}
