import { redirect } from "next/navigation"

// Editor de prompts virou poder de plataforma — vive em /admin/prompts.
// Médico cai aqui e é levado ao admin (o middleware bloqueia não-admin).
export default function Page() {
  redirect("/admin/prompts")
}
