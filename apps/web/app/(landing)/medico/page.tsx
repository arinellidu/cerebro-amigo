/*
THESIS: The product makes the clinical interval visible as an auditable chain; the page rejects the old SaaS aurora hero and card grid.
OWN-WORLD: A dark instrument field, steel rails, cyan flow, yellow inspection and coral human authority; evidence replaces ornament.
STORY: Psychiatrists recognize the problem, inspect the cycle, confirm the limits of AI and create an account.
FIRST VIEWPORT: Thesis and actions on the left, a vertical patient-to-briefing cycle in the center and a governance readout on the right; “Create account” sits above the fold.
FORM: Role-specific clinical console, structural candidate 7; established Signal Boundary, degraded seed 5c67353d.
*/

import { Suspense } from "react"
import Link from "next/link"
import {
  Activity,
  ArrowRight,
  BellRing,
  Brain,
  ClipboardList,
  Database,
  HeartHandshake,
  LockKeyhole,
  Mic,
  ShieldAlert,
  Stethoscope,
  UserRoundCheck,
} from "lucide-react"
import { Logo } from "@/components/logo"
import { CheckupQrBanner } from "@/components/landing/checkup-qr-banner"
import { RuntimeDisclosure } from "@/components/public/runtime-disclosure"
import { Schema, softwareSchema, websiteSchema, breadcrumb } from "@/components/seo/schema"
import styles from "@/components/access/signal-access.module.css"

export const metadata = {
  title: "For Psychiatrists",
  description:
    "Between-appointment care with pre-visit briefings, voice journals, alerts and a physician in the loop.",
  alternates: { canonical: "https://www.cerebroamigo.com.br/medico" },
}

const clinicalFlow = [
  { icon: ClipboardList, code: "PLAN", title: "You define the care plan", detail: "Check-ins, medication and return visit" },
  { icon: Mic, code: "SIGNAL", title: "The patient records the interval", detail: "Mood, journal and adherence" },
  { icon: ShieldAlert, code: "SAFEGUARD", title: "The system organizes and alerts", detail: "Fixed protocol for risk" },
  { icon: UserRoundCheck, code: "AUTHORITY", title: "You review and decide", detail: "Briefing before the appointment", boundary: true },
]

const capabilities = [
  { icon: Brain, title: "Pre-visit briefing", text: "Mood, adherence, events and alerts assembled into a structured readout before the next visit." },
  { icon: Activity, title: "Progress between visits", text: "Patient records organized into a timeline to reduce reliance on reconstructing the interval from memory." },
  { icon: BellRing, title: "Automated routine", text: "Check-ins, reminders and scheduling operate within the plan defined by the physician." },
  { icon: Database, title: "Clinical record and context", text: "Appointments, care plans, medication and events remain in the same transactional flow." },
]

export default function MedicoLandingPage() {
  return (
    <main className={`${styles.page} ${styles.physicianPage}`} lang="en">
      <Schema data={softwareSchema} />
      <Schema data={websiteSchema} />
      <Schema data={breadcrumb([{ name: "Home", path: "/" }, { name: "For Psychiatrists", path: "/medico" }])} />
      <a className={styles.skipLink} href="#clinical-flow">Skip to the clinical flow</a>

      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="Cérebro Amigo — home"><Logo size="md" variant="light" /></Link>
        <nav className={styles.nav} aria-label="Physician navigation">
          <a href="#clinical-flow">How it works</a>
          <a href="#governance">Governance</a>
          <Link href="/precos">Pricing</Link>
          <Link href="/paciente">For patients</Link>
        </nav>
        <Link className={styles.headerAction} href="/demo">View live demo <ArrowRight aria-hidden="true" /></Link>
      </header>
      <Suspense fallback={null}>
        <CheckupQrBanner variant="signal" />
      </Suspense>

      <section className={styles.hero} aria-labelledby="physician-title">
        <div className={styles.introRail}>
          <p className={styles.kicker}>PHYSICIAN WORKSPACE · PSYCHIATRY</p>
          <h1 id="physician-title">No follow-up appointment should start from zero<em>.</em></h1>
          <p className={styles.heroCopy}>The patient records the interval. The system organizes the signals. You arrive with context — and remain the clinical authority.</p>
          <div className={styles.heroActions}>
            <Link className={styles.primaryAction} href="/demo">View live demo <ArrowRight aria-hidden="true" /></Link>
            <Link className={styles.secondaryAction} href="/login">Physician sign in</Link>
          </div>
          <p className={styles.inviteNote}>No credentials. Three synthetic patients. A four-step read-only tour.</p>
        </div>

        <div className={styles.signalConsole} aria-label="Clinical flow between appointments">
          <div className={styles.consoleTopline}><span>ACTIVE CYCLE</span><strong>PLAN → FOLLOW-UP</strong></div>
          <div className={styles.signalBeam} aria-hidden="true" />
          <ol className={styles.signalSteps}>
            {clinicalFlow.map((step, index) => (
              <li className={step.boundary ? styles.boundaryStep : ""} key={step.code}>
                <span className={styles.stepIndex}>{String(index + 1).padStart(2, "0")}</span>
                <span className={styles.stepIcon}><step.icon aria-hidden="true" /></span>
                <span className={styles.stepCopy}><small>{step.code}</small><strong>{step.title}</strong><span>{step.detail}</span></span>
              </li>
            ))}
          </ol>
          <div className={styles.consoleFoot}><span>OUTPUT</span><strong>Structured briefing for review</strong></div>
        </div>

        <aside className={styles.readout} aria-label="Clinical governance">
          <div className={styles.readoutHeader}><Stethoscope aria-hidden="true" /><span>AUTONOMY BOUNDARY</span></div>
          <dl>
            <div><dt>AI</dt><dd>Organizes and summarizes</dd></div>
            <div><dt>Risk</dt><dd>Fixed protocol</dd></div>
            <div><dt>Data</dt><dd>Tenant isolation</dd></div>
            <div className={styles.humanRow}><dt>Clinical decisions</dt><dd>Physician authority</dd></div>
          </dl>
          <p>AI does not diagnose, prescribe or change medication doses.</p>
          <Link href="#governance">Inspect governance <ArrowRight aria-hidden="true" /></Link>
        </aside>
      </section>

      <RuntimeDisclosure />

      <section className={styles.flowSection} id="clinical-flow" aria-labelledby="workflow-title">
        <div className={styles.sectionLead}>
          <p>ONE CYCLE · FOUR OPERATIONAL LAYERS</p>
          <h2 id="workflow-title">The interval is no longer a black box.</h2>
          <p className={styles.sectionCopy}>Each layer has a clear contract. Automation reduces operational work without taking the place of medical evaluation.</p>
        </div>
        <div className={styles.toolRail}>
          {capabilities.map((item, index) => (
            <article key={item.title}>
              <span className={styles.toolNumber}>{String(index + 1).padStart(2, "0")}</span>
              <item.icon aria-hidden="true" />
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.boundarySection} id="governance" aria-labelledby="governance-title">
        <div className={styles.boundaryMark}><HeartHandshake aria-hidden="true" /></div>
        <div>
          <p className={styles.coralLabel}>HUMAN AUTHORITY</p>
          <h2 id="governance-title">Automation stops before the clinical decision.</h2>
          <p>Responses are auditable, access respects tenant boundaries and the crisis protocol remains fixed. The system prepares information; the physician interprets and decides.</p>
        </div>
        <ul>
          <li><LockKeyhole aria-hidden="true" /> RLS multi-tenant</li>
          <li><ShieldAlert aria-hidden="true" /> Fail-safe crisis flow</li>
          <li><UserRoundCheck aria-hidden="true" /> Physician in the loop</li>
        </ul>
      </section>

      <section className={styles.finalCta} aria-labelledby="physician-cta-title">
        <div><p>PHYSICIAN WORKSPACE · PUBLIC DEMO</p><h2 id="physician-cta-title">Follow one signal through the system.</h2><span>Enter the fictional account instantly—no credentials or clinical backend required.</span></div>
        <div className={styles.ctaActions}>
          <Link className={styles.primaryAction} href="/demo">View live demo <ArrowRight aria-hidden="true" /></Link>
          <Link className={styles.secondaryAction} href="/medicos/cadastro">Create physician account</Link>
        </div>
      </section>

      <footer className={styles.footer}>
        <Logo size="sm" variant="light" />
        <div><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/sobre">About</Link></div>
        <p><LockKeyhole aria-hidden="true" /> Sensitive data · controlled access</p>
      </footer>
    </main>
  )
}
