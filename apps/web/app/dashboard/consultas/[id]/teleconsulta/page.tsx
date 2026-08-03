import { SalaVideo } from "@/components/video/SalaVideo"
import { gateway } from "@/lib/gateway"

// Sala de teleconsulta do médico (papel = offerer). A página resolve o nome do
// paciente para exibição e monta a sala WebRTC; o vídeo é P2P e não é gravado.
export default async function TeleconsultaMedicoPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  let nome = "Paciente"
  try {
    const c = await gateway.get<{ pacienteNome?: string | null }>(`/api/v1/consultas/${id}`)
    if (c?.pacienteNome) nome = c.pacienteNome
  } catch {
    /* segue sem nome — a sala funciona mesmo assim */
  }

  return (
    <SalaVideo
      papel="medico"
      baseUrl={`/api/consultas/${id}/video`}
      nomePeer={nome}
      voltarHref={`/dashboard/consultas/${id}/briefing`}
    />
  )
}
