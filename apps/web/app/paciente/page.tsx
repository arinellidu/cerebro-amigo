/*
THESIS: The portal turns scattered reports into an organized signal for physician review; the page rejects the old aurora hero and generic cards.
OWN-WORLD: A dark instrument field, steel rails, cyan flow, yellow inspection and a coral human boundary; controls and panels have square corners.
STORY: Patients understand what they record, who reviews it, how to sign in and where automation stops.
FIRST VIEWPORT: Message and access on the left, a vertical care trace in the center and a privacy readout on the right; “Open patient portal” sits above the fold.
FORM: Role-specific care console, structural candidate 7; established Signal Boundary, degraded seed 5c67353d.
*/

import Link from "next/link"
import {
  ArrowRight,
  CalendarClock,
  HeartHandshake,
  LifeBuoy,
  LockKeyhole,
  MessageCircle,
  Mic,
  Pill,
  ShieldCheck,
  Smile,
  Stethoscope,
} from "lucide-react"
import { Logo } from "@/components/logo"
import { InstallPWA } from "@/components/portal/install-pwa"
import { RuntimeDisclosure } from "@/components/public/runtime-disclosure"
import styles from "@/components/access/signal-access.module.css"

export const metadata = {
  title: "Your care between appointments",
  description:
    "The Cérebro Amigo patient portal organizes mood, journal, medication and appointment records for care between visits.",
}

const signalSteps = [
  { icon: Smile, code: "CHECK-IN", title: "How you feel", detail: "Mood in a few taps" },
  { icon: Mic, code: "CONTEXT", title: "What happened", detail: "Journal by text or voice" },
  { icon: Pill, code: "ROUTINE", title: "What you need to remember", detail: "Medication and check-ins" },
  { icon: Stethoscope, code: "REVIEW", title: "Your psychiatrist follows up", detail: "Organized context for your next visit", boundary: true },
]

const dailyTools = [
  { icon: Mic, title: "Voice journal", text: "Talk through your day. Your report stays organized without requiring a perfect written note." },
  { icon: Pill, title: "Medication", text: "Confirm your routine and see the reminders defined in your care plan." },
  { icon: Smile, title: "Mood", text: "Record how you feel in seconds and bring that history into your next appointment." },
  { icon: CalendarClock, title: "Schedule", text: "See your next appointment and keep the time between visits visible." },
]

export default function PacienteLandingPage() {
  return (
    <main className={styles.page} lang="en">
      <a className={styles.skipLink} href="#care-flow">Skip to the care flow</a>

      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="Cérebro Amigo — home">
          <Logo size="md" variant="light" />
        </Link>
        <nav className={styles.nav} aria-label="Patient navigation">
          <a href="#care-flow">How it works</a>
          <a href="#privacy">Privacy</a>
          <Link href="/medico">For physicians</Link>
        </nav>
        <Link className={styles.headerAction} href="/demo/patient-app">
          View patient demo <ArrowRight aria-hidden="true" />
        </Link>
      </header>

      <section className={styles.hero} aria-labelledby="patient-title">
        <div className={styles.introRail}>
          <p className={styles.kicker}>PATIENT PORTAL · BETWEEN APPOINTMENTS</p>
          <h1 id="patient-title">What happens between appointments should not get lost<em>.</em></h1>
          <p className={styles.heroCopy}>
            Record how you feel, keep your routine organized and arrive at your next appointment with the interval visible to you and your psychiatrist.
          </p>
          <div className={styles.heroActions}>
            <Link className={styles.primaryAction} href="/demo/patient-app">
              View patient demo <ArrowRight aria-hidden="true" />
            </Link>
            <Link className={styles.secondaryAction} href="/p/entrar">
              Patient sign in
            </Link>
          </div>
          <div className={styles.installControl}><InstallPWA variant="signal" /></div>
          <p className={styles.inviteNote}>No credentials. One synthetic profile. Voice recording is safely simulated.</p>
        </div>

        <div className={styles.signalConsole} aria-label="Care flow between appointments">
          <div className={styles.consoleTopline}>
            <span>ACTIVE SIGNAL</span>
            <strong>PATIENT → PHYSICIAN</strong>
          </div>
          <div className={styles.signalBeam} aria-hidden="true" />
          <ol className={styles.signalSteps}>
            {signalSteps.map((step, index) => (
              <li className={step.boundary ? styles.boundaryStep : ""} key={step.code}>
                <span className={styles.stepIndex}>{String(index + 1).padStart(2, "0")}</span>
                <span className={styles.stepIcon}><step.icon aria-hidden="true" /></span>
                <span className={styles.stepCopy}>
                  <small>{step.code}</small>
                  <strong>{step.title}</strong>
                  <span>{step.detail}</span>
                </span>
              </li>
            ))}
          </ol>
          <div className={styles.consoleFoot}>
            <span>CLINICAL CONTROL</span>
            <strong>Decisions remain with your psychiatrist</strong>
          </div>
        </div>

        <aside className={styles.readout} aria-label="Privacy and automation limits">
          <div className={styles.readoutHeader}>
            <ShieldCheck aria-hidden="true" />
            <span>SAFETY READOUT</span>
          </div>
          <dl>
            <div><dt>Access</dt><dd>You + your psychiatrist</dd></div>
            <div><dt>Content</dt><dd>Protected by encryption</dd></div>
            <div><dt>Automation</dt><dd>Organizes and reminds</dd></div>
            <div className={styles.humanRow}><dt>Clinical decisions</dt><dd>Always human</dd></div>
          </dl>
          <p>AI never diagnoses or changes medication doses.</p>
          <Link href="#privacy">Inspect the boundaries <ArrowRight aria-hidden="true" /></Link>
        </aside>
      </section>

      <RuntimeDisclosure />

      <section className={styles.flowSection} id="care-flow" aria-labelledby="daily-title">
        <div className={styles.sectionLead}>
          <p>ONE INTERVAL · FOUR POINTS OF SUPPORT</p>
          <h2 id="daily-title">Your daily experience becomes context for the next conversation.</h2>
          <p className={styles.sectionCopy}>Each tool has a clear role in your care. None of them attempts to replace an appointment.</p>
        </div>
        <div className={styles.toolRail}>
          {dailyTools.map((tool, index) => (
            <article key={tool.title}>
              <span className={styles.toolNumber}>{String(index + 1).padStart(2, "0")}</span>
              <tool.icon aria-hidden="true" />
              <h3>{tool.title}</h3>
              <p>{tool.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.boundarySection} id="privacy" aria-labelledby="boundary-title">
        <div className={styles.boundaryMark}><HeartHandshake aria-hidden="true" /></div>
        <div>
          <p className={styles.coralLabel}>HUMAN BOUNDARY</p>
          <h2 id="boundary-title">Technology organizes. Your psychiatrist provides care.</h2>
          <p>Mental health information is sensitive. Access is role-based, records are protected and clinical decisions are never automated.</p>
        </div>
        <ul>
          <li><LockKeyhole aria-hidden="true" /> Restricted access</li>
          <li><ShieldCheck aria-hidden="true" /> Audit trail</li>
          <li><MessageCircle aria-hidden="true" /> Physician in the loop</li>
        </ul>
      </section>

      <section className={styles.finalCta} aria-labelledby="patient-cta-title">
        <div>
          <p>PUBLIC DEMO · PATIENT PWA</p>
          <h2 id="patient-cta-title">Explore one day between appointments.</h2>
          <span>Try mood, medication and voice-journal interactions without creating an account.</span>
        </div>
        <Link className={styles.primaryAction} href="/demo/patient-app">View patient demo <ArrowRight aria-hidden="true" /></Link>
      </section>

      <footer className={styles.footer}>
        <Logo size="sm" variant="light" />
        <div><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/medico">For physicians</Link></div>
        <p>
          <LifeBuoy aria-hidden="true" /> Need help now?{" "}
          <a href="tel:188" aria-label="Call CVV at 188">CVV 188</a>
          <span aria-hidden="true">·</span>
          <a href="tel:192" aria-label="Call SAMU at 192">SAMU 192</a>
        </p>
      </footer>
    </main>
  )
}
