import { Suspense } from "react"
import dynamic from "next/dynamic"
import { Header } from "@/components/header"
import { StatsCards, StatsCardsSkeleton } from "@/components/dashboard/stats-cards"
import { FilaAtencao } from "@/components/dashboard/fila-atencao"
import { AgendaWidget } from "@/components/dashboard/agenda-widget"
import { RemindersWidget } from "@/components/dashboard/reminders-widget"
import { RenovacoesWidget } from "@/components/dashboard/renovacoes-widget"
import { BlindagemCard } from "@/components/dashboard/blindagem-card"
import { PrimeirosPassos } from "@/components/dashboard/primeiros-passos"
import { MessagesWidget } from "@/components/dashboard/messages-widget"
import { CheckinWidget } from "@/components/dashboard/checkin-widget"
import { RecentPatientsWidget, RecentPatientsSkeleton } from "@/components/dashboard/recent-patients-widget"
import { getDashboard } from "@/lib/dashboard"

const EvolutionChart = dynamic(
  () => import("@/components/dashboard/evolution-chart").then((m) => m.EvolutionChart),
  { loading: () => <div className="h-[200px] animate-pulse bg-muted rounded-xl" /> }
)

// Busca real (gateway). Isolada em <Suspense> p/ não derrubar o PPR da rota.
async function RecentPatientsSection() {
  const d = await getDashboard()
  return <RecentPatientsWidget data={d.recentes} />
}

// Rótulo de banda — cria ritmo e prioridade entre as seções (escaneável).
function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-4 px-1 font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground/70">
      {children}
    </p>
  )
}

export default function DashboardPage() {
  return (
    <div className="min-h-screen">
      <Header title="Dashboard" />

      <div className="p-8 space-y-10">
        {/* Onboarding — só aparece se o médico ainda não tem pacientes */}
        <PrimeirosPassos />

        {/* Panorama (dados reais) */}
        <Suspense fallback={<StatsCardsSkeleton />}>
          <StatsCards />
        </Suspense>

        {/* HERO — o que precisa do médico AGORA. Atmosfera noir atrás p/ destacar. */}
        <section className="relative isolate">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -m-8 -z-10 aurora opacity-60 blur-2xl"
          />
          <FilaAtencao />
        </section>

        {/* Banda 1 — sinais clínicos + o dia */}
        <section>
          <Eyebrow>Sinais clínicos</Eyebrow>
          <div className="grid gap-8 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <EvolutionChart />
            </div>
            <AgendaWidget />
          </div>
        </section>

        {/* Banda 2 — pacientes & conversas */}
        <section>
          <Eyebrow>Pacientes &amp; conversas</Eyebrow>
          <div className="grid gap-8 lg:grid-cols-3">
            <Suspense fallback={<RecentPatientsSkeleton />}>
              <RecentPatientsSection />
            </Suspense>
            <MessagesWidget />
            <CheckinWidget />
          </div>
        </section>

        {/* Banda 3 — operação & alertas */}
        <section>
          <Eyebrow>Operação &amp; alertas</Eyebrow>
          <div className="grid gap-8 lg:grid-cols-3">
            <RenovacoesWidget />
            <RemindersWidget />
            <BlindagemCard />
          </div>
        </section>
      </div>
    </div>
  )
}
