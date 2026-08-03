import { Heart, MessageCircle, BookText, Pill, Mic, Bell, Check, CalendarClock } from "lucide-react"

/**
 * Mockup do PWA do paciente (phone frame) — peça central do hero da landing
 * do paciente. Server component decorativo: markup + animações CSS, sem hooks.
 * Tokens noir. Dados mock (Maria). pointer-events-none + aria-hidden.
 */
export function PatientPreview() {
  return (
    <div aria-hidden="true" className="pointer-events-none select-none">
      <div className="relative mx-auto w-[280px]">
        {/* pill "próxima consulta" flutuante */}
        <div
          className="absolute -left-6 top-24 z-30 hidden sm:block"
          style={{ transform: "rotate(-4deg)" }}
        >
          <div className="rounded-2xl border border-noir-line glass-noir px-3.5 py-2.5 glow-coral-lg [animation:float_6s_ease-in-out_infinite]">
            <p className="flex items-center gap-1.5 text-[11px] font-medium text-foreground">
              <CalendarClock className="h-3.5 w-3.5 text-accent" /> Próxima consulta
            </p>
            <p className="mt-0.5 text-[10.5px] text-muted-foreground">qua, 14:00 · teleconsulta</p>
          </div>
        </div>

        {/* Phone frame */}
        <div className="relative overflow-hidden rounded-[2.5rem] border border-noir-line glass-noir p-2.5 glow-purple-lg">
          {/* notch */}
          <div className="absolute left-1/2 top-2.5 z-20 h-5 w-28 -translate-x-1/2 rounded-b-2xl bg-noir-bg" />
          {/* screen */}
          <div className="relative overflow-hidden rounded-[2rem] bg-noir-bg">
            <div className="space-y-3 px-4 pb-3 pt-9">
              {/* header */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[15px] font-semibold text-foreground">Olá, Maria</p>
                  <p className="text-[10.5px] text-muted-foreground">com Dra. Ana Silva</p>
                </div>
                <span className="grid h-8 w-8 place-items-center rounded-full bg-noir-surface-raised text-muted-foreground">
                  <Bell className="h-4 w-4" />
                </span>
              </div>

              {/* humor card */}
              <div className="rounded-2xl border border-primary/25 bg-primary/10 p-3.5">
                <p className="text-[12px] font-medium text-foreground">Como você está hoje?</p>
                <div className="mt-2 flex justify-between">
                  {["😣", "😕", "🙂", "😀", "🤩"].map((e, i) => (
                    <span
                      key={i}
                      className={`grid h-8 w-8 place-items-center rounded-full text-base ${
                        i === 3 ? "bg-primary/30 ring-2 ring-primary/50" : "bg-noir-surface-raised"
                      }`}
                    >
                      {e}
                    </span>
                  ))}
                </div>
              </div>

              {/* medicação */}
              <div className="flex items-center gap-3 rounded-2xl border border-noir-line bg-noir-surface-raised p-3">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-secondary text-primary">
                  <Pill className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] font-medium text-foreground">Sertralina 50mg</p>
                  <p className="text-[10.5px] text-muted-foreground">hoje, 08:00</p>
                </div>
                <span className="flex items-center gap-1 text-[10.5px] font-medium text-success">
                  <Check className="h-3 w-3" /> tomada
                </span>
              </div>

              {/* diário por voz */}
              <div className="rounded-2xl border border-noir-line bg-noir-surface-raised p-3">
                <div className="flex items-center gap-2.5">
                  <span className="grid h-8 w-8 place-items-center rounded-xl bg-primary text-primary-foreground">
                    <Mic className="h-4 w-4" />
                  </span>
                  <p className="text-[12px] font-medium text-foreground">Diário por voz</p>
                </div>
                <div className="mt-2.5 flex h-5 items-center gap-[3px]">
                  {[0, 0.12, 0.05, 0.2, 0.1, 0.28, 0.07, 0.22, 0.14, 0.3, 0.04, 0.18, 0.09, 0.24].map((d, i) => (
                    <span
                      key={i}
                      className="flex-1 rounded-sm bg-gradient-to-b from-purple-light to-primary animate-waveform"
                      style={{ animationDelay: `${d}s`, animationDuration: i % 2 ? "1.1s" : "0.9s", height: "100%" }}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* bottom nav */}
            <div className="flex justify-around border-t border-noir-line bg-noir-surface/80 py-2.5">
              {[
                { icon: Heart, label: "Início", active: true },
                { icon: MessageCircle, label: "Conversa" },
                { icon: BookText, label: "Diário" },
                { icon: Pill, label: "Medic." },
              ].map((n) => (
                <span key={n.label} className={`flex flex-col items-center gap-0.5 ${n.active ? "text-primary" : "text-muted-foreground"}`}>
                  <n.icon className="h-4 w-4" />
                  <span className="text-[8.5px]">{n.label}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
