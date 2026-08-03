import styles from "./runtime-disclosure.module.css"

const runtime = [
  ["Frontend", "Vercel"],
  ["Backend", "Azure Container Apps"],
  ["Database", "Azure PostgreSQL"],
  ["Region", "eastus2 · United States"],
]

export const RuntimeDisclosure = () => {
  return (
    <section className={styles.runtime} aria-labelledby="current-runtime-title">
      <header>
        <p>DEPLOYMENT / VERIFIED SCOPE</p>
        <h2 id="current-runtime-title">Current portfolio runtime</h2>
      </header>
      <dl>
        {runtime.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className={styles.boundary}>
        <strong>Fictional demo data only.</strong>
        <p>
          This public environment is not an active medical service and makes no
          Brazilian data-residency claim. AWS appears only as previous or reference
          architecture and is outside the current public request path.
        </p>
      </div>
    </section>
  )
}
