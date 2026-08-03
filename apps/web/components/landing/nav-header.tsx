import Link from "next/link"
import { Logo } from "@/components/logo"
import { Button } from "@/components/ui/button"
import { ArrowRight } from "lucide-react"

export async function NavHeader() {
  return (
    <header className="sticky top-0 z-50">
      <div className="glass-noir border-b border-noir-line">
        <div className="container mx-auto max-w-7xl px-6 h-16 flex items-center justify-between">
          <Logo size="md" variant="light" />
          <nav className="hidden md:flex items-center gap-1">
            {[
              { href: "#como-funciona", label: "Como funciona" },
              { href: "#recursos", label: "Recursos" },
              { href: "/precos", label: "Preços" },
              { href: "/sobre", label: "Sobre" },
            ].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="relative px-4 py-2 font-mono text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors duration-200 rounded-lg hover:bg-noir-surface-raised/60"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2 sm:gap-3">
            <Button variant="ghost" className="px-3 sm:px-4 text-muted-foreground hover:text-foreground hover:bg-noir-surface-raised/60 font-medium" asChild>
              <Link href="/login">Entrar</Link>
            </Button>
            <Button variant="coral" className="px-3 sm:px-4 font-medium transition-all duration-300 hover:-translate-y-0.5" asChild>
              <Link href="/medicos/cadastro">
                <span className="sm:hidden">Criar</span>
                <span className="hidden sm:inline">Criar conta</span>
                <ArrowRight className="hidden sm:inline-block sm:ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
        {/* hairline de glow no rodapé do nav */}
        <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      </div>
    </header>
  )
}
