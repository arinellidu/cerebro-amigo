import { Sparkles, Clock, TrendingUp, ShieldCheck, MessageSquare, Mic, Check } from "lucide-react"

/**
 * Preview decorativo do hero: o BRIEFING PRÉ-CONSULTA como peça central,
 * agora flutuando em vidro no espaço noir (com o card "Diário por voz" ancorado).
 *
 * Server component: markup estático + animações CSS (sem JS/hooks), compõe com
 * o pai `'use cache'`. pointer-events-none + aria-hidden: showcase decorativo.
 * Tokens noir (herdados via .theme-noir). Dados mock — Maria Santos.
 */

const humorHistorico = [3, 3, 4, 5, 6, 6, 7]

function Sparkline({ values }: { values: number[] }) {
  const min = 1
  const max = 10
  const w = 280
  const h = 56
  const pad = 6

  const coords = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (w - pad * 2)
    const y = h - pad - ((v - min) / (max - min)) * (h - pad * 2)
    return [x, y] as const
  })
  const line = coords.map(([x, y]) => `${x},${y}`).join(" ")
  const area = `M${coords[0][0]},${h - pad} L${line.replaceAll(" ", " L")} L${coords[coords.length - 1][0]},${h - pad} Z`
  const [lastX, lastY] = coords[coords.length - 1]

  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height="52" preserveAspectRatio="none" className="overflow-visible">
      <defs>
        <linearGradient id="hero-spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.3" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#hero-spark-fill)" className="text-primary" />
      <polyline
        points={line}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinejoin="round"
        strokeLinecap="round"
        className="text-primary"
      />
      <circle cx={lastX} cy={lastY} r="4" className="fill-primary" />
      <circle cx={lastX} cy={lastY} r="7.5" className="fill-primary opacity-25" />
    </svg>
  )
}

function Tile({
  label,
  value,
  unit,
  meta,
  metaClass = "text-muted-foreground",
  metaIcon,
}: {
  label: string
  value: string
  unit?: string
  meta: string
  metaClass?: string
  metaIcon?: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-noir-line bg-noir-surface-raised p-3">
      <p className="font-mono text-[9.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold leading-none text-foreground tracking-tight">
        {value}
        {unit && <span className="text-sm font-semibold text-muted-foreground">{unit}</span>}
      </p>
      <p className={`mt-1 flex items-center gap-1 text-[10.5px] font-medium ${metaClass}`}>
        {metaIcon}
        {meta}
      </p>
    </div>
  )
}

export function HeroPreview() {
  return (
    <div aria-hidden="true" className="pointer-events-none select-none w-full lg:w-[540px]">
      <div className="relative overflow-visible pb-20 lg:pb-24">
        {/* ── Card briefing (peça central, vidro flutuante) ── */}
        <div
          className="relative z-20 overflow-hidden rounded-2xl border border-noir-line glass-noir p-5 glow-purple-lg lg:mr-8"
          style={{ transform: "rotate(-1.2deg)", transformOrigin: "top left" }}
        >
          {/* barra de topo gradient primary→coral (acende no escuro) */}
          <div className="absolute inset-x-5 top-0 h-[3px] rounded-b bg-gradient-to-r from-primary to-coral" />

          {/* topo */}
          <div className="mb-4 flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-secondary px-2.5 py-1.5 font-mono text-[11px] font-medium uppercase tracking-wide text-primary">
              <Sparkles className="h-3.5 w-3.5" />
              Briefing
            </span>
            <span className="inline-flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
              <Clock className="h-3 w-3" />
              Gerado às 08:47
            </span>
          </div>

          {/* paciente */}
          <div className="mb-4 flex items-center gap-3 border-b border-noir-line pb-4">
            <div className="grid h-11 w-11 place-items-center rounded-xl border-2 border-primary/30 bg-secondary text-[15px] font-bold text-primary">
              MS
            </div>
            <div>
              <h3 className="text-base font-semibold tracking-tight text-foreground">Maria Santos</h3>
              <p className="mt-0.5 text-[12.5px] text-muted-foreground">Retorno · hoje, 09:00</p>
            </div>
          </div>

          {/* tiles */}
          <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <Tile label="Humor" value="7" unit="/10" meta="+4 vs. última" metaClass="text-success" metaIcon={<TrendingUp className="h-2.5 w-2.5" />} />
            <Tile label="Adesão" value="95" unit="%" meta="Sertralina 50mg" />
            <Tile label="Crises" value="0" meta="desde a última" metaClass="text-success" metaIcon={<ShieldCheck className="h-2.5 w-2.5" />} />
            <Tile label="Tópicos" value="2" meta="para discutir" metaClass="text-primary" metaIcon={<MessageSquare className="h-2.5 w-2.5" />} />
          </div>

          {/* sparkline */}
          <div className="mb-4 rounded-xl bg-noir-surface-raised px-4 pb-2.5 pt-3.5">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[11.5px] font-semibold text-foreground">Evolução do humor</span>
              <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">últimos 7 dias</span>
            </div>
            <Sparkline values={humorHistorico} />
            <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
              <span>3 (início)</span>
              <span>7 (hoje)</span>
            </div>
          </div>

          {/* síntese */}
          <div className="rounded-xl border border-primary/25 bg-primary/10 p-3.5">
            <div className="mb-1.5 flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span className="text-[12px] font-semibold text-primary">Síntese do período</span>
            </div>
            <p className="text-[13px] leading-relaxed text-foreground/80">
              Melhora consistente do humor (3 → 7) na semana. Adesão de 95%, só uma dose
              perdida. Sem crises registradas. Quer falar sobre reduzir a dose e a insônia
              dos últimos 3 dias.
            </p>
          </div>
        </div>

        {/* ── Card flutuante "Diário por voz" ── */}
        <div
          className="absolute bottom-2 left-0 z-30 w-[228px] hidden sm:block"
          style={{ transform: "rotate(-3.5deg)", transformOrigin: "bottom left" }}
        >
          <div className="rounded-2xl border border-noir-line glass-noir p-3.5 glow-coral-lg [animation:float_6s_ease-in-out_infinite]">
            <div className="flex items-center gap-2.5">
              <div className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
                <Mic className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-foreground">Diário por voz</p>
                <p className="text-[11px] text-muted-foreground">paciente fala, a IA organiza</p>
              </div>
            </div>

            {/* waveform */}
            <div className="my-3 flex h-6 items-center gap-[3px]">
              {[0, 0.12, 0.05, 0.2, 0.1, 0.28, 0.07, 0.22, 0.14, 0.3, 0.04, 0.18].map((delay, i) => (
                <span
                  key={i}
                  className="flex-1 rounded-sm bg-gradient-to-b from-purple-light to-primary animate-waveform"
                  style={{ animationDelay: `${delay}s`, animationDuration: i % 2 === 0 ? "0.9s" : "1.1s", height: "100%" }}
                />
              ))}
            </div>

            <p className="text-[11.5px] italic leading-snug text-muted-foreground">
              &ldquo;essa semana consegui dormir melhor, mas a ansiedade voltou na quarta…&rdquo;
            </p>
            <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-secondary px-2 py-0.5 font-mono text-[9px] font-medium uppercase tracking-wide text-primary">
              <Check className="h-2.5 w-2.5" />
              transcrito · pt-BR
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
