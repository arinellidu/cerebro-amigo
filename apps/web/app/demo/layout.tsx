import type { Metadata } from "next"
import { DemoShell } from "@/components/demo/demo-shell"

export const metadata: Metadata = {
  title: "Live portfolio demo",
  description: "Explore a read-only Cérebro Amigo product tour with three fictional patients.",
  robots: { index: false, follow: false },
}

const DemoLayout = ({ children }: { children: React.ReactNode }) => <DemoShell>{children}</DemoShell>

export default DemoLayout
