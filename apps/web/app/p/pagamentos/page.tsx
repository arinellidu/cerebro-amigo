import { redirect } from "next/navigation"

// Fluxo B (pagamentos do paciente) estacionado — ADR-034. UI desativada.
export default function PagamentosDesativado() {
  redirect("/p")
}
