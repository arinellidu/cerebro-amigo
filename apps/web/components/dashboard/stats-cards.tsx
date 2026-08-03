import { Card, CardContent } from "@/components/ui/card"
import { Users, Pill, AlertTriangle, MessageSquare } from "lucide-react"
import { getDashboard } from "@/lib/dashboard"

const delayClass = ["delay-100", "delay-200", "delay-300", "delay-400"]

export async function StatsCards() {
  const d = await getDashboard()

  const stats = [
    {
      title: "Total de Pacientes",
      value: String(d.totalPacientes),
      subtitle: `${d.ativosSemana} ativos esta semana`,
      icon: Users,
      iconBg: "bg-primary/8",
    },
    {
      title: "Prescrições Ativas",
      value: String(d.prescricoesAtivas),
      subtitle: "em acompanhamento",
      icon: Pill,
      iconBg: "bg-success/8",
    },
    {
      title: "Alertas Pendentes",
      value: String(d.insightsPendentes),
      change: d.insightsCriticos > 0 ? `${d.insightsCriticos} urgente(s)` : undefined,
      icon: AlertTriangle,
      iconBg: "bg-warning/8",
    },
    {
      title: "Pacientes Ativos (7d)",
      value: String(d.ativosSemana),
      subtitle: "com mensagem recente",
      icon: MessageSquare,
      iconBg: "bg-coral/8",
    },
  ]

  return (
    <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
      {stats.map((stat, i) => (
        <div key={stat.title} className={`animate-fade-up ${delayClass[i]}`}>
          <Card className="h-full border-border/60 hover:border-primary/25 hover:shadow-[0_8px_32px_rgba(94,75,139,0.08)] hover:-translate-y-1 transition-all duration-300 group bg-gradient-to-br from-card to-transparent">
            <CardContent className="p-6">
              <div className="flex items-start justify-between mb-5">
                <p className="text-sm font-medium text-muted-foreground/80 leading-tight">{stat.title}</p>
                <div
                  className={`h-10 w-10 rounded-xl ${stat.iconBg} flex items-center justify-center flex-shrink-0 ml-2 group-hover:scale-110 transition-transform duration-300`}
                >
                  <stat.icon className="h-[18px] w-[18px] text-primary" />
                </div>
              </div>
              <p className="text-[2rem] font-bold text-foreground leading-none mb-2 tracking-tight">{stat.value}</p>
              {stat.change && <p className="text-xs font-semibold text-warning">{stat.change}</p>}
              {stat.subtitle && (
                <p className="text-xs text-muted-foreground/70 font-medium">{stat.subtitle}</p>
              )}
            </CardContent>
          </Card>
        </div>
      ))}
    </div>
  )
}

export function StatsCardsSkeleton() {
  return (
    <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <Card key={i} className="h-full border-border/60">
          <CardContent className="p-6">
            <div className="flex items-start justify-between mb-5">
              <div className="h-4 w-24 rounded bg-muted animate-pulse" />
              <div className="h-10 w-10 rounded-xl bg-muted animate-pulse" />
            </div>
            <div className="h-8 w-16 rounded bg-muted animate-pulse mb-2" />
            <div className="h-3 w-20 rounded bg-muted animate-pulse" />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
