"use client"

import { Suspense, useCallback, useEffect, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AuthShell } from "@/components/public/public-chrome"
import { Turnstile, type TurnstileHandle } from "@/components/turnstile"
import { CheckCircle2, AlertTriangle, Loader2 } from "lucide-react"

const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG",
  "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
]

const ERRO_MSG: Record<string, string> = {
  campos_obrigatorios: "Complete every required field.",
  crm_uf_obrigatorio: "Select the Brazilian state for your CRM registration.",
  email_em_uso: "This email is already registered. Try signing in.",
  crm_invalido: "The CRM registration was not found or is not in good standing with CFM.",
  nome_divergente: "The name does not match the CFM record for this CRM registration.",
  crm_indisponivel: "CRM validation is temporarily unavailable. Try again shortly.",
  crm_validacao_nao_configurada: "CRM validation is currently unavailable. Try again later.",
  cpf_obrigatorio: "Enter your CPF to complete registration.",
  cpf_invalido: "Invalid CPF. Check the digits.",
  rate_limited: "Too many attempts. Wait a few minutes and try again.",
  captcha_invalido: "Security verification failed. Reload the page and try again.",
  erro_interno: "Something went wrong. Please try again.",
}

function CadastroForm() {
  const params = useSearchParams()
  const src = params.get("src")
  const rid = params.get("rid")
  const fromCheckup = src === "checkup" && !!rid

  const [nome, setNome] = useState("")
  const [email, setEmail] = useState("")
  const [crm, setCrm] = useState("")
  const [crmUf, setCrmUf] = useState("")
  const [cpf, setCpf] = useState("")
  const [consent, setConsent] = useState(false)
  const [estado, setEstado] = useState<"idle" | "enviando" | "ok" | "erro">("idle")
  const [erro, setErro] = useState<string | null>(null)
  const eventFired = useRef(false)

  // Captcha (ADR-055): só exigido quando há site key (senão, captcha desligado).
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const turnstileRef = useRef<TurnstileHandle>(null)
  const handleToken = useCallback((t: string | null) => setTurnstileToken(t), [])
  // Token é single-use: após um submit que falhou, rearma o widget p/ permitir reenvio.
  const resetCaptcha = useCallback(() => {
    setTurnstileToken(null)
    turnstileRef.current?.reset()
  }, [])

  // doctor_signup_started: 1x ao abrir o form vindo do Check-up (atribuição).
  useEffect(() => {
    if (!fromCheckup || eventFired.current) return
    eventFired.current = true
    fetch("/api/checkup-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "doctor_signup_started", rid }),
    }).catch(() => {})
  }, [fromCheckup, rid])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErro(null)
    if (!nome.trim() || !email.trim() || !crm.trim() || !crmUf || !cpf.trim()) {
      setErro(ERRO_MSG.campos_obrigatorios)
      return
    }
    if (!consent) {
      setErro("You must consent to professional-data processing to continue.")
      return
    }
    if (siteKey && !turnstileToken) {
      setErro("Complete the security verification before continuing.")
      return
    }
    setEstado("enviando")
    try {
      const r = await fetch("/api/medico-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: nome.trim(),
          email: email.trim(),
          crm: crm.trim(),
          crmUf,
          cpf: cpf.trim(),
          src: fromCheckup ? "checkup" : null,
          rid: fromCheckup ? rid : null,
          turnstileToken,
        }),
      })
      if (r.status === 202) {
        setEstado("ok")
        return
      }
      const data = await r.json().catch(() => ({}))
      const code = r.status === 429 ? "rate_limited" : (data?.error ?? "erro_interno")
      setErro(ERRO_MSG[code] ?? data?.mensagem ?? ERRO_MSG.erro_interno)
      setEstado("erro")
      resetCaptcha()
    } catch {
      setErro(ERRO_MSG.erro_interno)
      setEstado("erro")
      resetCaptcha()
    }
  }

  if (estado === "ok") {
    return (
      <div className="text-center space-y-4">
        <CheckCircle2 className="mx-auto h-12 w-12 text-success" aria-hidden />
        <h2 className="text-2xl font-semibold text-foreground">Check your email</h2>
        <p className="text-muted-foreground">
          We sent a link to <strong>{email}</strong> so you can create a password and activate access.
          The link is valid for 24 hours.
        </p>
        <p className="text-sm text-muted-foreground">
          Nothing arrived? Check your spam folder or try again in a few minutes.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <div className="space-y-1.5 text-center">
        <h2 className="text-2xl font-semibold text-foreground">Physician registration</h2>
        <p className="text-sm text-muted-foreground">
          We validate your CRM registration with CFM, then email you an activation link.
        </p>
      </div>

      {erro && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{erro}</span>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="nome">Full name</Label>
        <Input id="nome" value={nome} onChange={(e) => setNome(e.target.value)}
          autoComplete="name" placeholder="Exactly as registered with CFM" required />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          autoComplete="email" placeholder="you@example.com" required />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="crm">CRM</Label>
          <Input id="crm" value={crm} onChange={(e) => setCrm(e.target.value)}
            inputMode="numeric" placeholder="CRM number" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="crmUf">UF</Label>
          <select id="crmUf" value={crmUf} onChange={(e) => setCrmUf(e.target.value)} required
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
            <option value="" disabled>UF</option>
            {UFS.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
          </select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="cpf">CPF <span className="text-muted-foreground font-normal">(required for billing)</span></Label>
        <Input id="cpf" value={cpf} onChange={(e) => setCpf(e.target.value)} required
          inputMode="numeric" placeholder="Digits only" autoComplete="off" />
      </div>

      <label className="flex items-start gap-2 text-sm text-muted-foreground">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-input" />
        <span>
          I consent to the processing of my professional data (CRM, name, and email) for
          validation and account creation under Brazil’s LGPD.
        </span>
      </label>

      {siteKey && <Turnstile ref={turnstileRef} siteKey={siteKey} onToken={handleToken} />}

      <Button type="submit" className="w-full" disabled={estado === "enviando" || (!!siteKey && !turnstileToken)}>
        {estado === "enviando" && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
        {estado === "enviando" ? "Validating CRM…" : "Create account"}
      </Button>

      <p className="text-center text-xs text-muted-foreground">
        Already registered? <a href="/login" className="underline">Sign in</a>
      </p>
    </form>
  )
}

export default function CadastroMedicoPage() {
  return (
    <AuthShell eyebrow="PHYSICIAN ACCESS / REGISTRATION" title={<>Create a verified <em>physician account.</em></>} description="Registration is currently available to Brazilian physicians with an active CRM record." context={["CRM and identity validation through CFM", "Activation link delivered by email", "Monthly plans billed in Brazilian reais"]}>
      <div><Suspense fallback={<div className="text-center text-sm text-muted-foreground">Loading…</div>}><CadastroForm /></Suspense></div>
    </AuthShell>
  )
}
