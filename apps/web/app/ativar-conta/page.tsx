"use client"

import { Suspense, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AuthShell } from "@/components/public/public-chrome"
import { AlertTriangle, Eye, EyeOff, CheckCircle2 } from "lucide-react"

type Forca = "fraca" | "media" | "forte"

function calcForca(senha: string): Forca {
  if (senha.length < 8) return "fraca"
  let score = 0
  if (/[a-z]/.test(senha)) score++
  if (/[A-Z]/.test(senha)) score++
  if (/[0-9]/.test(senha)) score++
  if (/[^a-zA-Z0-9]/.test(senha)) score++
  if (senha.length >= 12 && score >= 3) return "forte"
  if (score >= 2) return "media"
  return "fraca"
}

const FORCA_CONFIG: Record<Forca, { label: string; cor: string; barras: number }> = {
  fraca: { label: "Weak", cor: "bg-destructive", barras: 1 },
  media: { label: "Medium", cor: "bg-warning", barras: 2 },
  forte: { label: "Strong", cor: "bg-success", barras: 3 },
}

function MedidorSenha({ senha }: { senha: string }) {
  if (!senha) return null
  const forca = calcForca(senha)
  const { label, cor, barras } = FORCA_CONFIG[forca]
  return (
    <div className="space-y-1.5">
      <div className="flex gap-1.5">
        {[1, 2, 3].map((n) => (
          <div
            key={n}
            className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${n <= barras ? cor : "bg-muted/30"}`}
          />
        ))}
      </div>
      <p className={`text-xs font-medium ${forca === "fraca" ? "text-destructive" : forca === "media" ? "text-warning" : "text-success"}`}>
        Password strength: {label.toLowerCase()}
      </p>
    </div>
  )
}

function AtivarContaForm() {
  const router = useRouter()
  const params = useSearchParams()
  const token = params.get("token") ?? ""

  const [senha, setSenha] = useState("")
  const [confirmar, setConfirmar] = useState("")
  const [mostrarSenha, setMostrarSenha] = useState(false)
  const [mostrarConfirmar, setMostrarConfirmar] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  if (!token) {
    return (
      <div className="flex flex-col items-center gap-3 text-center py-8">
        <AlertTriangle className="h-8 w-8 text-destructive" />
        <p className="font-medium text-foreground">Invalid link</p>
        <p className="text-sm text-muted-foreground">This activation link is invalid or has already been used.</p>
      </div>
    )
  }

  if (ok) {
    return (
      <div className="flex flex-col items-center gap-4 text-center py-8">
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-success/15 border border-success/20">
          <CheckCircle2 className="h-7 w-7 text-success" />
        </span>
        <div>
          <p className="font-semibold text-foreground text-lg">Account activated</p>
          <p className="text-sm text-muted-foreground mt-1">Your password was created successfully.</p>
        </div>
        <Button variant="coral" className="mt-2 w-full" onClick={() => router.push("/login")}>
          Go to sign in
        </Button>
      </div>
    )
  }

  async function submeter(e: React.FormEvent) {
    e.preventDefault()
    setErro(null)
    if (senha.length < 8) return setErro("Your password must contain at least 8 characters.")
    if (senha !== confirmar) return setErro("The passwords do not match.")
    setEnviando(true)
    try {
      const r = await fetch("/api/ativar-conta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, senha }),
      })
      if (r.status === 410) return setErro("This link expired. Ask the administrator for a new invitation.")
      if (!r.ok) return setErro("This link is invalid or has already been used.")
      setOk(true)
    } catch { setErro("Connection error. Please try again.") }
    finally { setEnviando(false) }
  }

  return (
    <form onSubmit={submeter} className="space-y-5">
      {erro && (
        <div role="alert" className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {erro}
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="senha">New password</Label>
        <div className="relative">
          <Input
            id="senha"
            type={mostrarSenha ? "text" : "password"}
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            placeholder="At least 8 characters"
            required
            className="pr-10"
          />
          <button
            type="button"
            onClick={() => setMostrarSenha((v) => !v)}
            aria-label={mostrarSenha ? "Hide password" : "Show password"}
            aria-pressed={mostrarSenha}
            className="absolute right-0 top-1/2 grid min-h-11 min-w-11 -translate-y-1/2 place-items-center text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {mostrarSenha ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {senha && <MedidorSenha senha={senha} />}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="confirmar">Repeat password</Label>
        <div className="relative">
          <Input
            id="confirmar"
            type={mostrarConfirmar ? "text" : "password"}
            value={confirmar}
            onChange={(e) => setConfirmar(e.target.value)}
            placeholder="Repeat your password"
            required
            className="pr-10"
          />
          <button
            type="button"
            onClick={() => setMostrarConfirmar((v) => !v)}
            aria-label={mostrarConfirmar ? "Hide password confirmation" : "Show password confirmation"}
            aria-pressed={mostrarConfirmar}
            className="absolute right-0 top-1/2 grid min-h-11 min-w-11 -translate-y-1/2 place-items-center text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {mostrarConfirmar ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {confirmar && senha !== confirmar && (
          <p className="text-xs text-destructive">The passwords do not match</p>
        )}
      </div>

      <Button type="submit" variant="coral" className="w-full" disabled={enviando || senha.length < 8 || senha !== confirmar}>
        {enviando ? "Activating…" : "Create password and activate account"}
      </Button>
    </form>
  )
}

export default function AtivarContaPage() {
  return (
    <AuthShell eyebrow="ACCOUNT ACCESS / ACTIVATION" title={<>Activate your <em>secure account.</em></>} description="Create the password that protects your Cérebro Amigo access." context={["Invitation token verified server-side", "Password strength shown before submission", "Access begins only after successful activation"]}>
      <div><Suspense><AtivarContaForm /></Suspense></div>
    </AuthShell>
  )
}
