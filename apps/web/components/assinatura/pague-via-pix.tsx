"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Wallet, Copy, Check, ExternalLink } from "lucide-react"

/**
 * Painel de pagamento manual (ADR-055, modo bootstrap — enquanto o Asaas prod não
 * está no ar). Mostra: um botão de **link de pagamento** (ex.: Mercado Pago) e/ou a
 * **chave Pix** da plataforma. O médico paga; o admin libera depois em
 * /admin/financeiro (status='ativa'). Runbook `ativacao-manual-assinatura.md`.
 *
 * Renderiza só se ao menos uma das envs estiver setada (build-time):
 *   NEXT_PUBLIC_MANUAL_PAGAMENTO_URL  — link de checkout (Mercado Pago / outro)
 *   NEXT_PUBLIC_MANUAL_PIX_CHAVE      — chave Pix (pública/compartilhável)
 *   NEXT_PUBLIC_MANUAL_PIX_NOME       — nome do recebedor (opcional)
 * Nenhuma setada → null (volta ao self-checkout Asaas).
 */
const CHAVE = process.env.NEXT_PUBLIC_MANUAL_PIX_CHAVE
const NOME = process.env.NEXT_PUBLIC_MANUAL_PIX_NOME
const PAG_URL = process.env.NEXT_PUBLIC_MANUAL_PAGAMENTO_URL

export const MANUAL_PIX_ATIVO = !!(CHAVE || PAG_URL)

const brl = (n?: number) =>
  n != null ? `R$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` : null

export function PagueViaPix({ valor }: { valor?: number }) {
  const [copiado, setCopiado] = useState(false)
  if (!CHAVE && !PAG_URL) return null

  async function copiar() {
    try {
      await navigator.clipboard.writeText(CHAVE!)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch {
      /* clipboard indisponível — a chave segue visível para cópia manual */
    }
  }

  return (
    <div className="space-y-3 rounded-2xl border border-primary/30 bg-primary/5 p-5">
      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Wallet className="h-5 w-5 text-primary" /> Pague sua assinatura
      </div>
      <p className="text-xs text-muted-foreground">
        {valor != null ? (
          <>
            Valor: <span className="font-medium text-foreground">{brl(valor)}</span>/mês.{" "}
          </>
        ) : null}
        Pague pelo botão ou pela chave abaixo. Após o pagamento, seu acesso é liberado
        (em até algumas horas).
      </p>

      {PAG_URL && (
        <a href={PAG_URL} target="_blank" rel="noreferrer" className="block">
          <Button variant="coral" className="w-full gap-2">
            <Wallet className="h-4 w-4" /> Pagar no Mercado Pago{" "}
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        </a>
      )}

      {CHAVE && (
        <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-background/60 p-3">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              Chave Pix{NOME ? ` · ${NOME}` : ""}
            </p>
            <p className="truncate text-sm font-medium text-foreground">{CHAVE}</p>
          </div>
          <Button size="sm" variant="outline" className="h-8 shrink-0 gap-1.5" onClick={copiar}>
            {copiado ? (
              <>
                <Check className="h-3.5 w-3.5" /> copiado
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" /> copiar
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  )
}
