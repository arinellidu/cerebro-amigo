import Link from "next/link"
import { ArrowRight, Braces, Check, ExternalLink, UserRoundCheck } from "lucide-react"
import { demoBriefingFacts } from "@/lib/portfolio-demo"
import styles from "../demo.module.css"

const SourceLedger = () => (
  <div className={styles.sourceLedger}>
    <p>SOURCE LEDGER</p>
    <dl>{demoBriefingFacts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
  </div>
)

const BriefingDocument = () => (
  <section className={styles.briefingDocument} aria-labelledby="briefing-title">
    <header><div><Braces aria-hidden="true" /><span>GENERATED FROM STRUCTURED DEMO RECORDS</span></div><strong>DRAFT · NOT CLINICAL ADVICE</strong></header>
    <div className={styles.briefingBody}>
      <p className={styles.documentLabel}>INTERVAL SUMMARY</p>
      <h2 id="briefing-title">What was reported between visits</h2>
      <p>Across the six-week synthetic interval, Aurora recorded 14 mood entries and three short journal entries. The reported mood values moved from 5/10 to 7/10, while the frequency of entries remained consistent.</p>
      <p>The next fictional visit is scheduled in seven days. No diagnosis, treatment recommendation, prescription or dose change has been generated.</p>
      <SourceLedger />
    </div>
  </section>
)

const AuthorityPanel = () => (
  <aside className={styles.authorityPanel}>
    <div className={styles.authorityIcon}><UserRoundCheck aria-hidden="true" /></div>
    <p>HUMAN AUTHORITY BOUNDARY</p>
    <h2>The draft stops before the decision.</h2>
    <ul>
      <li><Check aria-hidden="true" /> Reported facts are traceable</li>
      <li><Check aria-hidden="true" /> Sources remain visible</li>
      <li><Check aria-hidden="true" /> No clinical recommendation</li>
      <li><Check aria-hidden="true" /> Physician review required</li>
    </ul>
    <Link href="/#architecture">Inspect the architecture <ExternalLink aria-hidden="true" /></Link>
    <small>Next: trace this interface back to Next.js, .NET, Python and PostgreSQL.</small>
  </aside>
)

const DemoComplete = () => (
  <div className={styles.demoComplete}>
    <span>PRODUCT TOUR COMPLETE</span>
    <p>You have followed one synthetic signal from dashboard to record to AI-assisted briefing.</p>
    <Link href="/#architecture">Continue to architecture <ArrowRight aria-hidden="true" /></Link>
  </div>
)

const DemoBriefingPage = () => {
  return (
    <>
      <header className={styles.pageHeader}>
        <div><p>AI-ASSISTED BRIEFING / AWAITING REVIEW</p><h1>Pre-visit briefing</h1></div>
        <p>AI organizes the fictional record into an inspectable draft. The final interpretation remains with the physician.</p>
      </header>

      <div className={styles.briefingGrid}>
        <BriefingDocument />
        <AuthorityPanel />
      </div>

      <DemoComplete />
    </>
  )
}

export default DemoBriefingPage
