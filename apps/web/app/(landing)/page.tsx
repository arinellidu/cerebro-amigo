/*
THESIS: Full-stack AI is proven as an inspectable signal path; the page refuses the generic SaaS hero and bento grid.
OWN-WORLD: A vacuum-black instrument field, steel detector planes, cyan flow, yellow inspection and coral human boundaries.
STORY: Recruiters see what Patrick built, inspect why its boundaries exist, open the demo and reach the builder.
FIRST VIEWPORT: A narrow narrative rail, a dominant vertical seven-layer system trace and a synchronized evidence rail; the primary action sits left, above the fold.
FORM: Signal Boundary, approved Vertical Signal Trace composition; selected from the direction roll f94c8dc5 and implemented as semantic HTML/CSS/SVG.
*/

import type { CSSProperties } from "react"
import Link from "next/link"
import {
  Activity,
  ArrowRight,
  Braces,
  Cloud,
  Code2,
  Database,
  Github,
  HeartHandshake,
  LifeBuoy,
  Linkedin,
  LockKeyhole,
  Mail,
  Network,
  Stethoscope,
  UserRoundCheck,
  Workflow,
} from "lucide-react"
import { Logo } from "@/components/logo"
import { RuntimeDisclosure } from "@/components/public/runtime-disclosure"
import styles from "./home.module.css"

export const metadata = {
  title: "Patrick Arinelli — Full-stack AI architecture",
  description:
    "Explore the architecture behind Cérebro Amigo: a full-stack clinical AI system built with Next.js, .NET, Python, PostgreSQL, Vercel and Azure.",
  alternates: { canonical: "https://www.cerebroamigo.com.br" },
  openGraph: {
    title: "Patrick Arinelli — Full-stack AI architecture",
    description:
      "A production-shaped clinical AI platform with explicit human boundaries.",
    locale: "en_CA",
  },
}

const layers = [
  {
    number: "1",
    name: "NEXT.JS 16",
    role: "Web app + BFF",
    proof: "App Router, server components, httpOnly sessions",
    paths: ["apps/web/app", "apps/web/proxy.ts"],
    kind: "runtime",
  },
  {
    number: "2",
    name: ".NET 10",
    role: "Transactional API",
    proof: "Minimal APIs, auth, validation, tenant context",
    paths: ["apps/api-gateway/Program.cs", "Data/DbExtensions.cs"],
    kind: "runtime",
  },
  {
    number: "3",
    name: "PYTHON / LANGGRAPH",
    role: "AI orchestration",
    proof: "Graph execution, agents, tools and safeguards",
    paths: ["orchestrator-py/app", "agents-py/app"],
    kind: "runtime",
  },
  {
    number: "4",
    name: "AZURE POSTGRESQL",
    role: "Managed data · eastus2",
    proof: "Flexible Server, RLS, encryption and audit trails",
    paths: ["infra/migrations/0037_rls_tenant.sql", "0038_rls_tenant_iteracao2.sql"],
    kind: "runtime",
  },
  {
    number: "5",
    name: "VERCEL FRONTEND",
    role: "Frontend host",
    proof: "Global edge delivery and preview deployments",
    paths: ["apps/web/vercel.json", "apps/web/next.config.mjs"],
    kind: "hosting",
  },
  {
    number: "6",
    name: "AZURE CONTAINER APPS",
    role: "Service host",
    proof: "eastus2, scale-to-zero services and managed identity",
    paths: ["infra/azure/apps.bicep", "foundation.bicep"],
    kind: "hosting",
  },
  {
    number: "7",
    name: "HUMAN AUTHORITY",
    role: "Decision boundary",
    proof: "Fixed crisis protocol and physician authority",
    paths: ["ADR-035 / ADR-041", "ADR-063"],
    boundary: true,
    kind: "authority",
  },
]

const governance = [
  {
    icon: LockKeyhole,
    title: "AUTH & ACCESS",
    body: "httpOnly sessions, explicit tenant filters and database RLS.",
  },
  {
    icon: Database,
    title: "DATA GOVERNANCE",
    body: "Encryption, immutable audit trails and fictional demo data.",
  },
  {
    icon: Workflow,
    title: "AI GOVERNANCE",
    body: "Provider boundaries, redacted traces and fixed crisis behavior.",
  },
  {
    icon: Activity,
    title: "OBSERVABILITY",
    body: "Health gates, structured logs and inspectable decisions.",
  },
]

const decisions = [
  {
    tag: "PRODUCT → PLATFORM",
    title: "One signal. Explicit owners.",
    body: "The patient experience, BFF, transactional API, AI orchestration and data layer each keep a narrow contract. The architecture is complex because the responsibilities are real—not because the diagram needs more boxes.",
    evidence: "Next.js BFF → .NET gateway → Python AI services → PostgreSQL",
  },
  {
    tag: "AUTOMATION → AUTHORITY",
    title: "The boundary is part of the product.",
    body: "AI can organize, summarize and flag. It cannot diagnose, prescribe or change a dose. High-risk paths stop at fixed safeguards and physician review.",
    evidence: "ADR-035 · ADR-041 · ADR-063",
    coral: true,
  },
  {
    tag: "CODE → OPERATIONS",
    title: "The stack is real. The tour is resilient.",
    body: "The authenticated product uses the Azure portfolio stack. The public recruiter tour is a read-only snapshot of the same fictional seed, so a cold backend never blocks inspection.",
    evidence: "ADR-080 · infra/seed/portfolio.sql · apps/web/app/demo",
  },
]

type SignalStyle = CSSProperties & {
  "--layer-index": number
  "--layer-scale": number
}

function SignalStack() {
  return (
    <div className={styles.stackScene} role="img" aria-label="Cérebro Amigo portfolio architecture: frontend on Vercel, services and PostgreSQL in Azure eastus2, fictional demo data only, ending at a human authority boundary">
      <div className={styles.beam} aria-hidden="true" />
      <div className={styles.beamOrigin} aria-hidden="true" />
      <div className={styles.stackGroups} aria-hidden="true">
        <span>RUNTIME PATH · 01—04</span>
        <span>HOSTING ENVELOPES · 05—06</span>
        <span>AUTHORITY BOUNDARY · 07</span>
      </div>
      {layers.map((layer, index) => (
        <div
          aria-hidden="true"
          className={`${styles.stackLayer} ${layer.kind === "hosting" ? styles.stackHosting : ""} ${layer.boundary ? styles.stackBoundary : ""}`}
          key={layer.name}
          style={
            {
              "--layer-index": index,
              "--layer-scale": 1 - Math.abs(index - 3) * 0.018,
            } as SignalStyle
          }
        >
          <div className={styles.disc} aria-hidden="true">
            <span className={styles.discSegments} />
            <span className={styles.discOrbit} />
            <span className={styles.discSignal} />
          </div>
          <div className={styles.layerPlate}>
            <span>{layer.number}</span>
            <strong>{layer.name}</strong>
            <small>{layer.role}</small>
          </div>
        </div>
      ))}
      <div className={styles.stackExit} aria-hidden="true" />
    </div>
  )
}

function Mark() {
  return (
    <Link className={styles.brand} href="/" aria-label="Cérebro Amigo home">
      <Logo size="md" variant="light" />
    </Link>
  )
}

function AccessPanel({ mobile = false }: { mobile?: boolean }) {
  return (
    <div className={`${styles.accessPanel} ${mobile ? styles.mobileAccess : styles.desktopAccess}`} aria-label="Product access">
      <span>ACCESS POINTS</span>
      <Link href="/paciente">
        <HeartHandshake aria-hidden="true" />
        <span><strong>Patient access</strong><small>Private companion experience</small></span>
        <ArrowRight aria-hidden="true" />
      </Link>
      <Link href="/medico">
        <Stethoscope aria-hidden="true" />
        <span><strong>Physician access</strong><small>Professional workspace</small></span>
        <ArrowRight aria-hidden="true" />
      </Link>
    </div>
  )
}

export default function RecruiterHomepage() {
  return (
    <main className={styles.page} lang="en">
      <a className={styles.skipLink} href="#case-study">
        Skip to the case study
      </a>

      <header className={styles.header}>
        <Mark />
        <nav className={styles.nav} aria-label="Portfolio navigation">
          <a href="#architecture">Architecture</a>
          <a href="#case-study">Case study</a>
          <a href="#governance">Governance</a>
          <Link href="/sobre">About</Link>
        </nav>
        <div className={styles.headerIdentity}>
          <span>BUILDER</span>
          <strong>Patrick Arinelli</strong>
        </div>
      </header>

      <section className={styles.hero} id="architecture" aria-labelledby="hero-title">
        <div className={styles.introRail}>
          <p className={styles.kicker}>FULL-STACK AI · CLINICAL SYSTEMS</p>
          <h1 id="hero-title">
            I build full-stack AI systems that know where autonomy must stop<em>.</em>
          </h1>
          <p className={styles.heroCopy}>
            A production-shaped psychiatry platform spanning product, cloud, data and AI—built with explicit human authority.
          </p>

          <div className={styles.heroActions}>
            <Link className={styles.primaryAction} href="/demo">
              View live demo <ArrowRight aria-hidden="true" />
            </Link>
            <a className={styles.secondaryAction} href="#case-study">
              Explore architecture <ArrowRight aria-hidden="true" />
            </a>
          </div>

          <div className={styles.creatorBlock}>
            <span>CREATOR</span>
            <strong>Patrick Arinelli</strong>
            <div className={styles.socialLinks}>
              <a href="https://linkedin.com/in/patrick-arinelli" target="_blank" rel="noreferrer">
                <Linkedin aria-hidden="true" /> LinkedIn
              </a>
              <a href="https://github.com/arinellidu" target="_blank" rel="noreferrer">
                <Github aria-hidden="true" /> GitHub
              </a>
              <a href="mailto:arinpar@gmail.com">
                <Mail aria-hidden="true" /> Email
              </a>
            </div>
          </div>

          <AccessPanel />

        </div>

        <SignalStack />
        <AccessPanel mobile />

        <aside className={styles.evidenceRail} aria-label="Implementation evidence">
          <div className={styles.evidenceHeader}>
            <span>LAYER</span>
            <span>IMPLEMENTATION EVIDENCE</span>
          </div>
          <ol>
            {layers.map((layer) => (
              <li className={layer.boundary ? styles.evidenceBoundary : ""} key={layer.name}>
                <span className={styles.layerNumber}>{layer.number}</span>
                <div>
                  <strong>{layer.name}</strong>
                  <p>{layer.proof}</p>
                </div>
                <code>{layer.paths.map((path) => <span key={path}>{path}</span>)}</code>
              </li>
            ))}
          </ol>
          <div className={styles.legend} aria-label="Architecture legend">
            <span><i className={styles.legendCyan} /> System signal</span>
            <span><i className={styles.legendYellow} /> Active proof</span>
            <span><i className={styles.legendCoral} /> Human boundary</span>
          </div>
        </aside>
      </section>

      <RuntimeDisclosure />

      <section className={styles.governance} id="governance" aria-labelledby="governance-title">
        <div className={styles.sectionLead}>
          <p>SYSTEM GOVERNANCE · CONTINUOUS TRACE</p>
          <h2 id="governance-title">Governance spans the full stack.</h2>
          <span>From edge to review, every interaction is traceable, controllable and built for clinical safety.</span>
        </div>
        <div className={styles.governanceGrid}>
          {governance.map((item) => (
            <article key={item.title}>
              <item.icon aria-hidden="true" />
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.caseStudy} id="case-study" aria-labelledby="case-study-title">
        <header className={styles.caseHeader}>
          <div>
            <p>ARCHITECTURE CASE STUDY</p>
            <h2 id="case-study-title">The boundaries are the architecture.</h2>
          </div>
          <p>
            Cérebro Amigo works between psychiatric consultations. That makes ownership, isolation and failure behavior part of the product—not backend trivia.
          </p>
        </header>

        <div className={styles.decisionList}>
          {decisions.map((decision, index) => (
            <article className={decision.coral ? styles.decisionCoral : ""} key={decision.title}>
              <span className={styles.decisionIndex}>0{index + 1}</span>
              <div className={styles.decisionBody}>
                <p>{decision.tag}</p>
                <h3>{decision.title}</h3>
                <span>{decision.body}</span>
              </div>
              <code>{decision.evidence}</code>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.stackProof} aria-labelledby="stack-proof-title">
        <div className={styles.stackProofLead}>
          <p>IMPLEMENTED, NOT MOCKED</p>
          <h2 id="stack-proof-title">One repository. Explicit service boundaries.</h2>
        </div>
        <div className={styles.stackTrace}>
          <span><Braces aria-hidden="true" /> Next.js 16</span>
          <i aria-hidden="true" />
          <span><Code2 aria-hidden="true" /> .NET 10</span>
          <i aria-hidden="true" />
          <span><Network aria-hidden="true" /> Python AI</span>
          <i aria-hidden="true" />
          <span><Database aria-hidden="true" /> PostgreSQL</span>
          <i aria-hidden="true" />
          <span><Cloud aria-hidden="true" /> Azure</span>
          <i aria-hidden="true" />
          <span className={styles.traceBoundary}><UserRoundCheck aria-hidden="true" /> Human review</span>
        </div>
        <div className={styles.proofActions}>
          <a href="https://github.com/arinellidu" target="_blank" rel="noreferrer">
            View Patrick&apos;s GitHub <Github aria-hidden="true" />
          </a>
          <a href="https://linkedin.com/in/patrick-arinelli" target="_blank" rel="noreferrer">
            Connect on LinkedIn <Linkedin aria-hidden="true" />
          </a>
        </div>
      </section>

      <footer className={styles.footer}>
        <div>
          <Mark />
          <p>Clinical AI platform. Human boundaries. Full-stack ownership.</p>
        </div>
        <div className={styles.footerContact}>
          <strong>Patrick Arinelli</strong>
          <a href="mailto:arinpar@gmail.com">arinpar@gmail.com</a>
        </div>
        <div className={styles.footerUtility}>
          <p lang="pt-BR"><LifeBuoy aria-hidden="true" /> Em crise, você não está sozinho · CVV 188 · SAMU 192</p>
          <span><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></span>
        </div>
      </footer>

    </main>
  )
}
