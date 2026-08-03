"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ShieldCheck, Loader2 } from "lucide-react"

interface Blindagem {
  crisesTotal: number
  crises30d: number
  examesTotal: number
  examesAtrasados: number
  renovacoesPendentes: number
  interacoesBase: number
  eventosAuditados: number
}

// Blindagem médico-legal (item 3): reembala o que a plataforma já faz pela
// proteção do médico em métricas de confiança. Read-only.
export function BlindagemCard() {
  const [d, setD] = useState<Blindagem | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/blindagem/resumo")
      .then((r) => (r.ok ? r.json() : null))
      .then(setD)
      .catch(() => setD(null))
      .finally(() => setLoading(false))
  }, [])

  return (
    <Card className="border-border/80">
      <CardHeader className="pb-1 pt-5 px-5">
        <CardTitle className="flex items-center gap-2 text-[0.9375rem] font-semibold text-foreground">
          <ShieldCheck className="h-4 w-4 text-primary" /> Blindagem médico-legal
        </CardTitle>
      </CardHeader>
      <CardContent className="px-5 pt-2 pb-4">
        {loading ? (
          <div className="flex justify-center py-6 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : !d ? (
          <p className="py-4 text-center text-xs text-muted-foreground">Indisponível.</p>
        ) : (
          <>
            <p className="mb-3 text-xs text-muted-foreground">
              Conduta documentada e rastreável — proteção em auditoria/CFM.
            </p>
            <ul className="space-y-1.5 text-sm">
              <Linha label="Protocolos de crise registrados" valor={d.crisesTotal} sub={`${d.crises30d} em 30d`} />
              <Linha label="Exames de monitoramento" valor={d.examesTotal} sub={d.examesAtrasados > 0 ? `${d.examesAtrasados} atrasados` : "em dia"} alerta={d.examesAtrasados > 0} />
              <Linha label="Renovações controladas pendentes" valor={d.renovacoesPendentes} />
              <Linha label="Interações na base de segurança" valor={d.interacoesBase} />
              <Linha label="Eventos auditados (imutável)" valor={d.eventosAuditados} />
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function Linha({ label, valor, sub, alerta }: { label: string; valor: number; sub?: string; alerta?: boolean }) {
  return (
    <li className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-baseline gap-1.5">
        <span className="font-semibold text-foreground">{valor}</span>
        {sub && <span className={`text-xs ${alerta ? "text-coral" : "text-muted-foreground"}`}>{sub}</span>}
      </span>
    </li>
  )
}
