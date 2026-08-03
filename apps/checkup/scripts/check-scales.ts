// Gate clínico executado pelo prebuild (tsx scripts/check-scales.ts).
// Bloqueia build de produção se qualquer escala com itens definidos
// tiver validated: false.
//
// Regra: escala com items.length === 0 é stub deliberado (ex.: ASRS-18) —
// não bloqueia, mas avisa.
// Escalas com items.length > 0 e validated: false → process.exit(1).

import { phq9 } from "../src/lib/scales/phq9";
import { gad7 } from "../src/lib/scales/gad7";
import { asrs18 } from "../src/lib/scales/asrs18";
import type { Scale } from "../src/lib/scales/types";

const scales: Scale[] = [phq9, gad7, asrs18];

const blocking = scales.filter((s) => s.items.length > 0 && !s.validated);
const stubs = scales.filter((s) => s.items.length === 0 && !s.validated);

if (stubs.length > 0) {
  for (const s of stubs) {
    console.warn(`⚠️  ${s.name}: stub sem itens (validated: false) — não entra no funil.`);
  }
}

if (blocking.length > 0) {
  console.error("\n❌ Build bloqueado — escalas com itens NÃO validados:");
  for (const s of blocking) {
    console.error(`   ${s.name}: ${s.source}`);
    console.error(`   → Conferir caractere a caractere contra a publicação e marcar validated: true`);
  }
  console.error(
    "\nNenhuma escala não validada pode servir respostas em produção (CLAUDE.md §motor).\n"
  );
  process.exit(1);
}

console.log("✓ Gate clínico: todas as escalas com itens estão validadas.");
