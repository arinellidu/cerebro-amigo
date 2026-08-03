"use client"

// Picker de fármacos POR CLASSE terapêutica. O médico abre, expande o tipo (classe) e
// marca os medicamentos — sem digitar nem lembrar o nome. Catálogo autoritativo (A5),
// read-only; NÃO é IA. Devolve os nomes genéricos selecionados (token canônico do
// dicionário → casa melhor na checagem de interações que texto livre).

import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"
import { ListPlus, Loader2, Search } from "lucide-react"

interface MedItem {
  id: string
  nomeComercial: string | null
  nomeGenerico: string
  classeTerapeutica: string
}

export function MedicamentoPickerClasse({
  onConfirmar,
  triggerLabel = "Escolher do catálogo",
  confirmarLabel = "Verificar selecionados",
}: {
  onConfirmar: (nomes: string[]) => void
  triggerLabel?: string
  confirmarLabel?: string
}) {
  const [aberto, setAberto] = useState(false)
  const [itens, setItens] = useState<MedItem[]>([])
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState(false)
  const [filtro, setFiltro] = useState("")
  const [sel, setSel] = useState<Set<string>>(new Set()) // nomeGenerico marcados

  // Carrega o catálogo só na 1ª abertura (read-only, não muda na sessão).
  useEffect(() => {
    if (!aberto || itens.length > 0) return
    setLoading(true)
    setErro(false)
    fetch("/api/medicamentos/agrupado")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("catálogo indisponível"))))
      .then((rows: MedItem[]) => setItens(Array.isArray(rows) ? rows : []))
      .catch(() => setErro(true))
      .finally(() => setLoading(false))
  }, [aberto, itens.length])

  // Agrupa por classe, aplicando o filtro de texto (nome genérico/comercial).
  const grupos = useMemo(() => {
    const termo = filtro.trim().toLowerCase()
    const map = new Map<string, MedItem[]>()
    for (const m of itens) {
      if (
        termo &&
        !m.nomeGenerico.toLowerCase().includes(termo) &&
        !m.nomeComercial?.toLowerCase().includes(termo)
      ) {
        continue
      }
      const arr = map.get(m.classeTerapeutica) ?? []
      arr.push(m)
      map.set(m.classeTerapeutica, arr)
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], "pt-BR"))
  }, [itens, filtro])

  function toggle(nome: string) {
    setSel((prev) => {
      const next = new Set(prev)
      if (next.has(nome)) next.delete(nome)
      else next.add(nome)
      return next
    })
  }

  function limpar() {
    setSel(new Set())
    setFiltro("")
  }

  function confirmar() {
    const nomes = [...sel]
    if (nomes.length === 0) return
    onConfirmar(nomes)
    setAberto(false)
    limpar()
  }

  return (
    <Dialog
      open={aberto}
      onOpenChange={(o) => {
        setAberto(o)
        if (!o) limpar()
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="h-9 w-full gap-1.5">
          <ListPlus className="h-4 w-4" /> {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Catálogo por classe</DialogTitle>
          <DialogDescription>
            Escolha por tipo (classe terapêutica) — sem precisar lembrar o nome.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            placeholder="Filtrar por nome (opcional)"
            className="pl-9"
            autoComplete="off"
          />
        </div>

        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : erro ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Não foi possível carregar o catálogo. Tente novamente.
          </p>
        ) : grupos.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nenhum medicamento encontrado.
          </p>
        ) : (
          <ScrollArea className="h-[50vh] pr-3">
            <Accordion type="multiple" className="w-full">
              {grupos.map(([classe, meds]) => (
                <AccordionItem key={classe} value={classe}>
                  <AccordionTrigger className="text-sm">
                    <span className="flex items-center gap-2">
                      {classe}
                      <Badge variant="secondary" className="text-[10px]">
                        {meds.length}
                      </Badge>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    <ul className="space-y-0.5">
                      {meds.map((m) => (
                        <li key={m.id}>
                          <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted/50">
                            <Checkbox
                              checked={sel.has(m.nomeGenerico)}
                              onCheckedChange={() => toggle(m.nomeGenerico)}
                            />
                            <span className="text-sm text-foreground">{m.nomeGenerico}</span>
                            {m.nomeComercial && (
                              <span className="text-xs text-muted-foreground">({m.nomeComercial})</span>
                            )}
                          </label>
                        </li>
                      ))}
                    </ul>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </ScrollArea>
        )}

        <DialogFooter>
          <Button type="button" onClick={confirmar} disabled={sel.size === 0} className="gap-2">
            {confirmarLabel}
            {sel.size > 0 ? ` (${sel.size})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
