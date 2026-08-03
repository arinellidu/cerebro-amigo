import Link from "next/link"
import { Logo } from "./logo"

// Rodapé do checkup: marca em evidência + atribuição explícita
// "Cérebro Amigo by Arinelli · © 2026" + disclaimer de triagem (não diagnóstico)
// e canais de crise. Três colunas no desktop, empilhado no mobile.
const TRIAGENS = [
  { href: "/depressao", label: "Teste de depressão (PHQ-9)" },
  { href: "/ansiedade", label: "Teste de ansiedade (GAD-7)" },
  { href: "/tdah-adulto", label: "Teste de TDAH adulto (ASRS-18)" },
  { href: "/bipolaridade", label: "Teste de bipolaridade (MDQ)" },
  { href: "/borderline", label: "Rastreio de borderline (MSI-BPD)" },
  { href: "/alcool", label: "Uso de álcool (AUDIT)" },
  { href: "/tabagismo", label: "Tabagismo (Fagerström)" },
  { href: "/drogas", label: "Uso de drogas (ASSIST)" },
] as const

export function SiteFooter() {
  return (
    <footer className="relative mt-24">
      <div className="hairline" aria-hidden />
      <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
        <div className="grid gap-10 md:grid-cols-[1.5fr_1fr_1.2fr]">
          {/* Marca */}
          <div className="space-y-4">
            <Logo size="md" href={null} />
            <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">
              O Check-up Mental é oferecido pelo Cérebro Amigo — a plataforma que
              ajuda psiquiatras a acompanhar pacientes entre as consultas.
            </p>
            <a
              href="https://www.cerebroamigo.com.br"
              className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-purple-light underline-offset-4 hover:underline"
            >
              Conheça a plataforma <span aria-hidden>→</span>
            </a>
          </div>

          {/* Triagens */}
          <nav aria-label="Triagens disponíveis" className="space-y-3">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Triagens
            </p>
            <ul className="space-y-1">
              {TRIAGENS.map((t) => (
                <li key={t.href}>
                  <Link
                    href={t.href}
                    className="flex min-h-[44px] items-center text-sm text-foreground/80 transition-colors hover:text-foreground"
                  >
                    {t.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          {/* Para médicos */}
          <div className="space-y-3">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Para médicos
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Seus pacientes chegam à consulta com o relatório do Check-up?
              Conheça o acompanhamento entre consultas do Cérebro Amigo.
            </p>
            <a
              href="https://www.cerebroamigo.com.br/medico?src=checkup"
              className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-purple-light underline-offset-4 hover:underline"
            >
              Sou psiquiatra <span aria-hidden>→</span>
            </a>
          </div>
        </div>

        <div className="hairline my-8" aria-hidden />

        <div className="space-y-4 text-center">
          <p className="mx-auto max-w-md text-xs leading-relaxed text-muted-foreground">
            O Check-up Mental é um instrumento de triagem — não é diagnóstico e não substitui a
            avaliação por um profissional de saúde mental. Em caso de crise, ligue{" "}
            <strong className="text-foreground">188</strong> (CVV) ou{" "}
            <strong className="text-foreground">192</strong> (SAMU).
          </p>

          <p className="text-xs text-muted-foreground">
            <a
              href="https://www.cerebroamigo.com.br"
              className="font-display text-foreground underline-offset-4 hover:underline"
            >
              Cérebro Amigo
            </a>
            <span className="mx-1.5 text-coral">•</span>
            by Arinelli
            <span className="mx-1.5">·</span>
            © 2026
          </p>
        </div>
      </div>
    </footer>
  )
}
