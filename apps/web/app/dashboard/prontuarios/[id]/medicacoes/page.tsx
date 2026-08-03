"use client"

import { useParams } from "next/navigation"
import { MedicacoesEmUso } from "@/components/prontuario/medicacoes-em-uso"

export default function MedicacoesPage() {
  const { id } = useParams<{ id: string }>()
  return <MedicacoesEmUso pacienteId={id} />
}
