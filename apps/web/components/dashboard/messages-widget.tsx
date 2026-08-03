"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { CheckCheck, Loader2 } from "lucide-react"
import { tempoRelativo } from "@/lib/tempo"
import { iniciais } from "@/lib/iniciais"

interface ConversaInbox {
  pacienteId: string
  pacienteNome: string | null
  ultimaMensagem: string
  ultimaEm: string
  ultimoPapel: string
  total: number
}

const delayClass = ["delay-100", "delay-200", "delay-300"]

export function MessagesWidget() {
  const [inbox, setInbox] = useState<ConversaInbox[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/mensagens")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => setInbox(Array.isArray(rows) ? rows : []))
      .catch(() => setInbox([]))
      .finally(() => setLoading(false))
  }, [])

  return (
    <Card className="border-border/80 hover:border-primary/25 hover:shadow-[0_4px_24px_rgba(94,75,139,0.07)] transition-all duration-200">
      <CardHeader className="pb-1 pt-5 px-5">
        <CardTitle className="text-[0.9375rem] font-semibold text-foreground">Conversas recentes</CardTitle>
      </CardHeader>
      <CardContent className="px-3 pt-1 pb-3">
        {loading ? (
          <div className="flex justify-center py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : inbox.length === 0 ? (
          <p className="px-3 py-8 text-center text-xs text-muted-foreground">Nenhuma conversa ainda.</p>
        ) : (
          <div className="space-y-0.5">
            {inbox.slice(0, 3).map((msg, i) => (
              <Link
                key={msg.pacienteId}
                href="/dashboard/mensagens"
                className={`flex items-start gap-3 px-3 py-2.5 mx-1 rounded-xl cursor-pointer transition-colors animate-fade-in ${delayClass[i]} hover:bg-primary/[0.03]`}
              >
                <Avatar className="mt-0.5 h-[38px] w-[38px] flex-shrink-0 border-2 border-primary/20 bg-secondary text-[0.75rem] font-bold text-primary">
                  <AvatarFallback>{iniciais(msg.pacienteNome, "?")}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-foreground">
                      {msg.pacienteNome ?? "Paciente"}
                    </span>
                    <span className="flex-shrink-0 text-[11px] text-muted-foreground">
                      {tempoRelativo(msg.ultimaEm)}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1">
                    {msg.ultimoPapel === "assistant" && (
                      <CheckCheck size={11} className="flex-shrink-0 text-primary" />
                    )}
                    <span className="truncate text-xs text-muted-foreground">{msg.ultimaMensagem}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
        <Button
          variant="ghost"
          asChild
          className="mt-1 h-8 w-full text-xs text-primary hover:bg-secondary hover:text-purple-dark"
        >
          <Link href="/dashboard/mensagens">Ver todas as mensagens</Link>
        </Button>
      </CardContent>
    </Card>
  )
}
