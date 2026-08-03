"use client"

import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Calendar, MessageSquare, MoreHorizontal } from "lucide-react"
import type { RecentePaciente } from "@/lib/dashboard"
import { tempoRelativo } from "@/lib/tempo"

const delayClass = ["delay-100", "delay-200", "delay-300", "delay-400", "delay-500"]

const SEV_COR: Record<string, string> = {
  critico: "bg-destructive",
  urgente: "bg-warning",
  atencao: "bg-warning",
  info: "bg-primary",
}

export function RecentPatientsWidget({ data }: { data: RecentePaciente[] }) {
  return (
    <Card className="border-border/80 hover:border-primary/25 hover:shadow-[0_4px_24px_rgba(94,75,139,0.07)] transition-all duration-200">
      <CardHeader className="pb-1 pt-5 px-5">
        <div className="flex items-center justify-between">
          <CardTitle className="text-[0.9375rem] font-semibold text-foreground">Pacientes Recentes</CardTitle>
          <Button variant="ghost" size="sm" className="text-primary hover:text-purple-dark text-xs" asChild>
            <Link href="/dashboard/pacientes">Ver todos</Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-3 pt-1 pb-3">
        {data.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            Nenhum paciente ainda. Cadastre o primeiro em Pacientes.
          </p>
        ) : (
          <TooltipProvider>
            <div className="space-y-0.5">
              {data.map((patient, i) => (
                <Link
                  key={patient.id}
                  href={`/dashboard/pacientes?p=${patient.id}`}
                  className={`flex items-center gap-3 px-3 py-2 rounded-xl mx-0.5 hover:bg-primary/[0.04] transition-colors cursor-pointer group animate-fade-left ${delayClass[i]}`}
                >
                  <Avatar className="h-10 w-10 bg-secondary text-primary text-[0.8rem] font-semibold border-2 border-primary/20">
                    <AvatarFallback>{patient.iniciais}</AvatarFallback>
                  </Avatar>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium text-foreground truncate">{patient.nome}</span>
                      {patient.severidade && (
                        <span
                          className={`h-2 w-2 rounded-full flex-shrink-0 ${SEV_COR[patient.severidade] ?? "bg-primary"}`}
                        />
                      )}
                    </div>
                    <div className="flex gap-3 mt-0.5">
                      <span className="text-xs text-muted-foreground">
                        Paciente {String(patient.numero).padStart(2, "0")}
                      </span>
                      <span className="text-xs text-primary font-medium">{tempoRelativo(patient.ultimaMsg)}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="grid h-7 w-7 place-items-center text-muted-foreground hover:text-primary">
                          <Calendar size={15} />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>Agendar</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="grid h-7 w-7 place-items-center text-muted-foreground hover:text-primary">
                          <MessageSquare size={15} />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>Mensagem</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="grid h-7 w-7 place-items-center text-muted-foreground hover:text-foreground">
                          <MoreHorizontal size={15} />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>Mais opções</TooltipContent>
                    </Tooltip>
                  </div>
                </Link>
              ))}
            </div>
          </TooltipProvider>
        )}
      </CardContent>
    </Card>
  )
}

export function RecentPatientsSkeleton() {
  return (
    <Card className="border-border/80">
      <CardHeader className="pb-1 pt-5 px-5">
        <div className="h-4 w-36 rounded bg-muted animate-pulse" />
      </CardHeader>
      <CardContent className="px-3 pt-1 pb-3">
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-2">
              <div className="h-10 w-10 rounded-full bg-muted animate-pulse" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3.5 w-32 rounded bg-muted animate-pulse" />
                <div className="h-3 w-24 rounded bg-muted animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
