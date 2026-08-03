import { PatientVoiceDemo } from "@/components/demo/patient-voice-demo"
import styles from "../patient-app.module.css"

const PatientVoicePage = () => (
  <>
    <header className={styles.screenHeader}>
      <div><p>PATIENT PWA / VOICE JOURNAL</p><h1>Say it in your own words.</h1></div>
      <p>Explore the recording states without granting microphone permission or creating an audio file.</p>
    </header>
    <PatientVoiceDemo />
  </>
)

export default PatientVoicePage
