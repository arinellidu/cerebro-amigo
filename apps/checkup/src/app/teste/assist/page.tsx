import type { Metadata } from "next";
import { ASSIST_VALIDATED } from "@/lib/scales/assist";
import { AssistFlow } from "./AssistFlow";

export const metadata: Metadata = {
  title: "Triagem de Uso de Substâncias — ASSIST (OMS)",
  description:
    "Responda sobre o uso de substâncias nos últimos 3 meses. O número de perguntas se adapta às suas respostas.",
  robots: { index: false },
};

export default function AssistPage() {
  // Mesmo gate das demais escalas: sem conferência da fonte, "Em breve".
  if (!ASSIST_VALIDATED) {
    return (
      <main className="flex min-h-[72vh] items-center justify-center px-4">
        <div className="glass-noir max-w-sm rounded-3xl p-8 text-center">
          <p className="mb-4 text-4xl">🔬</p>
          <h1 className="mb-2 font-display text-2xl font-semibold text-foreground">Em breve</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            A triagem ASSIST está em fase de validação e será disponibilizada em breve.
          </p>
        </div>
      </main>
    );
  }

  return <AssistFlow />;
}
