import { redirect } from "next/navigation"

// Movido para /admin/prompts (poder de plataforma).
export default function Page() {
  redirect("/admin/prompts")
}
