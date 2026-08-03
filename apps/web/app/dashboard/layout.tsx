import { Suspense } from "react"
import { Sidebar } from "@/components/sidebar"
import { PaywallGate } from "@/components/assinatura/paywall-gate"
import { FeatureUpsellProvider } from "@/components/assinatura/feature-upsell"

function SidebarWrapper() {
  return (
    <Suspense fallback={<div className="fixed left-0 top-0 z-40 h-screen w-64 bg-card border-r border-border/60" />}>
      <Sidebar />
    </Suspense>
  )
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="theme-noir min-h-screen bg-background text-foreground">
      <div className="print:hidden">
        <SidebarWrapper />
      </div>
      <main className="pl-64 min-h-screen flex flex-col transition-all duration-300 print:pl-0">
        {/* flex-col + relative flex-1: páginas normais seguem com scroll do body
            (min-h-screen cresce com o conteúdo); páginas que se pinam ao viewport
            (Mensagens) usam flex-1/min-h-0 e ocupam a altura restante DESCONTANDO
            o banner do PaywallGate (sticky, in-flow) — corrige o bloco branco sem
            número mágico (ADR-066 review). */}
        <div className="relative flex flex-1 flex-col">
          <Suspense fallback={<div className="min-h-[60vh]" />}>
            <FeatureUpsellProvider>
              <PaywallGate>{children}</PaywallGate>
            </FeatureUpsellProvider>
          </Suspense>
        </div>
      </main>
    </div>
  )
}
