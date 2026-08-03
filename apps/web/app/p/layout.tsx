import { Suspense } from "react"
import { headers } from "next/headers"
import Link from "next/link"
import { BookText, Heart, Pill, MessageCircle, CalendarClock } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { PortalOnboarding } from "@/components/portal/portal-onboarding"

/**
 * Shell do portal do paciente (Elevated Neural Noir). A AUTENTICAÇÃO é do
 * middleware (proxy.ts): /p/* exige `paciente_token`, exceto /p/entrar. Aqui só
 * decidimos o chrome: /p/entrar, /p/trocar-senha e /p/consulta/* renderizam sem
 * a bottom-nav. O pathname vem do header `x-pathname`.
 *
 * O acesso dinâmico (`headers()`) + o conteúdo das páginas ficam DENTRO do
 * <Suspense> — exigência do PPR (cacheComponents) para acesso a dados
 * não-cacheados (cookies/headers).
 */
export default function PortalLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="theme-noir">
      <Suspense fallback={<PortalFallback withNav />}>
        <PortalShell>{children}</PortalShell>
      </Suspense>
    </div>
  )
}

async function PortalShell({ children }: { children: React.ReactNode }) {
  const pathname = (await headers()).get("x-pathname") ?? ""
  const semChrome =
    pathname.startsWith("/p/entrar") ||
    pathname.startsWith("/p/trocar-senha") ||
    pathname.startsWith("/p/consulta/")

  if (semChrome) return <>{children}</>

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <div className="portal-aura" aria-hidden />
      <div className="relative z-10 mx-auto flex min-h-screen max-w-md flex-col">
        <main className="flex-1 pb-28">{children}</main>
        <PortalOnboarding />

        <nav
          className="fixed bottom-0 left-1/2 z-40 w-full max-w-md -translate-x-1/2 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2"
          aria-label="Navegação principal"
        >
          <div className="glass-noir relative flex items-end justify-around rounded-[1.75rem] px-1.5 py-1.5 shadow-[0_-8px_40px_-20px_rgba(0,0,0,0.9)]">
            <NavItem href="/p" label="Início" active={pathname === "/p"}>
              <Heart className="h-[1.15rem] w-[1.15rem]" />
            </NavItem>
            <NavItem href="/p/agenda" label="Agenda" active={pathname.startsWith("/p/agenda")}>
              <CalendarClock className="h-[1.15rem] w-[1.15rem]" />
            </NavItem>
            <NavConversa active={pathname.startsWith("/p/conversa")} />
            <NavItem href="/p/diario" label="Diário" active={pathname.startsWith("/p/diario")}>
              <BookText className="h-[1.15rem] w-[1.15rem]" />
            </NavItem>
            <NavItem href="/p/medicacoes" label="Meds" active={pathname.startsWith("/p/medicacoes")}>
              <Pill className="h-[1.15rem] w-[1.15rem]" />
            </NavItem>
          </div>
        </nav>
      </div>
    </div>
  )
}

function NavItem({
  href,
  label,
  active,
  children,
}: {
  href: string
  label: string
  active?: boolean
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`portal-tap relative flex min-w-[3.25rem] flex-col items-center gap-1 rounded-2xl px-2 py-1.5 transition-colors ${
        active ? "text-primary" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {active && (
        <span
          aria-hidden
          className="absolute inset-x-2 top-0 h-px bg-gradient-to-r from-transparent via-primary to-transparent"
        />
      )}
      <span
        className={`grid h-7 w-7 place-items-center rounded-xl transition-colors ${
          active ? "bg-primary/15" : "bg-transparent"
        }`}
      >
        {children}
      </span>
      <span className="text-[10px] font-medium leading-none">{label}</span>
    </Link>
  )
}

/** Tab central elevada — coração do produto entre consultas (Tier 3). */
function NavConversa({ active }: { active: boolean }) {
  return (
    <Link
      href="/p/conversa"
      className="portal-tap -mt-7 flex min-w-[4rem] flex-col items-center gap-1.5 px-1"
      aria-current={active ? "page" : undefined}
    >
      <span
        className={`portal-fab grid h-[3.4rem] w-[3.4rem] place-items-center rounded-2xl ring-4 ring-background transition-transform active:scale-95 ${
          active
            ? "bg-gradient-to-br from-primary to-purple-dark text-primary-foreground"
            : "bg-gradient-to-br from-primary/95 to-purple-dark/90 text-primary-foreground hover:from-primary hover:to-purple-dark"
        }`}
      >
        <MessageCircle className="h-6 w-6" />
      </span>
      <span
        className={`text-[10px] font-medium leading-none ${
          active ? "text-primary" : "text-muted-foreground"
        }`}
      >
        Conversa
      </span>
    </Link>
  )
}

function PortalFallback({ withNav }: { withNav?: boolean }) {
  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <div className="portal-aura" aria-hidden />
      <div className="relative z-10 mx-auto flex min-h-screen max-w-md flex-col">
        <div className="flex-1 space-y-4 p-5 pt-9">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-9 w-52" />
          <Skeleton className="h-28 rounded-[1.25rem]" />
          <Skeleton className="h-28 rounded-[1.25rem]" />
        </div>
        {withNav && (
          <div className="fixed bottom-0 left-1/2 w-full max-w-md -translate-x-1/2 px-3 pb-3 pt-2">
            <div className="glass-noir h-16 rounded-[1.75rem]" />
          </div>
        )}
      </div>
    </div>
  )
}
