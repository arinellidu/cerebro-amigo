import { redirect } from "next/navigation"
import { gateway } from "@/lib/gateway"
import { EscribaGravarPresencial } from "@/components/escriba/EscribaGravarPresencial"

// Escriba PRESENCIAL (ADR-075): grava o áudio ambiente de uma consulta presencial.
// Teleconsulta grava pela SalaVideo (videochamada), então redireciona pra lá.
export default async function EscribaGravarPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  let nome = "Paciente"
  let modalidade = "presencial"
  try {
    const c = await gateway.get<{ pacienteNome?: string | null; modalidade?: string }>(
      `/api/v1/consultas/${id}`,
    )
    if (c?.pacienteNome) nome = c.pacienteNome
    if (c?.modalidade) modalidade = c.modalidade
  } catch {
    /* segue com defaults — o componente valida status/feature no cliente */
  }

  if (modalidade === "teleconsulta") {
    redirect(`/dashboard/consultas/${id}/teleconsulta`)
  }

  return <EscribaGravarPresencial consultaId={id} pacienteNome={nome} />
}
