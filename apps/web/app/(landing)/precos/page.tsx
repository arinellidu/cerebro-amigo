import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { PublicFooter, PublicHeader } from "@/components/public/public-chrome"
import { Schema, breadcrumb } from "@/components/seo/schema"
import access from "@/components/access/signal-access.module.css"
import styles from "@/components/public/public-surface.module.css"

export const metadata = {
  title: "Pricing",
  description: "Monthly Cérebro Amigo plans for psychiatrists: Essencial, Pro, and Master.",
  alternates: { canonical: "https://www.cerebroamigo.com.br/precos" },
}
const plans = [
  { name: "Essencial", price: "R$397", description: "Complete between-appointment operations, including an AI-assisted pre-appointment briefing.", features: ["Unlimited patients", "Voice journal and automated check-ins", "AI-assisted pre-appointment briefing", "PHQ-9 and GAD-7 progress views", "Video appointments", "Fixed crisis protocol and prompt controls"] },
  { name: "Pro", price: "R$597", featured: true, description: "Adds analytical agents and semantic record retrieval for heavier information work.", features: ["Everything in Essencial", "Insights from five analytical agents", "Semantic record search with RAG", "Priority support"] },
  { name: "Master", price: "R$997", description: "The complete AI layer, including consultation transcription and a factual draft of the clinical note.", features: ["Everything in Pro", "Consultation transcription", "Factual draft of clinical evolution", "Early access to advanced AI capabilities", "Dedicated onboarding"] },
]

const faqs = [
  ["How does billing work?", "Plans are billed monthly in Brazilian reais by card or Pix. There is no long-term commitment; cancellation takes effect after the already-paid cycle."],
  ["What changes between plans?", "Every plan includes the same core clinical operations and safety controls. The difference is the physician-facing AI layer: briefing in Essencial, analytical agents and semantic search in Pro, and the consultation scribe in Master."],
  ["Can I change plans later?", "Yes. You can move up or down a plan, with the change applied to the next billing cycle."],
  ["Does AI replace clinical assessment?", "No. AI organizes, summarizes, and flags information. It does not diagnose, prescribe, or replace the physician’s clinical judgment."],
  ["How is sensitive data protected?", "Controls include encryption, tenant isolation, restricted access, immutable audit trails, and LGPD-aligned processing of sensitive health data."],
  ["Can a multi-physician clinic use it?", "The listed plans cover one physician. Clinics and healthcare networks can contact the team for a tailored arrangement."],
]

const faqSchema = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faqs.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) }

export default function PricingPage() {
  return (
    <main className={`${access.page} ${styles.contentPage}`} lang="en">
      <Schema data={faqSchema} />
      <Schema data={breadcrumb([{ name: "Home", path: "/" }, { name: "Pricing", path: "/precos" }])} />
      <PublicHeader />
      <section className={styles.contentHero}>
        <div>
          <p className={styles.kicker}>PRICING / BRAZIL</p>
          <h1>One clinical core. <em>Three AI depths.</em></h1>
          <p>Monthly plans for independent physicians. Core patient follow-up and safety controls remain available across every tier.</p>
        </div>
        <dl className={styles.metaList}>
          <div><dt>Currency</dt><dd>BRL — Brazilian real</dd></div>
          <div><dt>Commitment</dt><dd>Monthly, no long-term contract</dd></div>
          <div><dt>Coverage</dt><dd>One physician per listed plan</dd></div>
        </dl>
      </section>

      <section className={styles.contentGrid}>
        <div><p className={styles.sectionLabel}>PLAN MATRIX</p><h2 className={styles.sectionTitle}>Choose the automation depth.</h2></div>
        <p className={styles.sectionCopy}>Pricing scales with physician-facing AI capabilities—not with patient access or safety. Clinical decisions remain with the physician at every tier.</p>
      </section>

      <section className={styles.plans} aria-label="Available plans">
        {plans.map((plan) => (
          <article className={`${styles.plan} ${plan.featured ? styles.featured : ""}`} key={plan.name}>
            <span className={styles.priceLabel}>{plan.featured ? "RECOMMENDED" : "MONTHLY PLAN"}</span>
            <h2>{plan.name}</h2>
            <div className={styles.price}>{plan.price}<small> / month</small></div>
            <p>{plan.description}</p>
            <ul>{plan.features.map((feature) => <li key={feature}>{feature}</li>)}</ul>
            <Link href="/medicos/cadastro">Choose {plan.name} <ArrowRight aria-hidden="true" /></Link>
          </article>
        ))}
      </section>

      <section className={styles.faq}>
        <p className={styles.sectionLabel}>QUESTIONS / ANSWERS</p>
        <h2 className={styles.sectionTitle}>Before you choose.</h2>
        {faqs.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}
      </section>
      <PublicFooter />
    </main>
  )
}
