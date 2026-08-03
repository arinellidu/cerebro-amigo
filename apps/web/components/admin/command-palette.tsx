"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import {
  CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem, CommandShortcut,
} from "@/components/ui/command"
import {
  LayoutDashboard, Users, CreditCard, Cpu, Activity, FileText, Stethoscope, Shield, LineChart, ShieldAlert, Eye, Scale,
} from "lucide-react"

/**
 * Busca rápida do /admin (Cmd/Ctrl+K). Unifica navegação + busca de médicos/
 * usuários numa só superfície, sobre os dados que o BFF já expõe — sem endpoint
 * novo. Carrega a lista de usuários na primeira abertura.
 */
interface UsuarioBusca {
  id: string
  nome: string
  email: string
  role: string
  crm: string | null
  medicoId: string | null
}

const ROTAS = [
  { label: "Visão geral", href: "/admin", Icon: LayoutDashboard },
  { label: "Receita", href: "/admin/receita", Icon: LineChart },
  { label: "Supervisão de crise", href: "/admin/crises", Icon: ShieldAlert },
  { label: "Trilha de acesso", href: "/admin/acessos", Icon: Eye },
  { label: "Direitos do titular", href: "/admin/lgpd", Icon: Scale },
  { label: "Usuários", href: "/admin/usuarios", Icon: Users },
  { label: "Financeiro", href: "/admin/financeiro", Icon: CreditCard },
  { label: "Custos de IA", href: "/admin/custos", Icon: Cpu },
  { label: "Saúde dos agentes", href: "/admin/agentes", Icon: Activity },
  { label: "Editor de prompts", href: "/admin/prompts", Icon: FileText },
]

export function CommandPalette() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [usuarios, setUsuarios] = useState<UsuarioBusca[]>([])
  const [carregado, setCarregado] = useState(false)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [])

  useEffect(() => {
    if (!open || carregado) return
    fetch("/api/admin/usuarios")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => { if (Array.isArray(d)) setUsuarios(d) })
      .catch(() => {})
      .finally(() => setCarregado(true))
  }, [open, carregado])

  const ir = useCallback((href: string) => {
    setOpen(false)
    router.push(href)
  }, [router])

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Busca rápida" description="Buscar médico, usuário ou ação">
      <CommandInput placeholder="Buscar médico, usuário ou ação…" />
      <CommandList>
        <CommandEmpty>Nada encontrado.</CommandEmpty>
        <CommandGroup heading="Ir para">
          {ROTAS.map((r) => (
            <CommandItem key={r.href} value={`ir ${r.label}`} onSelect={() => ir(r.href)}>
              <r.Icon /> {r.label}
            </CommandItem>
          ))}
        </CommandGroup>
        {usuarios.length > 0 && (
          <CommandGroup heading="Médicos & usuários">
            {usuarios.map((u) => (
              <CommandItem
                key={u.id}
                value={`${u.nome} ${u.email} ${u.crm ?? ""}`}
                onSelect={() => ir(u.medicoId ? `/admin/medicos/${u.medicoId}` : "/admin/usuarios")}
              >
                {u.medicoId ? <Stethoscope /> : <Shield />}
                <span className="flex flex-col">
                  <span className="text-foreground">{u.nome}</span>
                  <span className="text-xs text-muted-foreground">
                    {u.email}{u.crm ? ` · CRM ${u.crm}` : ""}
                  </span>
                </span>
                <CommandShortcut>{u.role}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  )
}
