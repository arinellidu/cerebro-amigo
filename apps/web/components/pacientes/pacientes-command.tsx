"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import {
  CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem, CommandShortcut,
} from "@/components/ui/command"
import { Calendar, MessageSquare, FileText, Loader2 } from "lucide-react"
import { iniciais } from "@/lib/iniciais"

/**
 * Busca rápida de pacientes (Cmd/Ctrl+K) — navegação por teclado para o uso
 * diário. Reusa /api/pacientes (tenant via JWT); sem endpoint novo. Carrega a
 * lista na primeira abertura.
 */
interface PacienteBusca {
  id: string
  numero: number
  nome: string
  email: string | null
}

const ACOES = [
  { label: "Abrir agenda", href: "/dashboard/agenda", Icon: Calendar },
  { label: "Abrir mensagens", href: "/dashboard/mensagens", Icon: MessageSquare },
  { label: "Abrir evolução", href: "/dashboard/evolucao", Icon: FileText },
]

export function PacientesCommand({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const router = useRouter()
  const [pacientes, setPacientes] = useState<PacienteBusca[]>([])
  const [carregando, setCarregando] = useState(false)
  const [carregado, setCarregado] = useState(false)

  useEffect(() => {
    if (!open || carregado) return
    setCarregando(true)
    fetch("/api/pacientes/")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => { if (Array.isArray(d)) setPacientes(d) })
      .catch(() => {})
      .finally(() => { setCarregado(true); setCarregando(false) })
  }, [open, carregado])

  const ir = useCallback(
    (href: string) => {
      onOpenChange(false)
      router.push(href)
    },
    [onOpenChange, router],
  )

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Busca rápida"
      description="Buscar paciente ou ação"
    >
      <CommandInput placeholder="Buscar paciente por nome ou e-mail…" />
      <CommandList>
        <CommandEmpty>
          {carregando ? (
            <span className="flex items-center justify-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
            </span>
          ) : (
            "Nenhum paciente encontrado."
          )}
        </CommandEmpty>

        <CommandGroup heading="Ir para">
          {ACOES.map((a) => (
            <CommandItem key={a.href} value={`ir ${a.label}`} onSelect={() => ir(a.href)}>
              <a.Icon /> {a.label}
            </CommandItem>
          ))}
        </CommandGroup>

        {pacientes.length > 0 && (
          <CommandGroup heading="Pacientes">
            {pacientes.map((p) => (
              <CommandItem
                key={p.id}
                value={`${p.nome} ${p.email ?? ""} #${p.numero}`}
                onSelect={() => ir(`/dashboard/prontuarios/${p.id}`)}
              >
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-secondary text-[10px] font-semibold text-primary">
                  {iniciais(p.nome, "?")}
                </span>
                <span className="flex flex-col">
                  <span className="text-foreground">{p.nome}</span>
                  <span className="text-xs text-muted-foreground">
                    {p.email ?? `Paciente #${p.numero}`}
                  </span>
                </span>
                <CommandShortcut>Prontuário</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  )
}
