"use client"

import { useParams } from "next/navigation"
import { CondutaEditor } from "@/components/conduta/conduta-editor"

export default function CondutaPage() {
  const { id } = useParams<{ id: string }>()
  return <CondutaEditor pacienteId={id} />
}
