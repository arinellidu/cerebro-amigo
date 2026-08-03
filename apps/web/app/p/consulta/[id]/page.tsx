import { SalaVideo } from "@/components/video/SalaVideo"

// Sala de teleconsulta do paciente (papel = answerer). Vídeo P2P, não gravado.
// O gateway valida que a consulta é do próprio paciente e é teleconsulta.
export default async function TeleconsultaPacientePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return (
    <SalaVideo
      papel="paciente"
      baseUrl={`/api/paciente/agenda/${id}/video`}
      nomePeer="Seu médico"
      voltarHref="/p/agenda"
    />
  )
}
