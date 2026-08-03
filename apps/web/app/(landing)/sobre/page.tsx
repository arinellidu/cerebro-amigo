import Link from "next/link"
import { ArrowRight, Code2, HeartHandshake, ShieldCheck } from "lucide-react"
import { PublicFooter, PublicHeader } from "@/components/public/public-chrome"
import { Schema, breadcrumb, orgSchema } from "@/components/seo/schema"
import access from "@/components/access/signal-access.module.css"
import styles from "@/components/public/public-surface.module.css"

export const metadata = {
  title: "About",
  description: "The lived experience, engineering decisions, and human boundaries behind Cérebro Amigo.",
  alternates: { canonical: "https://www.cerebroamigo.com.br/sobre" },
}
const founderSchema = {
  "@context": "https://schema.org",
  "@type": "Person",
  name: "Patrick Arinelli",
  jobTitle: "Founder and software engineer",
  url: "https://www.cerebroamigo.com.br/sobre",
  worksFor: { "@type": "Organization", name: "Cérebro Amigo" },
}

const principles = [
  { icon: HeartHandshake, title: "Built from lived experience", copy: "The product began with a practical question: how can the weeks between appointments become clearer for both patient and physician?" },
  { icon: ShieldCheck, title: "Human authority by design", copy: "AI structures, summarizes, and flags information. It does not diagnose, prescribe, or replace clinical judgment." },
  { icon: Code2, title: "Evidence in the implementation", copy: "Architecture decisions, tenant isolation, audit trails, and service boundaries are visible in the code—not hidden behind marketing claims." },
]

export default function AboutPage() {
  return (
    <main className={`${access.page} ${styles.contentPage}`} lang="en">
      <Schema data={orgSchema} />
      <Schema data={founderSchema} />
      <Schema data={breadcrumb([{ name: "Home", path: "/" }, { name: "About", path: "/sobre" }])} />
      <a className={access.skipLink} href="#about">Skip to story</a>
      <PublicHeader />

      <section className={styles.contentHero} id="about">
        <div>
          <p className={styles.kicker}>ORIGIN / HUMAN CONTEXT</p>
          <h1>Built by someone who <em>lives it.</em></h1>
          <p>Cérebro Amigo connects lived experience in psychiatric care with production-grade software engineering.</p>
        </div>
        <dl className={styles.metaList}>
          <div><dt>Founder</dt><dd>Patrick Arinelli</dd></div>
          <div><dt>Role</dt><dd>Software engineer and patient</dd></div>
          <div><dt>Public evidence</dt><dd>Code, ADRs, architecture, functional demo</dd></div>
        </dl>
      </section>

      <section className={styles.contentGrid}>
        <div>
          <p className={styles.sectionLabel}>THE QUESTION</p>
          <h2 className={styles.sectionTitle}>What happens between appointments?</h2>
        </div>
        <div className={styles.narrative}>
          <p>I am a software engineer, and I have also been a psychiatric patient for more than fifteen years.</p>
          <p>I know the gap between appointments: the week passes, details blur, and by the time you sit down with your physician it can be hard to reconstruct what happened on an ordinary Wednesday.</p>
          <p>Cérebro Amigo grew from a direct question: <strong>how could I help my own psychiatrist understand that interval without adding another impossible inbox?</strong></p>
          <p>My brother Adonai and I built the platform we wished had existed earlier in treatment: a system that gives patients a structured voice, respects physicians’ time, and keeps clinical authority exactly where it belongs.</p>
        </div>
      </section>

      <section className={styles.evidenceRail} aria-label="Product principles">
        {principles.map(({ icon: Icon, title, copy }) => (
          <article key={title}>
            <Icon aria-hidden="true" />
            <h2>{title}</h2>
            <p>{copy}</p>
          </article>
        ))}
      </section>

      <section className={styles.contentGrid} id="contact">
        <div>
          <p className={styles.sectionLabel}>OPEN CHANNEL</p>
          <h2 className={styles.sectionTitle}>Inspect the work. Start a conversation.</h2>
        </div>
        <div className={styles.narrative}>
          <p>The public demo uses fictional data. The repository and architecture decisions show how the system handles AI boundaries, multi-tenant access, and clinical safety.</p>
          <Link className={access.primaryAction} href="mailto:arinpar@gmail.com">Contact Patrick <ArrowRight aria-hidden="true" /></Link>
          <Link className={access.secondaryAction} href="https://github.com/arinellidu">View GitHub <ArrowRight aria-hidden="true" /></Link>
        </div>
      </section>
      <PublicFooter />
    </main>
  )
}
