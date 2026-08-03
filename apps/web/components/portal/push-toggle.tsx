"use client"

import { useEffect, useState } from "react"
import { Bell, BellOff, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ativarPush, desativarPush, pushSuportado, statusPush } from "@/lib/push"

type Estado = "carregando" | "ativo" | "inativo" | "negado" | "indisponivel" | "erro"

export function PushToggle() {
  const [estado, setEstado] = useState<Estado>("carregando")
  const [ocupado, setOcupado] = useState(false)

  useEffect(() => {
    if (!pushSuportado()) {
      setEstado("indisponivel")
      return
    }
    statusPush().then((s) =>
      setEstado(s === "ativo" ? "ativo" : s === "negado" ? "negado" : "inativo"),
    )
  }, [])

  async function alternar() {
    setOcupado(true)
    try {
      if (estado === "ativo") {
        await desativarPush()
        setEstado("inativo")
      } else {
        const r = await ativarPush()
        setEstado(r === "ativo" ? "ativo" : r === "negado" ? "negado" : "erro")
      }
    } finally {
      setOcupado(false)
    }
  }

  if (estado === "indisponivel") return null

  return (
    <div className="portal-card portal-hairline flex items-center justify-between p-4">
      <div className="flex items-center gap-3">
        <div
          className={`grid h-11 w-11 place-items-center rounded-xl ring-1 ${
            estado === "ativo"
              ? "bg-primary/15 text-primary ring-primary/20"
              : "bg-noir-surface-raised text-muted-foreground ring-noir-line"
          }`}
        >
          {estado === "ativo" ? <Bell className="h-5 w-5" /> : <BellOff className="h-5 w-5" />}
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">Lembretes no celular</p>
          <p className="text-xs text-muted-foreground">
            {estado === "ativo"
              ? "Você recebe lembretes de medicação e check-ins."
              : estado === "negado"
                ? "Bloqueado nas configurações do navegador."
                : estado === "erro"
                  ? "Não consegui ativar os lembretes agora. Tente de novo daqui a pouco — eles ajudam a não esquecer suas medicações."
                  : "Ative para não esquecer suas medicações."}
          </p>
        </div>
      </div>
      <Button
        size="sm"
        variant={estado === "ativo" ? "outline" : "default"}
        className={
          estado === "ativo"
            ? "portal-tap shrink-0 rounded-lg"
            : "portal-tap shrink-0 rounded-lg bg-primary text-primary-foreground hover:bg-purple-dark"
        }
        disabled={ocupado || estado === "carregando" || estado === "negado"}
        onClick={alternar}
      >
        {ocupado || estado === "carregando" ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : estado === "ativo" ? (
          "Desativar"
        ) : (
          "Ativar"
        )}
      </Button>
    </div>
  )
}
