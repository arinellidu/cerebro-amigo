'use cache'

import { cacheLife } from 'next/cache'
import Link from "next/link"
import { Logo } from "@/components/logo"

export async function FooterSection() {
  cacheLife('days')

  return (
    <footer className="bg-noir-surface border-t border-noir-line">
      <div className="container mx-auto max-w-7xl px-6 py-14">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-10">
          <div>
            <Logo size="md" variant="light" />
            <p className="text-noir-text-dim text-sm mt-3 max-w-xs leading-relaxed">
              Acompanhamento entre consultas para psiquiatria e saúde mental.
            </p>
          </div>
          <div className="flex flex-col items-start md:items-end gap-4">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              {[
                { href: "/paciente", label: "Sou paciente" },
                { href: "/precos", label: "Preços" },
                { href: "/sobre", label: "Sobre" },
                { href: "/privacy", label: "Privacidade" },
                { href: "/terms", label: "Termos de uso" },
                { href: "/login", label: "Entrar" },
              ].map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className="text-noir-text-dim hover:text-foreground text-sm transition-colors duration-200"
                >
                  {l.label}
                </Link>
              ))}
            </div>
            <p className="text-muted-foreground text-xs">
              © 2026 Cérebro Amigo. Todos os direitos reservados.
            </p>
          </div>
        </div>
      </div>
    </footer>
  )
}
