"use client"

import { useCallback, useState } from "react"
import { Button } from "@/components/ui/button"
import { FileText, Loader2, AlertTriangle } from "lucide-react"

// Globais do SDK MEMED (tipados soltos — o SDK é injetado por <script>).
declare global {
  interface Window {
    MdSinapsePrescricao?: any
    MdHub?: any
  }
}

let scriptCarregado = false

function carregarSdk(scriptUrl: string, token: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (scriptCarregado && typeof window !== "undefined" && window.MdSinapsePrescricao) {
      try {
        window.MdSinapsePrescricao.setToken?.(token)
      } catch {
        /* ignora */
      }
      return resolve()
    }
    const s = document.createElement("script")
    s.src = scriptUrl
    s.type = "text/javascript"
    s.setAttribute("data-token", token)
    s.async = true
    s.onload = () => {
      scriptCarregado = true
      resolve()
    }
    s.onerror = () => reject(new Error("Falha ao carregar o SDK do MEMED"))
    document.body.appendChild(s)
  })
}

/**
 * Abre o módulo de prescrição do MEMED para o paciente selecionado.
 * O médico prescreve e assina dentro do widget do MEMED (a IA não toca).
 * Ao concluir, espelha os medicamentos em prescricoes (motor de lembretes).
 *
 * NOTA: o nome exato do evento de conclusão e o shape do payload de
 * medicamentos devem ser confirmados no sandbox do MEMED — o espelho é
 * best-effort; a receita legal já vive no MEMED independentemente.
 */
export function BotaoReceitaMemed({
  pacienteId,
  pacienteNome,
  onReceitaRegistrada,
}: {
  pacienteId: string
  pacienteNome?: string | null
  // Chamado quando o espelho da receita é registrado com sucesso (alimenta a
  // fila de confirmação de horários/validade no prontuário).
  onReceitaRegistrada?: () => void
}) {
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  // Espelho da receita → BFF. Com retry: a captura via evento do SDK é o único
  // gatilho, então a falha não pode ser silenciosa. Se mesmo assim falhar, o
  // médico é avisado (a receita legal já está no MEMED; só o lembrete fica de fora).
  const espelhar = useCallback(
    async (memedPrescricaoId: string, medicamentos: Array<{ nome: string; posologia: string | null }>) => {
      for (let tentativa = 1; tentativa <= 3; tentativa++) {
        try {
          const r = await fetch("/api/memed/receitas", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pacienteId, memedPrescricaoId, medicamentos }),
          })
          if (r.ok) {
            setAviso("Receita emitida. Confirme os horários e a validade na fila abaixo para ligar lembrete e renovação.")
            onReceitaRegistrada?.()
            return
          }
        } catch (e) {
          console.error(`[BotaoReceitaMemed] espelho tentativa ${tentativa} falhou:`, e)
        }
        if (tentativa < 3) await new Promise((res) => setTimeout(res, 500 * tentativa))
      }
      setErro("A receita foi emitida no MEMED, mas falhou ao registrar aqui — o lembrete não foi criado. Recadastre a prescrição manualmente no prontuário.")
    },
    [pacienteId, onReceitaRegistrada],
  )

  const abrir = useCallback(async () => {
    setErro(null)
    setAviso(null)
    setCarregando(true)
    try {
      // 1. token do prescritor
      const tr = await fetch("/api/memed/prescritor-token")
      const td = await tr.json().catch(() => ({}))
      if (tr.status === 400 && td?.error === "cadastro_incompleto") {
        setErro("Complete CRM (número), UF e CPF em Configurações antes de emitir receita.")
        return
      }
      if (!tr.ok || !td?.token) {
        setErro("Não foi possível iniciar o MEMED. Tente novamente.")
        return
      }

      const eraCarregado = scriptCarregado
      await carregarSdk(td.scriptUrl, td.token)

      // 2. dados do paciente p/ setPaciente
      const pr = await fetch(`/api/memed/paciente/${pacienteId}/dados`)
      const pac = await pr.json().catch(() => ({}))
      const paciente = {
        external_id: pacienteId,
        nome: pac?.nome ?? pacienteNome ?? "",
        cpf: pac?.cpf ?? "",
        telefone: pac?.telefone ?? "",
      }

      const Md = window.MdSinapsePrescricao
      const Hub = window.MdHub
      if (!Md || !Hub) {
        setErro("SDK do MEMED não inicializou.")
        return
      }

      // 3. espelho ao concluir a prescrição
      Md.event?.add?.("prescricaoImpressa", (data: any) => {
        const memedPrescricaoId = String(data?.prescricao?.id ?? data?.id ?? "")
        if (!memedPrescricaoId) return
        const brutos = data?.prescricao?.medicamentos ?? data?.medicamentos ?? []
        const medicamentos = (Array.isArray(brutos) ? brutos : []).map((m: any) => ({
          nome: m?.nome ?? m?.medicamento ?? m?.descricao ?? "",
          posologia: m?.posologia ?? m?.descricao ?? null,
        }))
        void espelhar(memedPrescricaoId, medicamentos)
      })

      // 4. abre o módulo
      const abrirModulo = async () => {
        await Hub.command.send("plataforma.prescricao", "setPaciente", paciente)
        await Hub.module.show("plataforma.prescricao")
      }

      if (eraCarregado) {
        // SDK já estava na página → módulo já inicializado, abre direto
        await abrirModulo()
      } else {
        // 1ª carga → espera o módulo inicializar
        Md.event?.add?.("core:moduleInit", async (module: any) => {
          if (module?.name && module.name !== "plataforma.prescricao") return
          await abrirModulo()
        })
      }
    } catch (e: any) {
      // Detalhe técnico só no console (pode ser texto cru/em inglês do SDK do MEMED) — nunca na tela do médico.
      console.error("[BotaoReceitaMemed] falha ao abrir o MEMED:", e)
      setErro("Não foi possível abrir o MEMED para emitir a receita. Verifique sua conexão e tente novamente.")
    } finally {
      setCarregando(false)
    }
  }, [pacienteId, pacienteNome, espelhar])

  return (
    <div className="space-y-2">
      <Button onClick={abrir} disabled={carregando} className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90">
        {carregando ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
        Emitir receita (MEMED)
      </Button>
      {erro && (
        <p className="flex items-start gap-1.5 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {erro}
        </p>
      )}
      {aviso && !erro && (
        <p className="text-sm text-muted-foreground">{aviso}</p>
      )}
    </div>
  )
}
