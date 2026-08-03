"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { CrisisSupportPanel } from "@/components/portal/crisis-support-panel"

const EMOJIS = ["😣", "😟", "😕", "😐", "🙂", "😌", "😊", "😄", "😁", "🤩"]

/** Cinco níveis nomeados; valores 2–10 alinhados à escala clínica existente. */
const ANSIEDADE = [
  { valor: 2, emoji: "😌", rotulo: "Calma" },
  { valor: 4, emoji: "🙂", rotulo: "Leve" },
  { valor: 6, emoji: "😐", rotulo: "Moderada" },
  { valor: 8, emoji: "😰", rotulo: "Alta" },
  { valor: 10, emoji: "😱", rotulo: "Muito alta" },
] as const

export default function HumorPage() {
  const router = useRouter()
  const [humor, setHumor] = useState<number | null>(null)
  const [ansiedade, setAnsiedade] = useState<number | null>(null)
  const [nota, setNota] = useState("")
  const [enviando, setEnviando] = useState(false)
  const [feito, setFeito] = useState(false)
  const [erro, setErro] = useState(false)
  // Texto fixo de acolhimento de crise (vem do backend — crisis_copy, nunca editável)
  const [criseTexto, setCriseTexto] = useState<string | null>(null)

  async function registrar() {
    if (humor == null) return
    setEnviando(true)
    setErro(false)
    try {
      const r = await fetch("/api/paciente/humor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ humor, ansiedade, nota: nota || null }),
      })
      // Crise detectada na nota: registro NÃO foi salvo, mostra o acolhimento.
      const body = await r.json().catch(() => null)
      if (body?.crise && body?.crise_texto) {
        setCriseTexto(body.crise_texto)
        return
      }
      if (r.ok) {
        setFeito(true)
        setTimeout(() => router.push("/p"), 1200)
      } else {
        setErro(true)
      }
    } catch {
      setErro(true)
    } finally {
      setEnviando(false)
    }
  }

  // Acolhimento de crise (texto fixo do backend, NUNCA editável) — regra #2.
  if (criseTexto) {
    return (
      <div className="p-5 pt-9">
        <CrisisSupportPanel texto={criseTexto} onVoltar={() => router.push("/p")} />
      </div>
    )
  }

  if (feito) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 p-8 pt-24 text-center">
        <div className="humor-success-pop grid h-20 w-20 place-items-center rounded-full bg-success/10 text-success ring-1 ring-success/20">
          <Check className="h-9 w-9" />
        </div>
        <p className="portal-display text-xl font-medium text-foreground">Humor registrado!</p>
        <p className="text-sm text-muted-foreground">Obrigado por compartilhar.</p>
      </div>
    )
  }

  return (
    <div className="space-y-7 p-5 pt-9">
      <header className="portal-rise-in">
        <p className="portal-eyebrow">Check-in</p>
        <h1 className="portal-display mt-2 flex items-center gap-2 text-[1.75rem] font-medium leading-tight text-foreground">
          Como está seu humor?
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">De 1 (muito ruim) a 10 (ótimo)</p>
      </header>

      <div className="portal-rise-in portal-stagger-2 grid grid-cols-5 gap-2">
        {EMOJIS.map((e, i) => {
          const v = i + 1
          const sel = humor === v
          return (
            <button
              key={v}
              onClick={() => setHumor(v)}
              className={`portal-tap flex flex-col items-center gap-1 rounded-2xl border p-2.5 transition-all ${
                sel
                  ? "border-primary/60 bg-primary/15 shadow-[0_8px_24px_-12px_var(--noir-glow-purple)]"
                  : "border-noir-line bg-noir-surface-raised/50 hover:border-primary/40"
              }`}
            >
              <span className="text-2xl">{e}</span>
              <span
                className={`nums text-xs font-medium ${sel ? "text-primary" : "text-muted-foreground"}`}
              >
                {v}
              </span>
            </button>
          )
        })}
      </div>

      <div className="portal-rise-in portal-stagger-3 space-y-2.5">
        <div>
          <p className="text-sm font-medium text-foreground">Ansiedade hoje? (opcional)</p>
          <p className="text-xs text-muted-foreground">
            Toque no nível que mais combina com você agora.
          </p>
        </div>
        <div className="grid grid-cols-5 gap-2">
          {ANSIEDADE.map(({ valor, emoji, rotulo }) => {
            const sel = ansiedade === valor
            return (
              <button
                key={valor}
                type="button"
                aria-label={`Ansiedade ${rotulo.toLowerCase()}`}
                aria-pressed={sel}
                onClick={() => setAnsiedade(ansiedade === valor ? null : valor)}
                className={`portal-tap flex flex-col items-center gap-1 rounded-2xl border p-2.5 transition-all ${
                  sel
                    ? "border-accent/60 bg-accent/12"
                    : "border-noir-line bg-noir-surface-raised/50 hover:border-accent/40"
                }`}
              >
                <span className="text-xl">{emoji}</span>
                <span
                  className={`text-[10px] font-medium leading-tight ${
                    sel ? "text-accent" : "text-muted-foreground"
                  }`}
                >
                  {rotulo}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="portal-rise-in portal-stagger-4 space-y-2">
        <label htmlFor="nota" className="text-sm font-medium text-foreground">
          Quer escrever algo? (opcional)
        </label>
        <textarea
          id="nota"
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          rows={3}
          placeholder="Como foi seu dia…"
          className="w-full resize-none rounded-xl border border-noir-line bg-noir-surface-raised/60 p-3.5 text-sm leading-relaxed focus-visible:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        />
      </div>

      {erro && (
        <p
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          Não conseguimos salvar seu humor agora. Verifique sua conexão e tente novamente em
          instantes.
        </p>
      )}

      <Button
        onClick={registrar}
        disabled={humor == null || enviando}
        className="portal-tap h-12 w-full rounded-xl bg-primary text-base text-primary-foreground hover:bg-purple-dark"
      >
        {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Registrar humor"}
      </Button>
    </div>
  )
}
