"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

// Único pedaço dinâmico da /crise: lê searchParams p/ montar o link de "continuar"
// ao resultado. Isolado num client component pequeno sob Suspense — os recursos de
// crise (CVV/SAMU) ficam no Server Component e renderizam SEM JS.
export function ContinueButton() {
  const searchParams = useSearchParams();
  const sid = searchParams.get("sid");
  const scale = searchParams.get("scale");
  const score = searchParams.get("score") ?? "0";
  const band = searchParams.get("band") ?? "severe";

  if (!sid || !scale) return null;

  const href = `/resultado?sid=${sid}&scale=${scale}&score=${score}&band=${band}&label=${encodeURIComponent("sintomas graves")}&crisis=true`;

  return (
    <div className="border-t border-[#E2E8F0] pt-6">
      <p className="text-xs text-[#94A3B8] text-center mb-4">
        Quando você quiser, pode ver o restante do seu resultado.
      </p>
      <Link
        href={href}
        className="block text-center py-3 px-6 text-sm text-[#64748B] hover:text-[#1E293B] rounded-xl border border-[#E2E8F0] transition-colors"
      >
        Continuar quando você quiser
      </Link>
    </div>
  );
}
