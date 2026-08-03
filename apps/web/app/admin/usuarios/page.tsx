"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog"
import { AlertTriangle, Plus, Loader2, Key, Shield, Users, RefreshCw, Stethoscope, Pencil, UserX, UserCheck, Search } from "lucide-react"
import { ErroCarregar } from "@/components/admin/erro-carregar"
import { toast } from "sonner"

// Schemas Zod para validação
const novoUsuarioSchema = z.object({
  nome: z.string().min(3, "Nome deve ter pelo menos 3 caracteres").max(100, "Nome muito longo"),
  email: z.string().email("E-mail inválido"),
  senha: z.string().min(8, "Senha deve ter pelo menos 8 caracteres").max(100, "Senha muito longa"),
  role: z.enum(["medico", "admin", "owner"]),
})

const roleSchema = z.object({
  role: z.enum(["medico", "admin", "owner"]),
})

type NovoUsuarioFormData = z.infer<typeof novoUsuarioSchema>
type RoleFormData = z.infer<typeof roleSchema>

interface Usuario {
  id: string
  nome: string
  email: string
  role: string
  ultimoLogin: string | null
  medicoId: string | null
  crm: string | null
  especialidade: string | null
  planoAssinatura: string | null
  statusAssinatura: string | null
  desativadoEm: string | null
}

const ROLE_BADGE: Record<string, string> = {
  owner: "bg-accent/20 text-accent border-accent/30",
  admin: "bg-primary/20 text-primary border-primary/30",
  medico: "bg-muted/50 text-muted-foreground border-border",
}
const ROLE_LABEL: Record<string, string> = {
  owner: "Owner (master)",
  admin: "Admin geral",
  medico: "Médico",
}

function NovoUsuarioDialog({ onCriado }: { onCriado: () => void }) {
  const [open, setOpen] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
    reset,
    setError,
  } = useForm<NovoUsuarioFormData>({
    resolver: zodResolver(novoUsuarioSchema),
    defaultValues: {
      nome: "",
      email: "",
      senha: "",
      role: "medico",
    },
  })

  const role = watch("role")

  async function submeter(data: NovoUsuarioFormData) {
    setErro(null)
    setEnviando(true)
    try {
      const r = await fetch("/api/admin/usuarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        if (d?.error === "email_em_uso") {
          setError("email", { message: "E-mail já cadastrado" })
          setErro("E-mail já cadastrado.")
        } else {
          setErro("Erro ao criar usuário.")
        }
        setEnviando(false)
        return
      }
      onCriado()
      setOpen(false)
      reset()
    } catch { setErro("Erro de conexão.") }
    finally { setEnviando(false) }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setErro(null); reset() } }}>
      <DialogTrigger asChild>
        <Button variant="coral" className="gap-2">
          <Plus className="h-4 w-4" /> Novo usuário
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Criar usuário</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(submeter)} className="space-y-4">
          {erro && (
            <div className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {erro}
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Nome</Label>
            <Input {...register("nome")} />
            {errors.nome && <p className="text-xs text-destructive">{errors.nome.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label>E-mail</Label>
            <Input type="email" {...register("email")} />
            {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label>Senha (mín. 8 chars)</Label>
            <Input type="password" {...register("senha")} />
            {errors.senha && <p className="text-xs text-destructive">{errors.senha.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label>Role</Label>
            <Select value={role} onValueChange={(v) => setValue("role", v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="medico">Médico</SelectItem>
                <SelectItem value="admin">Admin geral</SelectItem>
                <SelectItem value="owner">Owner (master)</SelectItem>
              </SelectContent>
            </Select>
            {errors.role && <p className="text-xs text-destructive">{errors.role.message}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" variant="coral" disabled={enviando}>
              {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Criar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function RoleDialog({ u, onSalvo }: { u: Usuario; onSalvo: () => void }) {
  const [open, setOpen] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const {
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
    reset,
  } = useForm<RoleFormData>({
    resolver: zodResolver(roleSchema),
    defaultValues: { role: u.role as any },
  })

  const role = watch("role")

  async function salvar(data: RoleFormData) {
    setErro(null)
    setEnviando(true)
    try {
      const r = await fetch(`/api/admin/usuarios/${u.id}?action=role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: data.role }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        const map: Record<string, string> = {
          nao_pode_desativar_owner: "Não é possível rebaixar o último owner.",
          nao_pode_alterar_propria_role: "Você não pode alterar a própria role.",
        }
        return setErro(map[d?.error] ?? "Não foi possível atualizar a role deste usuário. Tente novamente.")
      }
      const anterior = u.role
      onSalvo(); setOpen(false)
      if (data.role !== anterior) {
        toast.success(`Role de ${u.nome} alterada para ${data.role}.`, {
          action: {
            label: "Desfazer",
            onClick: async () => {
              const rr = await fetch(`/api/admin/usuarios/${u.id}?action=role`, {
                method: "PATCH", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ role: anterior }),
              })
              if (rr.ok) { toast.success(`Role de ${u.nome} revertida para ${anterior}.`); onSalvo() }
              else toast.error("Não foi possível desfazer.")
            },
          },
        })
      } else {
        toast.success("Role atualizada.")
      }
    } catch { setErro("Erro de conexão.") }
    finally { setEnviando(false) }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setErro(null); reset({ role: u.role as any }) } }}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary" title="Mudar role">
          <Shield className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xs">
        <DialogHeader><DialogTitle>Mudar role — {u.nome}</DialogTitle></DialogHeader>
        {erro && <p className="text-sm text-destructive">{erro}</p>}
        <form onSubmit={handleSubmit(salvar)} className="space-y-3">
          <Select value={role} onValueChange={(v) => setValue("role", v as any)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="medico">Médico</SelectItem>
              <SelectItem value="admin">Admin geral</SelectItem>
              <SelectItem value="owner">Owner (master)</SelectItem>
            </SelectContent>
          </Select>
          {errors.role && <p className="text-xs text-destructive">{errors.role.message}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" variant="coral" disabled={enviando}>
              {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function EditarDialog({ u, onSalvo }: { u: Usuario; onSalvo: () => void }) {
  const [open, setOpen] = useState(false)
  const [nome, setNome] = useState(u.nome)
  const [email, setEmail] = useState(u.email)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function salvar() {
    setErro(null)
    if (nome.trim().length < 3) return setErro("Nome mínimo 3 caracteres.")
    if (!email.includes("@")) return setErro("E-mail inválido.")
    setEnviando(true)
    try {
      const r = await fetch(`/api/admin/usuarios/${u.id}?action=perfil`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: nome.trim(), email: email.trim() }),
      })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        return setErro(d?.error === "email_em_uso" ? "E-mail já cadastrado." : "Erro ao salvar.")
      }
      onSalvo(); setOpen(false)
    } catch { setErro("Erro de conexão.") }
    finally { setEnviando(false) }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setErro(null); setNome(u.nome); setEmail(u.email) } }}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary" title="Editar nome/e-mail">
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xs">
        <DialogHeader><DialogTitle>Editar — {u.nome}</DialogTitle></DialogHeader>
        {erro && <p className="text-sm text-destructive">{erro}</p>}
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Nome</Label>
            <Input value={nome} onChange={(e) => setNome(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>E-mail</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button variant="coral" onClick={salvar} disabled={enviando}>
            {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ExcluirDialog({ u, onExcluido }: { u: Usuario; onExcluido: () => void }) {
  const [open, setOpen] = useState(false)
  const [excluindo, setExcluindo] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function excluir() {
    setErro(null)
    setExcluindo(true)
    try {
      const r = await fetch(`/api/admin/usuarios/${u.id}`, { method: "DELETE" })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        const map: Record<string, string> = {
          nao_pode_desativar_propria_conta: "Você não pode desativar a própria conta.",
          nao_pode_desativar_owner: "Não é possível desativar um owner.",
        }
        return setErro(map[d?.error] ?? "Não foi possível desativar este usuário. Tente novamente.")
      }
      onExcluido()
      setOpen(false)
      toast.success(`${u.nome} desativado.`, {
        action: {
          label: "Desfazer",
          onClick: async () => {
            const rr = await fetch(`/api/admin/usuarios/${u.id}`, { method: "POST" })
            if (rr.ok) { toast.success(`${u.nome} reativado.`); onExcluido() }
            else toast.error("Não foi possível desfazer.")
          },
        },
      })
    } catch { setErro("Erro de conexão.") }
    finally { setExcluindo(false) }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); setErro(null) }}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" title="Desativar usuário">
          <UserX className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <UserX className="h-4 w-4" /> Desativar usuário
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Desativar <span className="font-semibold text-foreground">{u.nome}</span>? O usuário não poderá
          mais entrar e sairá da lista. Os dados clínicos são preservados; dá para reativar depois.
        </p>
        {erro && (
          <div className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {erro}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button variant="destructive" onClick={excluir} disabled={excluindo}>
            {excluindo ? <Loader2 className="h-4 w-4 animate-spin" /> : "Desativar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SenhaDialog({ u, onSalvo }: { u: Usuario; onSalvo: () => void }) {
  const [open, setOpen] = useState(false)
  const [senha, setSenha] = useState("")
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  async function salvar() {
    setErro(null)
    if (senha.length < 8) return setErro("Mínimo 8 caracteres")
    setEnviando(true)
    try {
      const r = await fetch(`/api/admin/usuarios/${u.id}?action=senha`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ novaSenha: senha }),
      })
      if (!r.ok) return setErro("Erro ao atualizar.")
      setOk(true); setSenha("")
      setTimeout(() => { setOpen(false); setOk(false) }, 1500)
    } catch { setErro("Erro de conexão.") }
    finally { setEnviando(false) }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); setErro(null); setSenha(""); setOk(false) }}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary" title="Trocar senha">
          <Key className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xs">
        <DialogHeader><DialogTitle>Nova senha — {u.nome}</DialogTitle></DialogHeader>
        {erro && <p className="text-sm text-destructive">{erro}</p>}
        {ok && <p className="text-sm text-success">Senha atualizada!</p>}
        <Input type="password" placeholder="Nova senha (mín. 8 chars)" value={senha} onChange={(e) => setSenha(e.target.value)} />
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button variant="coral" onClick={salvar} disabled={enviando}>
            {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ReativarDialog({ u, onReativado }: { u: Usuario; onReativado: () => void }) {
  const [open, setOpen] = useState(false)
  const [reativando, setReativando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function reativar() {
    setErro(null)
    setReativando(true)
    try {
      const r = await fetch(`/api/admin/usuarios/${u.id}`, { method: "POST" })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        const map: Record<string, string> = {
          limite_usuarios_atingido: "Limite de usuários ativos atingido para este plano.",
        }
        return setErro(map[d?.error] ?? "Não foi possível reativar este usuário. Tente novamente.")
      }
      onReativado()
      setOpen(false)
      toast.success(`${u.nome} reativado.`)
    } catch { setErro("Erro de conexão.") }
    finally { setReativando(false) }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); setErro(null) }}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs text-success hover:text-success" title="Reativar usuário">
          <UserCheck className="h-3.5 w-3.5" /> Reativar
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-success">
            <UserCheck className="h-4 w-4" /> Reativar usuário
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Reativar <span className="font-semibold text-foreground">{u.nome}</span>? O usuário voltará a ter acesso à plataforma.
        </p>
        {erro && (
          <div className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {erro}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button variant="coral" onClick={reativar} disabled={reativando}>
            {reativando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Reativar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default function UsuariosPage() {
  const [aba, setAba] = useState<"ativos" | "desativados">("ativos")
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [desativados, setDesativados] = useState<Usuario[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingDesativados, setLoadingDesativados] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [erroDesativados, setErroDesativados] = useState<string | null>(null)
  const [meId, setMeId] = useState<string | null>(null)
  const [isOwner, setIsOwner] = useState(false)
  const [busca, setBusca] = useState("")
  const [roleFiltro, setRoleFiltro] = useState("todos")

  const carregar = useCallback(async () => {
    setLoading(true); setErro(null)
    try {
      const r = await fetch("/api/admin/usuarios")
      if (r.status === 401) { window.location.href = "/login"; return }
      if (!r.ok) { setErro("Não foi possível carregar os usuários."); return }
      setUsuarios(await r.json())
    } catch {
      setErro("Erro de conexão ao carregar os usuários.")
    } finally {
      setLoading(false)
    }
  }, [])

  const carregarDesativados = useCallback(async () => {
    setLoadingDesativados(true); setErroDesativados(null)
    try {
      const r = await fetch("/api/admin/usuarios?desativados=true")
      if (r.status === 401) { window.location.href = "/login"; return }
      if (!r.ok) { setErroDesativados("Não foi possível carregar os usuários desativados."); return }
      setDesativados(await r.json())
    } catch {
      setErroDesativados("Erro de conexão ao carregar os usuários desativados.")
    } finally {
      setLoadingDesativados(false)
    }
  }, [])

  useEffect(() => {
    carregar()
    fetch("/api/me").then(r => r.ok ? r.json() : null).then(d => {
      if (d) { setMeId(d.usuarioId); setIsOwner(d.role === "owner") }
    })
  }, [carregar])

  function handleAba(nova: "ativos" | "desativados") {
    setAba(nova)
    if (nova === "desativados") carregarDesativados()
  }

  const usuariosFiltrados = usuarios.filter((u) => {
    const q = busca.trim().toLowerCase()
    if (q && !`${u.nome ?? ""} ${u.email ?? ""} ${u.crm ?? ""}`.toLowerCase().includes(q)) return false
    if (roleFiltro !== "todos" && u.role !== roleFiltro) return false
    return true
  })

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Users className="h-5 w-5 text-primary" />
            <p className="font-mono text-xs uppercase tracking-widest text-primary">Gestão</p>
          </div>
          <h1 className="text-2xl font-semibold text-foreground">Usuários</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {aba === "ativos" ? `${usuarios.length} ativo(s)` : `${desativados.length} desativado(s)`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="glass" size="sm"
            onClick={aba === "ativos" ? carregar : carregarDesativados}
            className="gap-1.5">
            <RefreshCw className="h-4 w-4" /> Atualizar
          </Button>
          {aba === "ativos" && <NovoUsuarioDialog onCriado={carregar} />}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-noir-line">
        {(["ativos", "desativados"] as const).map((t) => (
          <button
            key={t}
            onClick={() => handleAba(t)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              aba === t
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "ativos" ? "Ativos" : "Desativados"}
          </button>
        ))}
      </div>

      {aba === "ativos" ? (
        loading ? (
          <div className="flex justify-center py-16 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : erro ? (
          <ErroCarregar mensagem={erro} onRetry={carregar} />
        ) : (
          <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome, e-mail ou CRM" className="pl-9" />
            </div>
            <Select value={roleFiltro} onValueChange={setRoleFiltro}>
              <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["todos", "owner", "admin", "medico"].map((r) => (
                  <SelectItem key={r} value={r}>{r === "todos" ? "Todas as roles" : r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="ml-auto text-xs text-muted-foreground">{usuariosFiltrados.length} de {usuarios.length}</span>
          </div>
          <div className="rounded-2xl border border-noir-line bg-noir-surface overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-noir-line bg-noir-surface-raised">
                  {["Nome", "E-mail", "Role", "CRM", "Plano", "Último login", "Ações"].map((h) => (
                    <th key={h} className="px-5 py-3 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-noir-line">
                {usuariosFiltrados.length === 0 ? (
                  <tr><td colSpan={7} className="px-5 py-12 text-center text-sm text-muted-foreground">Nenhum usuário para o filtro.</td></tr>
                ) : usuariosFiltrados.map((u) => (
                  <tr key={u.id} className="hover:bg-noir-surface-raised/40 transition-colors">
                    <td className="px-5 py-3 font-medium text-foreground">{u.nome}</td>
                    <td className="px-5 py-3 text-muted-foreground">{u.email}</td>
                    <td className="px-5 py-3">
                      <Badge className={`border font-mono text-[10px] uppercase ${ROLE_BADGE[u.role] ?? ""}`}>
                        {ROLE_LABEL[u.role] ?? u.role}
                      </Badge>
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">{u.crm ?? "—"}</td>
                    <td className="px-5 py-3">
                      {u.planoAssinatura ? (
                        <span className={`text-xs font-medium ${u.statusAssinatura === "ativa" ? "text-success" : "text-muted-foreground"}`}>
                          {u.planoAssinatura} · {u.statusAssinatura}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">sem assinatura</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-muted-foreground text-xs">
                      {u.ultimoLogin ? new Date(u.ultimoLogin).toLocaleDateString("pt-BR") : "nunca"}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1">
                        {u.medicoId && (
                          <Link href={`/admin/medicos/${u.medicoId}`} title="Ver perfil do médico">
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <Stethoscope className="h-4 w-4" />
                            </Button>
                          </Link>
                        )}
                        <EditarDialog u={u} onSalvo={carregar} />
                        {isOwner && <RoleDialog u={u} onSalvo={carregar} />}
                        <SenhaDialog u={u} onSalvo={carregar} />
                        {u.id !== meId && u.role !== "owner" && (
                          <ExcluirDialog u={u} onExcluido={carregar} />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )
      ) : (
        loadingDesativados ? (
          <div className="flex justify-center py-16 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : erroDesativados ? (
          <ErroCarregar mensagem={erroDesativados} onRetry={carregarDesativados} />
        ) : desativados.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
            <UserX className="h-8 w-8 opacity-30" />
            <p className="text-sm">Nenhum usuário desativado.</p>
          </div>
        ) : (
          <div className="rounded-2xl border border-noir-line bg-noir-surface overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-noir-line bg-noir-surface-raised">
                  {["Nome", "E-mail", "Role", "CRM", "Desativado em", "Ações"].map((h) => (
                    <th key={h} className="px-5 py-3 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-noir-line">
                {desativados.map((u) => (
                  <tr key={u.id} className="hover:bg-noir-surface-raised/40 transition-colors opacity-75">
                    <td className="px-5 py-3 font-medium text-foreground">{u.nome}</td>
                    <td className="px-5 py-3 text-muted-foreground">{u.email}</td>
                    <td className="px-5 py-3">
                      <Badge className={`border font-mono text-[10px] uppercase ${ROLE_BADGE[u.role] ?? ""}`}>
                        {ROLE_LABEL[u.role] ?? u.role}
                      </Badge>
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">{u.crm ?? "—"}</td>
                    <td className="px-5 py-3 text-muted-foreground text-xs">
                      {u.desativadoEm ? new Date(u.desativadoEm).toLocaleDateString("pt-BR") : "—"}
                    </td>
                    <td className="px-5 py-3">
                      <ReativarDialog u={u} onReativado={() => { carregarDesativados(); carregar() }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  )
}
