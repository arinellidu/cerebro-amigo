"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

// Eliminação dos dados de acompanhamento (LGPD) — ADR-050 Parte 2, Fase 3.
// POST explícito por botão (nunca GET one-click) → prefetch de e-mail não apaga dados.
export default function DescadastrarClient() {
  const token = useSearchParams().get("t") ?? "";
  const [state, setState] = useState<"idle" | "deleting" | "done" | "error">("idle");

  const erase = () => {
    if (!token || state === "deleting") return;
    setState("deleting");
    fetch("/api/tracking/erase", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then((r) => setState(r.ok ? "done" : "error"))
      .catch(() => setState("error"));
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-10">
      <section className="glass-noir rounded-3xl p-6 sm:p-7">
        <h1 className="font-display text-xl font-semibold leading-snug text-foreground">
          Apagar meus dados de acompanhamento
        </h1>

        {!token ? (
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Link inválido. Use o link do e-mail de acompanhamento.
          </p>
        ) : state === "done" ? (
          <p role="status" aria-live="polite" className="mt-3 text-sm leading-relaxed text-purple-light">
            ✓ Pronto. Seus escores de acompanhamento e o e-mail (cifrado) foram apagados em
            definitivo. Você não receberá mais lembretes.
          </p>
        ) : (
          <>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Isto apaga em definitivo a sua série de acompanhamento: todos os escores guardados,
              o agendamento dos lembretes e o seu e-mail (que fica cifrado). Não dá para desfazer.
            </p>
            <button
              onClick={erase}
              disabled={state === "deleting"}
              className="btn-noir mt-5 w-full disabled:opacity-50"
            >
              {state === "deleting" ? "Apagando..." : "Apagar meus dados"}
            </button>
            {state === "error" && (
              <p role="alert" className="mt-2 text-xs text-amber-300">Não deu pra apagar agora. Tente de novo.</p>
            )}
          </>
        )}

        <div className="mt-6 text-center">
          <Link href="/" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
            ← Voltar ao Check-up
          </Link>
        </div>
      </section>
    </main>
  );
}
