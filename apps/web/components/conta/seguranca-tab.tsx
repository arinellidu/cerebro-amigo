"use client"

// ADR-066 Fase 4 — trocar senha (logado). Esqueci-senha vive em página pública.

import { useState } from "react"
import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Loader2, Check, ShieldCheck } from "lucide-react"

const ERRO: Record<string, string> = {
  senha_atual_incorreta: "Senha atual incorreta.",
  senha_curta: "A nova senha precisa ter ao menos 8 caracteres.",
}

export function SegurancaTab() {
  const [atual, setAtual] = useState("")
  const [nova, setNova] = useState("")
  const [conf, setConf] = useState("")
  const [salvando, setSalvando] = useState(false)
  const [ok, setOk] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function trocar() {
    setErro(null); setOk(false)
    if (nova.length < 8) { setErro("A nova senha precisa ter ao menos 8 caracteres."); return }
    if (nova !== conf) { setErro("As senhas não conferem."); return }
    setSalvando(true)
    try {
      const r = await fetch("/api/conta/senha", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ senhaAtual: atual, novaSenha: nova }),
      })
      if (r.ok || r.status === 204) {
        setOk(true); setAtual(""); setNova(""); setConf("")
        setTimeout(() => setOk(false), 3000)
      } else {
        const d = await r.json().catch(() => null)
        setErro(ERRO[d?.error] ?? "Não foi possível trocar a senha.")
      }
    } catch { setErro("Erro de conexão.") }
    finally { setSalvando(false) }
  }

  return (
    <Card>
      <CardContent className="p-6 space-y-4 max-w-md">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Trocar senha</h3>
        </div>
        <div className="space-y-1.5">
          <Label className="text-sm">Senha atual</Label>
          <Input type="password" value={atual} onChange={(e) => setAtual(e.target.value)} autoComplete="current-password" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-sm">Nova senha</Label>
          <Input type="password" value={nova} onChange={(e) => setNova(e.target.value)} autoComplete="new-password" placeholder="mín. 8 caracteres" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-sm">Confirmar nova senha</Label>
          <Input type="password" value={conf} onChange={(e) => setConf(e.target.value)} autoComplete="new-password" />
        </div>
        <div className="flex items-center gap-3">
          <Button disabled={salvando || !atual || !nova} onClick={trocar}>
            {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar nova senha"}
          </Button>
          {ok && <span className="flex items-center gap-1 text-sm text-success"><Check className="h-4 w-4" /> Senha alterada</span>}
          {erro && <span role="alert" className="text-sm text-destructive">{erro}</span>}
        </div>
        <p className="text-xs text-muted-foreground">
          Esqueceu a senha?{" "}
          <Link href="/esqueci-senha" className="underline underline-offset-2 hover:text-foreground">Recuperar acesso</Link>
        </p>
      </CardContent>
    </Card>
  )
}
