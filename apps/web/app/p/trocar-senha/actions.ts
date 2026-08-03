"use server"

import { redirect } from "next/navigation"
import { gatewayPaciente, GatewayPacienteError } from "@/lib/gateway-paciente"

export interface PacienteAuthState {
  error: string | null
}

type Senhas = {
  atual: string
  nova: string
  confirmar: string
}

const lerSenhas = (formData: FormData): Senhas => ({
  atual: formData.get("senhaAtual") as string,
  nova: formData.get("novaSenha") as string,
  confirmar: formData.get("confirmar") as string,
})

const validarSenhas = ({ atual, nova, confirmar }: Senhas): string | null => {
  if (!atual) return "Enter your current password."
  if (!nova || nova.length < 8)
    return "Your new password must contain at least 8 characters."
  if (nova !== confirmar) return "The passwords do not match."
  return null
}

const persistirSenha = async ({ atual, nova }: Senhas): Promise<string | null> => {
  try {
    await gatewayPaciente.post("/api/v1/auth/paciente/senha", {
      senhaAtual: atual,
      novaSenha: nova,
    })
    return null
  } catch (err) {
    if (err instanceof GatewayPacienteError && err.status === 401)
      return "Your current password is incorrect."
    return "We could not change your password. Please try again."
  }
}

export const trocarSenha = async (
  _prev: PacienteAuthState,
  formData: FormData,
): Promise<PacienteAuthState> => {
  const senhas = lerSenhas(formData)
  const erroValidacao = validarSenhas(senhas)
  if (erroValidacao) return { error: erroValidacao }

  const erroGateway = await persistirSenha(senhas)
  if (erroGateway) return { error: erroGateway }

  return redirect("/p")
}
