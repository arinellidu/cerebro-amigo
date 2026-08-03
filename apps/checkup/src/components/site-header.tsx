import Link from "next/link"
import { Logo } from "./logo"
import { TestsMenu } from "./tests-menu"
import { MobileNav } from "./mobile-nav"

// Header calmo do checkup — logo do Cérebro Amigo em destaque. Sem drama
// (clinical-safety: público pode estar em sofrimento). Sticky discreto,
// vidro noir, hairline embaixo. Nav direto p/ as triagens (conversão).
const NAV = [
  { href: "/depressao", label: "Depressão" },
  { href: "/ansiedade", label: "Ansiedade" },
  { href: "/tdah-adulto", label: "TDAH adulto" },
] as const

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 glass-noir">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:gap-4 sm:px-6">
        <Logo size="md" />

        <nav aria-label="Triagens" className="hidden items-center gap-6 md:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {item.label}
            </Link>
          ))}
          <TestsMenu />
        </nav>

        {/* Badge → só desktop. No mobile o link "Conheça o Cérebro Amigo"
            vive dentro do MobileNav (drawer), liberando o header estreito. */}
        <a
          href="https://www.cerebroamigo.com.br"
          className="hidden min-h-[36px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-[var(--noir-glass-border)] bg-secondary/50 px-3.5 py-1.5 text-xs font-medium text-secondary-foreground transition-colors hover:border-purple hover:text-foreground md:inline-flex"
        >
          Conheça o Cérebro Amigo
          <span aria-hidden>→</span>
        </a>

        <MobileNav />
      </div>
      <div className="hairline" aria-hidden />
    </header>
  )
}
