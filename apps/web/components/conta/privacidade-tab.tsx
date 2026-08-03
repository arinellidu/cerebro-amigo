"use client"

// ADR-066 Fase 4 — LGPD: exportar meus dados + solicitar exclusão (soft).

import { useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Download, Trash2, Loader2, CheckCircle2, AlertTriangle } from "lucide-react"

export function PrivacidadeTab() {
  const [confirmar, setConfirmar] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [solicitado, setSolicitado] = useState(false)
  const [senha, setSenha] = useState("")
  const [erro, setErro] = useState<string | null>(null)

  async function solicitarExclusao() {
    if (!senha.trim()) { setErro("Digite sua senha para confirmar."); return }
    setErro(null); setEnviando(true)
    try {
      // Reautenticação: a exclusão exige a senha atual (ADR-066 review).
      const r = await fetch("/api/conta/exclusao", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ senhaAtual: senha }),
      })
      if (r.ok || r.status === 202) { setSolicitado(true); setConfirmar(false); setSenha("") }
      else if (r.status === 400) setErro("Senha incorreta.")
      else setErro("Não foi possível registrar o pedido. Tente novamente.")
    } catch { setErro("Erro de conexão.") }
    finally { setEnviando(false) }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-6 space-y-3">
          <h3 className="text-sm font-semibold text-foreground">Exportar meus dados</h3>
          <p className="text-sm text-muted-foreground">
            Baixe um arquivo JSON com seus dados de cadastro (perfil, assinatura, contadores).
            Não inclui conteúdo clínico de pacientes.
          </p>
          <a href="/api/conta/exportar" download>
            <Button variant="outline" className="gap-2"><Download className="h-4 w-4" /> Baixar meus dados (JSON)</Button>
          </a>
        </CardContent>
      </Card>

      <Card className="border-destructive/30">
        <CardContent className="p-6 space-y-3">
          <h3 className="text-sm font-semibold text-foreground">Solicitar exclusão da conta</h3>
          <p className="text-sm text-muted-foreground">
            Registra um pedido de exclusão dos seus dados. Registros clínicos e trilhas de
            auditoria exigidos por lei são preservados (anonimizados quando possível). A equipe
            processa o pedido e confirma por e-mail.
          </p>
          {solicitado ? (
            <p className="flex items-center gap-2 text-sm text-success"><CheckCircle2 className="h-4 w-4" /> Pedido registrado. Você receberá a confirmação por e-mail.</p>
          ) : confirmar ? (
            <div className="space-y-2">
              <p className="flex items-center gap-2 text-sm text-destructive"><AlertTriangle className="h-4 w-4" /> Tem certeza? Esta ação inicia a exclusão da sua conta.</p>
              <Input type="password" placeholder="Confirme com sua senha atual" value={senha}
                onChange={(e) => setSenha(e.target.value)} className="max-w-xs" autoComplete="current-password" />
              <div className="flex items-center gap-2">
                <Button variant="destructive" className="gap-2" disabled={enviando} onClick={solicitarExclusao}>
                  {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Confirmar pedido
                </Button>
                <Button variant="ghost" onClick={() => setConfirmar(false)}>Cancelar</Button>
              </div>
            </div>
          ) : (
            <Button variant="outline" className="gap-2 text-destructive border-destructive/40 hover:bg-destructive/10" onClick={() => setConfirmar(true)}>
              <Trash2 className="h-4 w-4" /> Solicitar exclusão
            </Button>
          )}
          {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
        </CardContent>
      </Card>
    </div>
  )
}
