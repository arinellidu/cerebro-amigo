"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { Logo } from "@/components/logo"
import { LayoutDashboard, Users, CreditCard, TrendingUp, LogOut, Stethoscope, ShieldCheck, FileText, Activity, LineChart, ShieldAlert, Eye, Scale, Magnet, Pill, type LucideIcon } from "lucide-react"
import { logoutAction } from "@/app/admin/actions"
import { useAdminStatus } from "@/components/admin/admin-status"

type StatusKey = "crise" | "agente"

interface NavItem {
  href: string
  label: string
  icon: LucideIcon
  exact?: boolean
  status?: StatusKey
}

// Agrupado por domínio: reduz a carga cognitiva de uma lista plana de 12 itens e
// dá prioridade visual à operação clínica (topo, com sinais de status ao vivo).
const grupos: { heading: string; items: NavItem[] }[] = [
  {
    heading: "Painel",
    items: [{ href: "/admin", label: "Visão geral", icon: LayoutDashboard, exact: true }],
  },
  {
    heading: "Operação clínica",
    items: [
      { href: "/admin/crises", label: "Supervisão de crise", icon: ShieldAlert, status: "crise" },
      { href: "/admin/agentes", label: "Agentes", icon: Activity, status: "agente" },
      { href: "/admin/interacoes", label: "Cobertura A5", icon: Pill },
    ],
  },
  {
    heading: "Aquisição & Receita",
    items: [
      { href: "/admin/aquisicao", label: "Aquisição (Check-up)", icon: Magnet },
      { href: "/admin/receita", label: "Receita", icon: LineChart },
      { href: "/admin/financeiro", label: "Financeiro", icon: CreditCard },
      { href: "/admin/custos", label: "Custos de IA", icon: TrendingUp },
    ],
  },
  {
    heading: "Conformidade",
    items: [
      { href: "/admin/acessos", label: "Trilha de acesso", icon: Eye },
      { href: "/admin/lgpd", label: "Direitos do titular", icon: Scale },
    ],
  },
  {
    heading: "Sistema",
    items: [
      { href: "/admin/prompts", label: "Prompts", icon: FileText },
      { href: "/admin/usuarios", label: "Usuários", icon: Users },
    ],
  },
]

function SecaoHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3 pb-2 pt-1 font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/40">
      {children}
    </p>
  )
}

function StatusDot({ statusKey, ativo }: { statusKey: StatusKey; ativo: boolean }) {
  const s = useAdminStatus()
  if (statusKey === "crise") {
    const n = s.crisesSemNotificacao + s.automacoesPausadas
    if (n <= 0) return null
    return (
      <span
        className={cn(
          "ml-auto grid h-4 min-w-4 animate-pulse place-items-center rounded-full px-1 text-[10px] font-bold tabular-nums",
          ativo ? "bg-primary-foreground/20 text-primary-foreground" : "bg-destructive text-white",
        )}
        title={`${n} item(ns) de crise exigem atenção`}
      >
        {n}
      </span>
    )
  }
  // agente
  if (s.agentesComErro <= 0) return null
  return (
    <span
      className={cn(
        "ml-auto grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-bold tabular-nums",
        ativo ? "bg-primary-foreground/20 text-primary-foreground" : "bg-warning text-noir-surface",
      )}
      title={`${s.agentesComErro} agente(s) com erro recente`}
    >
      {s.agentesComErro}
    </span>
  )
}

export function AdminSidebar() {
  const pathname = usePathname()

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(href + "/")

  return (
    <aside className="fixed left-0 top-0 z-40 flex h-screen w-60 flex-col border-r border-noir-line bg-noir-surface shadow-[2px_0_16px_rgba(7,7,13,0.35)]">
      {/* Logo + badge */}
      <div className="flex h-16 items-center gap-2.5 border-b border-noir-line px-5">
        <Logo size="sm" variant="light" showText={false} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">Cérebro Amigo</p>
          <p className="flex items-center gap-1 text-[10px] font-medium text-accent">
            <ShieldCheck className="h-2.5 w-2.5" /> Admin Master
          </p>
        </div>
      </div>

      {/* Nav agrupada */}
      <nav className="flex-1 space-y-3 overflow-y-auto px-3 py-5">
        {grupos.map((grupo) => (
          <div key={grupo.heading}>
            <SecaoHeading>{grupo.heading}</SecaoHeading>
            <div className="space-y-0.5">
              {grupo.items.map((item) => {
                const ativo = isActive(item.href, item.exact)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={ativo ? "page" : undefined}
                    className={cn(
                      "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium outline-none transition-all duration-200",
                      "focus-visible:ring-2 focus-visible:ring-primary/40",
                      ativo
                        ? "bg-primary text-primary-foreground shadow-sm shadow-primary/20"
                        : "text-muted-foreground hover:bg-noir-surface-raised hover:text-foreground",
                    )}
                  >
                    <item.icon
                      className={cn(
                        "h-[18px] w-[18px] shrink-0 transition-all",
                        ativo ? "text-primary-foreground" : "text-muted-foreground/60 group-hover:text-primary",
                      )}
                    />
                    <span className="truncate">{item.label}</span>
                    {item.status && <StatusDot statusKey={item.status} ativo={ativo} />}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}

        <div>
          <SecaoHeading>Atalhos</SecaoHeading>
          <Link
            href="/dashboard"
            className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-all hover:bg-noir-surface-raised hover:text-foreground"
          >
            <Stethoscope className="h-[18px] w-[18px] shrink-0 text-muted-foreground/60" />
            Dashboard médico
          </Link>
        </div>
      </nav>

      {/* Logout */}
      <div className="border-t border-noir-line px-3 py-4">
        <form action={logoutAction}>
          <button
            type="submit"
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-all hover:bg-destructive/10 hover:text-destructive"
          >
            <LogOut className="h-[18px] w-[18px] shrink-0" />
            Sair
          </button>
        </form>
      </div>
    </aside>
  )
}
