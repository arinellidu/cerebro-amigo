"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Mic, PenLine, ArrowLeft, Check, Edit3, Tag, SmilePlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { AudioDiario, type TranscricaoResult } from "@/components/portal/AudioDiario"
import { CrisisSupportPanel } from "@/components/portal/crisis-support-panel"
import { cn } from "@/lib/utils"

// ─── Tipos ───────────────────────────────────────────────────────────────────

type Modo = "escolha" | "audio-gravando" | "audio-revisao" | "texto" | "crise"
type SalvandoState = "idle" | "salvando" | "erro" | "indisponivel"

// ─── Página principal ────────────────────────────────────────────────────────

export default function NovaDiarioPage() {
  const router = useRouter()
  const [modo, setModo] = useState<Modo>("escolha")
  const [salvando, setSalvando] = useState<SalvandoState>("idle")

  // Campos do formulário
  const [titulo, setTitulo] = useState("")
  const [conteudo, setConteudo] = useState("")
  const [humor, setHumor] = useState<number | null>(null)
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState("")
  const [compartilhar, setCompartilhar] = useState(true)

  // Dados específicos de áudio
  const [transcricao, setTranscricao] = useState<string | null>(null)
  const [analise, setAnalise] = useState<TranscricaoResult | null>(null)

  // Texto fixo de acolhimento de crise (vem do backend — crisis_copy)
  const [criseTexto, setCriseTexto] = useState<string | null>(null)

  // ─── Callback pós-transcrição ──────────────────────────────────────────────

  const onTranscricao = (data: TranscricaoResult) => {
    // Crise detectada na fala: NÃO mostra form nem análise — só o acolhimento.
    if (data.crise && data.crise_texto) {
      setCriseTexto(data.crise_texto)
      setModo("crise")
      return
    }
    setAnalise(data)
    setTranscricao(data.transcricao)
    setConteudo(data.transcricao)
    if (data.humor_estimado) setHumor(data.humor_estimado)
    if (data.tags_sugeridas.length > 0) setTags(data.tags_sugeridas)
    setModo("audio-revisao")
  }

  // ─── Adicionar tag ────────────────────────────────────────────────────────

  const adicionarTag = () => {
    const t = tagInput.trim().toLowerCase()
    if (t && !tags.includes(t) && tags.length < 5) {
      setTags([...tags, t])
      setTagInput("")
    }
  }

  const removerTag = (t: string) => setTags(tags.filter(x => x !== t))

  // ─── Salvar ───────────────────────────────────────────────────────────────

  const salvar = async () => {
    if (!conteudo.trim()) return
    setSalvando("salvando")

    try {
      const res = await fetch("/api/paciente/diario", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titulo: titulo.trim() || null,
          conteudo: conteudo.trim(),
          humor,
          tags,
          compartilharComMedico: compartilhar,
          tipo: transcricao ? "audio" : "texto",
          transcricao: transcricao ?? null,
        }),
      })

      // Triagem indisponível (503): não foi salvo nem triado — pedir retry.
      if (res.status === 503) {
        setSalvando("indisponivel")
        return
      }

      const body = await res.json().catch(() => null)

      // Crise detectada no texto: entrada NÃO foi salva, mostra acolhimento.
      if (body?.crise && body?.criseTexto) {
        setCriseTexto(body.criseTexto)
        setModo("crise")
        return
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      router.push("/p/diario")
      router.refresh()
    } catch {
      setSalvando("erro")
    }
  }

  // ─── Renderização por modo ────────────────────────────────────────────────

  return (
    <div className="space-y-6 p-5 pt-9">
      {/* Header */}
      <div className="portal-rise-in flex items-center gap-3">
        <button
          type="button"
          onClick={() => router.back()}
          className="portal-tap inline-flex h-9 w-9 items-center justify-center rounded-full border border-noir-line/70 bg-noir-surface/70 text-muted-foreground hover:text-foreground"
          aria-label="Voltar"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div>
          <p className="portal-eyebrow">Diário</p>
          <h1 className="portal-display mt-1 text-[1.5rem] font-medium leading-tight text-foreground">
            {modo === "crise" ? "Estamos com você" : "Nova entrada"}
          </h1>
        </div>
      </div>

      {/* ── Acolhimento de crise (texto fixo do backend, NUNCA editável) ─── */}
      {modo === "crise" && criseTexto && (
        <CrisisSupportPanel
          texto={criseTexto}
          voltarLabel="Voltar ao diário"
          onVoltar={() => router.push("/p/diario")}
        />
      )}

      {/* ── Tela de escolha ─────────────────────────────────────────────── */}
      {modo === "escolha" && (
        <div className="portal-rise-in portal-stagger-2 space-y-3.5">
          <p className="text-center text-sm text-muted-foreground">
            Como você quer registrar hoje?
          </p>

          <button
            type="button"
            onClick={() => setModo("audio-gravando")}
            className="portal-card portal-tap flex w-full flex-col items-center gap-3 border-primary/30 p-6 hover:border-primary/50"
          >
            <span className="grid h-16 w-16 place-items-center rounded-2xl bg-primary/15 text-primary ring-1 ring-primary/20">
              <Mic className="h-7 w-7" />
            </span>
            <span className="text-center">
              <span className="block font-semibold text-foreground">Gravar áudio</span>
              <span className="mt-0.5 block text-sm text-muted-foreground">
                Fale como está se sentindo (até 60 segundos)
              </span>
            </span>
          </button>

          <button
            type="button"
            onClick={() => setModo("texto")}
            className="portal-card portal-tap flex w-full flex-col items-center gap-3 p-6 hover:border-primary/40"
          >
            <span className="grid h-16 w-16 place-items-center rounded-2xl bg-noir-surface-raised text-muted-foreground ring-1 ring-noir-line">
              <PenLine className="h-7 w-7" />
            </span>
            <span className="text-center">
              <span className="block font-semibold text-foreground">Escrever</span>
              <span className="mt-0.5 block text-sm text-muted-foreground">
                Digite sua entrada no diário
              </span>
            </span>
          </button>
        </div>
      )}

      {/* ── Gravação de áudio ────────────────────────────────────────────── */}
      {modo === "audio-gravando" && (
        <div className="portal-rise-in portal-stagger-2 flex flex-col items-center">
          <p className="mb-2 text-center text-sm text-muted-foreground">
            Fale livremente — conte como está se sentindo, o que aconteceu, o que pensa.
          </p>
          <AudioDiario
            onTranscricao={onTranscricao}
            onCancelar={() => setModo("escolha")}
          />
        </div>
      )}

      {/* ── Revisão pós-áudio + formulário ──────────────────────────────── */}
      {(modo === "audio-revisao" || modo === "texto") && (
        <div className="portal-rise-in portal-stagger-2 space-y-5">
          {/* Banner de análise (apenas para áudio) */}
          {analise && modo === "audio-revisao" && (
            <div className="portal-card portal-hairline space-y-3 p-4">
              <div className="flex items-center gap-2">
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/12 text-primary">
                  <Mic className="h-4 w-4" />
                </span>
                <span className="text-sm font-medium text-foreground">Transcrição pronta</span>
                {analise.emocao_predominante !== "neutro" && (
                  <Badge variant="secondary" className="text-xs capitalize">
                    {analise.emocao_predominante}
                  </Badge>
                )}
              </div>
              {analise.sintomas_detectados.length > 0 && (
                <div>
                  <p className="mb-1 text-xs text-muted-foreground">Detectado na fala:</p>
                  <div className="flex flex-wrap gap-1">
                    {analise.sintomas_detectados.map((s) => (
                      <Badge key={s} variant="outline" className="text-xs">
                        {s}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <Edit3 className="h-3 w-3" />
                Revise e edite a transcrição abaixo antes de salvar
              </p>
            </div>
          )}

          {/* Título (opcional) */}
          <div className="space-y-1.5">
            <Label htmlFor="titulo" className="text-sm">
              Título <span className="text-muted-foreground">(opcional)</span>
            </Label>
            <Input
              id="titulo"
              placeholder="Como foi o dia…"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              maxLength={200}
              className="h-11 rounded-xl bg-noir-surface-raised/60"
            />
          </div>

          {/* Conteúdo */}
          <div className="space-y-1.5">
            <Label htmlFor="conteudo" className="text-sm">
              {transcricao ? "Transcrição (edite se necessário)" : "Como você está?"}
            </Label>
            <Textarea
              id="conteudo"
              placeholder="Escreva o que quiser…"
              value={conteudo}
              onChange={(e) => setConteudo(e.target.value)}
              rows={6}
              className="resize-none rounded-xl bg-noir-surface-raised/60"
            />
          </div>

          {/* Humor */}
          <div className="space-y-2">
            <Label className="flex items-center gap-1 text-sm">
              <SmilePlus className="h-4 w-4" />
              Humor agora
            </Label>
            <div className="grid grid-cols-10 gap-1.5">
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setHumor(humor === n ? null : n)}
                  className={cn(
                    "nums portal-tap aspect-square rounded-xl text-sm font-medium transition-colors",
                    humor === n
                      ? "bg-primary text-primary-foreground shadow-[0_8px_20px_-10px_var(--noir-glow-purple)]"
                      : "bg-noir-surface-raised text-muted-foreground ring-1 ring-noir-line hover:text-foreground",
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
            {humor && (
              <p className="text-xs text-muted-foreground">
                {humor >= 8
                  ? "😊 Bem"
                  : humor >= 6
                    ? "🙂 OK"
                    : humor >= 4
                      ? "😐 Mais ou menos"
                      : humor >= 2
                        ? "😔 Mal"
                        : "😢 Muito mal"}
              </p>
            )}
          </div>

          {/* Tags */}
          <div className="space-y-2">
            <Label className="flex items-center gap-1 text-sm">
              <Tag className="h-4 w-4" />
              Tags
            </Label>
            <div className="flex gap-2">
              <Input
                placeholder="sono, trabalho, ansiedade…"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), adicionarTag())}
                className="h-11 flex-1 rounded-xl bg-noir-surface-raised/60"
                maxLength={30}
              />
              <Button
                type="button"
                variant="outline"
                onClick={adicionarTag}
                disabled={tags.length >= 5}
                className="portal-tap h-11 rounded-xl"
              >
                Adicionar
              </Button>
            </div>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {tags.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => removerTag(t)}
                    className="rounded-full bg-secondary px-2.5 py-1 text-xs text-secondary-foreground transition-colors hover:bg-destructive/20 hover:text-destructive"
                  >
                    {t} ×
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Compartilhar com médico */}
          <div className="portal-card flex items-center justify-between p-4">
            <div>
              <p className="text-sm font-medium text-foreground">Compartilhar com médico</p>
              <p className="text-xs text-muted-foreground">
                Ativo: sua psiquiatra poderá ler esta entrada
              </p>
            </div>
            <Switch checked={compartilhar} onCheckedChange={setCompartilhar} />
          </div>

          {/* Erro ao salvar */}
          {salvando === "erro" && (
            <p className="text-center text-sm text-destructive">
              Não foi possível salvar. Tente novamente.
            </p>
          )}
          {salvando === "indisponivel" && (
            <p className="text-center text-sm text-destructive">
              Não foi possível processar sua entrada agora. Tente novamente em instantes.
            </p>
          )}

          {/* Ações */}
          <div className="flex gap-3 pt-1">
            <Button
              variant="outline"
              className="portal-tap h-11 flex-1 rounded-xl"
              onClick={() => {
                if (transcricao) setModo("audio-gravando")
                else setModo("escolha")
              }}
            >
              Voltar
            </Button>
            <Button
              className="portal-tap h-11 flex-1 rounded-xl bg-primary hover:bg-purple-dark"
              onClick={salvar}
              disabled={!conteudo.trim() || salvando === "salvando"}
            >
              {salvando === "salvando" ? (
                "Salvando…"
              ) : (
                <>
                  <Check className="mr-1 h-4 w-4" />
                  Salvar
                </>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
