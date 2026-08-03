import Link from "next/link";
import { Suspense } from "react";
import { ContinueButton } from "./ContinueButton";

// Server Component: os recursos de crise (CVV/SAMU/CAPS) renderizam ESTATICAMENTE
// (SSR/prerender), aparecendo mesmo se o JS falhar ou demorar. É a página mais
// crítica do produto — nunca pode depender de hidratação p/ mostrar os canais de ajuda.
// Só o botão "continuar" (que lê searchParams) é dinâmico, isolado sob Suspense.

export const metadata = {
  title: "Apoio agora — Check-up Mental",
  robots: { index: false },
};

export default function CrisePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 py-16 bg-[#F8FAFC]">
      <div className="max-w-md w-full">
        <div className="text-center mb-9">
          <h1 className="text-2xl sm:text-[1.75rem] font-semibold text-[#1E293B] mb-3 leading-snug">
            Você não precisa passar por isso sozinho
          </h1>
          <p className="text-[#475569] leading-relaxed">
            Responder essa pergunta com honestidade exige coragem. Há pessoas disponíveis
            agora para conversar, sem julgamento.
          </p>
        </div>

        <div className="space-y-3 mb-8">
          <a
            href="tel:188"
            className="flex items-center gap-4 p-5 bg-white rounded-2xl border border-[#E2E8F0] shadow-sm hover:border-[#94A3B8] hover:shadow transition-all min-h-[44px]"
          >
            <span className="text-2xl">📞</span>
            <div>
              <p className="font-semibold text-[#1E293B]">CVV — 188</p>
              <p className="text-sm text-[#64748B]">Ligação gratuita, 24 horas por dia</p>
            </div>
          </a>

          <a
            href="https://cvv.org.br"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-4 p-5 bg-white rounded-2xl border border-[#E2E8F0] shadow-sm hover:border-[#94A3B8] hover:shadow transition-all min-h-[44px]"
          >
            <span className="text-2xl">💬</span>
            <div>
              <p className="font-semibold text-[#1E293B]">Chat CVV</p>
              <p className="text-sm text-[#64748B]">cvv.org.br — disponível 24h</p>
            </div>
          </a>

          <a
            href="tel:192"
            className="flex items-center gap-4 p-5 bg-white rounded-2xl border border-[#E2E8F0] shadow-sm hover:border-[#94A3B8] hover:shadow transition-all min-h-[44px]"
          >
            <span className="text-2xl">🚑</span>
            <div>
              <p className="font-semibold text-[#1E293B]">SAMU — 192</p>
              <p className="text-sm text-[#64748B]">Emergência médica, 24 horas</p>
            </div>
          </a>

          <div className="flex items-start gap-4 p-5 bg-white rounded-2xl border border-[#E2E8F0] shadow-sm">
            <span className="text-2xl">🏥</span>
            <div>
              <p className="font-semibold text-[#1E293B]">CAPS ou pronto-socorro</p>
              <p className="text-sm text-[#64748B]">
                Se você estiver em perigo imediato, vá ao pronto-socorro mais próximo
                ou peça para alguém de confiança te acompanhar agora.
              </p>
            </div>
          </div>
        </div>

        <p className="text-sm text-[#64748B] text-center mb-6">
          Contar para alguém de confiança o que você está sentindo também pode ajudar.
        </p>

        <Suspense fallback={null}>
          <ContinueButton />
        </Suspense>

        <div className="mt-8 text-center">
          <Link href="/" className="text-xs text-[#94A3B8] hover:text-[#64748B]">
            ← Voltar ao início
          </Link>
        </div>
      </div>
    </main>
  );
}
