import { redirect } from "next/navigation"

// Seção default do prontuário = Timeline.
export default async function ProntuarioPacienteIndex({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  redirect(`/dashboard/prontuarios/${id}/timeline`)
}
