"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { Logo } from "@/components/logo"
import { useMe } from "@/lib/use-me"
import { iniciais } from "@/lib/iniciais"
import { useLogout } from "@/lib/use-logout"
import {
  LayoutDashboard,
  Users,
  Calendar,
  MessageSquare,
  FileText,
  Bell,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Heart,
  TrendingUp,
  Wallet,
  Sparkles,
  UserCircle,
  ShieldCheck,
} from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"

const navigation = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "Pacientes", href: "/dashboard/pacientes", icon: Users },
  { name: "Agenda", href: "/dashboard/agenda", icon: Calendar },
  { name: "Mensagens", href: "/dashboard/mensagens", icon: MessageSquare },
  { name: "Prontuários", href: "/dashboard/prontuarios", icon: FileText },
  { name: "Evolução", href: "/dashboard/evolucao", icon: TrendingUp },
  { name: "Check-ins", href: "/dashboard/checkins", icon: Heart },
  { name: "Financeiro", href: "/dashboard/financeiro", icon: Wallet },
  { name: "Meu ROI", href: "/dashboard/roi", icon: Sparkles },
]

const secondaryNavigation = [
  { name: "Minha conta", href: "/dashboard/conta", icon: UserCircle },
  { name: "Lembretes", href: "/dashboard/lembretes", icon: Bell },
  { name: "Configurações", href: "/dashboard/configuracoes", icon: Settings },
]

export function Sidebar() {
  const pathname = usePathname()
  const { logout, isLoggingOut } = useLogout()
  const [collapsed, setCollapsed] = useState(false)
  const [fotoErro, setFotoErro] = useState(false)
  const me = useMe()
  const ehAdminPlataforma = me?.role === "owner" || me?.role === "admin"

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 h-screen bg-card/95 backdrop-blur-sm border-r border-border/60 transition-all duration-300 ease-out flex flex-col shadow-[2px_0_16px_rgba(15,33,55,0.04)]",
        collapsed ? "w-[72px]" : "w-64"
      )}
    >
      {/* Logo */}
      <div className="flex items-center justify-between h-[72px] px-5 border-b border-border/40">
        <Logo showText={!collapsed} size={collapsed ? "sm" : "md"} variant="light" />
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground/60 hover:text-foreground hover:bg-secondary/60 transition-colors"
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? (
            <ChevronRight className="h-3.5 w-3.5" />
          ) : (
            <ChevronLeft className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>

      {/* Main Navigation */}
      <nav className="flex-1 px-3 py-6 space-y-0.5 overflow-y-auto">
        {!collapsed && (
          <p className="px-3 pb-3 text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground/40">
            Menu
          </p>
        )}
        {navigation.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/")
          return (
            <Link
              key={item.name}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium outline-none transition-all duration-200",
                "focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-1 focus-visible:ring-offset-card",
                isActive
                  ? "bg-primary text-primary-foreground shadow-sm shadow-primary/20"
                  : "text-muted-foreground/80 hover:bg-secondary/70 hover:text-foreground",
                collapsed && "justify-center px-2"
              )}
            >
              {isActive && !collapsed && (
                <span className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-primary-foreground/70" />
              )}
              <item.icon
                className={cn(
                  "h-[18px] w-[18px] flex-shrink-0 transition-all duration-200",
                  isActive ? "text-primary-foreground" : "text-muted-foreground/60 group-hover:text-primary"
                )}
              />
              {!collapsed && <span className="tracking-[-0.01em]">{item.name}</span>}
            </Link>
          )
        })}
        {ehAdminPlataforma && (
          <div className={cn("mt-4 border-t border-border/40 pt-4", collapsed && "pt-3")}>
            {!collapsed && (
              <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground/40">
                Atalhos
              </p>
            )}
            <Link
              href="/admin"
              title={collapsed ? "Painel admin" : undefined}
              className={cn(
                "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium outline-none transition-all duration-200",
                "text-muted-foreground/80 hover:bg-secondary/70 hover:text-foreground",
                "focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-1 focus-visible:ring-offset-card",
                collapsed && "justify-center px-2",
              )}
            >
              <ShieldCheck className="h-[18px] w-[18px] flex-shrink-0 text-muted-foreground/60 transition-colors group-hover:text-primary" />
              {!collapsed && <span className="tracking-[-0.01em]">Painel admin</span>}
            </Link>
          </div>
        )}
      </nav>

      {/* Secondary Navigation */}
      <div className="px-3 py-4 border-t border-border/40 space-y-0.5">
        {!collapsed && (
          <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground/40">
            Sistema
          </p>
        )}
        {secondaryNavigation.map((item) => {
          const isActive = pathname === item.href
          return (
            <Link
              key={item.name}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium outline-none transition-all duration-200",
                "focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-1 focus-visible:ring-offset-card",
                isActive
                  ? "bg-primary text-primary-foreground shadow-sm shadow-primary/20"
                  : "text-muted-foreground/80 hover:bg-secondary/70 hover:text-foreground",
                collapsed && "justify-center px-2"
              )}
            >
              <item.icon
                className={cn(
                  "h-[18px] w-[18px] flex-shrink-0 transition-all duration-200",
                  isActive ? "text-primary-foreground" : "text-muted-foreground/60 group-hover:text-primary"
                )}
              />
              {!collapsed && <span className="tracking-[-0.01em]">{item.name}</span>}
            </Link>
          )
        })}

        {/* Logout */}
        <button
          type="button"
          onClick={logout}
          disabled={isLoggingOut}
          className={cn(
            "group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium outline-none transition-all duration-200",
            "text-muted-foreground/70 hover:bg-destructive/10 hover:text-destructive disabled:opacity-60",
            "focus-visible:ring-2 focus-visible:ring-destructive/30 focus-visible:ring-offset-1 focus-visible:ring-offset-card",
            collapsed && "justify-center px-2"
          )}
        >
          <LogOut className="h-[18px] w-[18px] flex-shrink-0 text-muted-foreground/50 group-hover:text-destructive transition-colors" />
          {!collapsed && <span className="tracking-[-0.01em]">{isLoggingOut ? "Saindo…" : "Sair"}</span>}
        </button>
      </div>

      {/* User Profile */}
      {!collapsed && (
        <div className="px-4 py-4 border-t border-border/40">
          <div className="flex items-center gap-3 px-2 py-2 rounded-lg bg-secondary/30">
            <div className="h-8 w-8 overflow-hidden rounded-full bg-gradient-to-br from-primary to-purple-dark flex items-center justify-center text-primary-foreground font-semibold text-xs shadow-sm">
              {me?.fotoUrl && !fotoErro ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={me.fotoUrl} alt="" className="h-full w-full object-cover" onError={() => setFotoErro(true)} />
              ) : (
                iniciais(me?.nome)
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground truncate">
                {me?.nome ?? "—"}
              </p>
              <p className="text-[11px] text-muted-foreground/70 truncate capitalize">
                {me?.especialidade ?? "Médico(a)"}
              </p>
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}
