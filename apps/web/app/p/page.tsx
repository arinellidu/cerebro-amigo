import Link from "next/link"
import { redirect } from "next/navigation"
import { BookText, LogOut, MessageCircle, User } from "lucide-react"
import { gatewayPaciente, GatewayPacienteError } from "@/lib/gateway-paciente"
import { Button } from "@/components/ui/button"
import { AudioRecorder } from "@/components/portal/audio-recorder"
import { FaixaDoDia } from "@/components/portal/faixa-do-dia"
import { InstallPwaBanner } from "@/components/portal/install-pwa-banner"
import { MedsHoje, type TomadaHoje } from "@/components/portal/meds-hoje"
import { sairPaciente } from "./entrar/actions"

interface HomeData {
  perfil: { nome: string; nomeMedico: string }
  tomadasHoje: TomadaHoje[]
  proxConsulta: { iniciaEm: string; modalidade: string; status: string } | null
  ultimoHumor: number | null
  jaRegistrouHumorHoje: boolean
  checkinsPendentes: number
}

function saudacao(d = new Date()) {
  const h = d.getHours()
  if (h < 6) return "Boa madrugada"
  if (h < 12) return "Bom dia"
  if (h < 18) return "Boa tarde"
  return "Boa noite"
}

function horaCurta(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
}

export default async function PortalHome() {
  let data: HomeData
  try {
    data = await gatewayPaciente.get<HomeData>("/api/v1/portal/paciente/home")
  } catch (err) {
    if (err instanceof GatewayPacienteError && (err.status === 401 || err.status === 403)) {
      redirect("/p/entrar")
    }
    throw err
  }

  const primeiroNome = data.perfil.nome?.split(" ")[0] || ""
  const consultaNaFaixa =
    data.checkinsPendentes === 0 &&
    !data.tomadasHoje.some((t) => t.status === "pendente") &&
    data.jaRegistrouHumorHoje &&
    data.proxConsulta != null

  return (
    <div className="space-y-6 p-5 pt-9">
      <header className="portal-rise-in flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="portal-eyebrow">{saudacao()}</p>
          <h1 className="portal-display mt-2 truncate text-[1.9rem] font-medium leading-tight text-foreground">
            {primeiroNome || "Olá"}
          </h1>
          {data.perfil.nomeMedico && (
            <p className="mt-1.5 text-sm text-muted-foreground">
              Acompanhamento com{" "}
              <span className="text-secondary-foreground">{data.perfil.nomeMedico}</span>
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon"
            className="portal-tap h-10 w-10 rounded-full border border-noir-line/70 bg-noir-surface/60 text-muted-foreground hover:text-foreground"
            asChild
            aria-label="Perfil"
          >
            <Link href="/p/perfil">
              <User className="h-[1.15rem] w-[1.15rem]" />
            </Link>
          </Button>
          <form action={sairPaciente}>
            <Button
              variant="ghost"
              size="icon"
              className="portal-tap h-10 w-10 rounded-full border border-noir-line/70 bg-noir-surface/60 text-muted-foreground hover:text-foreground"
              type="submit"
              aria-label="Sair"
            >
              <LogOut className="h-[1.15rem] w-[1.15rem]" />
            </Button>
          </form>
        </div>
      </header>

      <FaixaDoDia
        checkinsPendentes={data.checkinsPendentes ?? 0}
        jaRegistrouHumorHoje={data.jaRegistrouHumorHoje}
        ultimoHumor={data.ultimoHumor}
        tomadasHoje={data.tomadasHoje}
        proxConsulta={data.proxConsulta}
      />

      <div className="portal-rise-in portal-stagger-2">
        <InstallPwaBanner />
      </div>

      <div className="portal-rise-in portal-stagger-3">
        <MedsHoje tomadas={data.tomadasHoje} />
      </div>

      {data.proxConsulta && !consultaNaFaixa && (
        <section className="portal-card portal-hairline portal-rise-in portal-stagger-4 p-4">
          <h2 className="portal-eyebrow mb-2.5">Próxima consulta</h2>
          <p className="text-[0.95rem] font-medium text-foreground">
            {new Date(data.proxConsulta.iniciaEm).toLocaleDateString("pt-BR", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            <span className="nums text-primary">{horaCurta(data.proxConsulta.iniciaEm)}</span>
            {" · "}
            <span className="capitalize">{data.proxConsulta.modalidade}</span>
          </p>
        </section>
      )}

      <div className="portal-rise-in portal-stagger-5 grid grid-cols-2 gap-3">
        <AtalhoCard
          href="/p/conversa"
          icon={<MessageCircle className="h-[1.15rem] w-[1.15rem]" />}
          titulo="Conversar"
          descricao="Desabafe com limites claros"
        />
        <AtalhoCard
          href="/p/diario"
          icon={<BookText className="h-[1.15rem] w-[1.15rem]" />}
          titulo="Diário"
          descricao="Texto ou voz, no seu ritmo"
        />
      </div>

      <div className="portal-rise-in portal-stagger-6">
        <AudioRecorder />
      </div>
    </div>
  )
}

function AtalhoCard({
  href,
  icon,
  titulo,
  descricao,
}: {
  href: string
  icon: React.ReactNode
  titulo: string
  descricao: string
}) {
  return (
    <Link
      href={href}
      className="portal-card portal-tap group flex flex-col gap-3 p-4 hover:border-primary/40"
    >
      <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/15 text-primary transition-transform group-hover:scale-105">
        {icon}
      </span>
      <span>
        <span className="block text-sm font-medium text-foreground">{titulo}</span>
        <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
          {descricao}
        </span>
      </span>
    </Link>
  )
}
