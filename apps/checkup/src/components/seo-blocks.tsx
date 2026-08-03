import type { Scale } from "@/lib/scales/types"
import type { FaqItem } from "@/lib/seo/jsonld"
import { REVIEWER } from "@/lib/seo/reviewer"

// Blocos de conteúdo SEO/E-E-A-T das landings. Server components, Neural Noir.
// Regra clínica em todo texto: triagem ≠ diagnóstico, sem promessa de cura.

export function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  )
}

// Faixas do instrumento, direto do motor de escalas (nunca hardcodar cutoff).
// ASRS-18 (band única "informative") cai na prosa, sem tabela de corte.
export function InterpretationSection({ scale }: { scale: Scale }) {
  const maxScore = Math.max(...scale.bands.map((b) => b.max))
  const isInformative = scale.bands.length === 1 && scale.bands[0].band === "informative"

  return (
    <section className="mb-12">
      <h2 className="mb-3 font-display text-2xl font-semibold text-foreground">
        Como o resultado é apresentado
      </h2>
      {isInformative ? (
        <p className="leading-relaxed text-muted-foreground">
          O {scale.name.split(" ")[0]} não tem ponto de corte validado para a população
          brasileira — por isso esta triagem não classifica o resultado como
          &ldquo;positivo&rdquo; ou &ldquo;negativo&rdquo;. Suas respostas são organizadas
          num registro estruturado (com o relatório em PDF) para você levar a um
          profissional, que é quem pode interpretá-las no seu contexto.
        </p>
      ) : (
        <>
          <p className="mb-4 leading-relaxed text-muted-foreground">
            O escore vai de 0 a {maxScore} e é classificado nas faixas abaixo, definidas
            pelo próprio instrumento:
          </p>
          <div className="glass-noir overflow-hidden rounded-2xl">
            {scale.bands.map((b, i) => (
              <div
                key={b.band}
                className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3 ${i < scale.bands.length - 1 ? "border-b border-border" : ""}`}
              >
                <span className="font-mono text-sm text-purple-light">
                  {b.min}–{b.max}
                </span>
                <span className="text-sm text-foreground">{b.bandLabel}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            As faixas são do instrumento, não um veredito: só um profissional de saúde
            pode interpretar o seu resultado no seu contexto de vida.
          </p>
        </>
      )}
    </section>
  )
}

// Callout de apoio = ilha CLARA deliberada (clinical-safety): canais de crise
// sempre em fundo claro com texto escuro literal.
export function QuandoProcurarAjuda() {
  return (
    <section className="mb-12">
      <h2 className="mb-3 font-display text-2xl font-semibold text-foreground">
        Quando procurar ajuda
      </h2>
      <p className="mb-3 leading-relaxed text-muted-foreground">
        Independentemente do resultado de qualquer teste, vale procurar um profissional
        de saúde quando os sintomas duram mais de duas semanas, atrapalham trabalho,
        estudos, sono ou relações — ou quando o sofrimento está difícil de carregar
        sozinho. Você não precisa de um escore para merecer cuidado.
      </p>
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-sm leading-relaxed text-slate-700">
          Se você está em sofrimento intenso agora: <strong>CVV — 188</strong> (ligação
          gratuita, 24h) · chat em <strong>cvv.org.br</strong> ·{" "}
          <strong>SAMU — 192</strong> em emergências.
        </p>
      </div>
    </section>
  )
}

export function FaqSection({ items }: { items: FaqItem[] }) {
  return (
    <section className="mb-12">
      <h2 className="mb-5 font-display text-2xl font-semibold text-foreground">
        Perguntas frequentes
      </h2>
      <div className="space-y-3">
        {items.map((f) => (
          <details key={f.q} className="glass-noir group rounded-2xl px-5 py-4">
            <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-foreground [&::-webkit-details-marker]:hidden">
              {f.q}
              <span
                className="shrink-0 text-purple-light transition-transform group-open:rotate-45"
                aria-hidden
              >
                +
              </span>
            </summary>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{f.a}</p>
          </details>
        ))}
      </div>
    </section>
  )
}

export function CitationsBlock({ citations }: { citations: string[] }) {
  return (
    <section className="mb-12">
      <h2 className="mb-3 font-display text-2xl font-semibold text-foreground">
        Fontes e validação científica
      </h2>
      <ul className="space-y-2">
        {citations.map((c) => (
          <li key={c} className="flex gap-2.5 text-xs leading-relaxed text-muted-foreground">
            <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-purple" aria-hidden />
            <span>{c}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

// Renderiza SOMENTE quando REVIEWER for preenchido com dado real + consentimento
// (src/lib/seo/reviewer.ts). CFM: nome + CRM (+ RQE) obrigatórios em conteúdo médico.
export function ReviewerBlock() {
  if (!REVIEWER) return null
  return (
    <div className="glass-noir mb-12 flex items-center gap-3 rounded-2xl px-5 py-4">
      <span
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-purple/25 bg-purple/10 text-sm font-semibold text-purple-light"
        aria-hidden
      >
        {REVIEWER.name.charAt(0)}
      </span>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Conteúdo revisado por{" "}
        <strong className="text-foreground">{REVIEWER.name}</strong> —{" "}
        {[REVIEWER.title, REVIEWER.crm, REVIEWER.rqe].filter(Boolean).join(" · ")}
      </p>
    </div>
  )
}
