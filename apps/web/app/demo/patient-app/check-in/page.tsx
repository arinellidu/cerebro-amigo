import { PatientCheckInDemo } from "@/components/demo/patient-check-in-demo"
import styles from "../patient-app.module.css"

const PatientCheckInPage = () => (
  <>
    <header className={styles.screenHeader}>
      <div><p>PATIENT PWA / LOCAL INTERACTION</p><h1>Daily check-in</h1></div>
      <p>Try the controls as Aurora. Selections live only in this browser tab and are never submitted.</p>
    </header>
    <PatientCheckInDemo />
  </>
)

export default PatientCheckInPage
