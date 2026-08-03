"use client"

// ADR-066 Fase 4 — foto de perfil do médico (avatar). Upload presigned no S3.

import { useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { useMe } from "@/lib/use-me"
import { iniciais } from "@/lib/iniciais"
import { Loader2, Camera, Check } from "lucide-react"

const MIME_OK = ["image/jpeg", "image/png"]
const MAX_BYTES = 5 * 1024 * 1024

export function FotoPerfil() {
  const me = useMe()
  const fileRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [ok, setOk] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [imgErro, setImgErro] = useState(false)

  // preview (objeto local recém-enviado) tem precedência; fotoUrl presigned pode
  // expirar (60min) e dar 403 → onError cai nas iniciais em vez de imagem quebrada.
  const src = preview || (imgErro ? null : me?.fotoUrl) || null

  async function enviar(file: File) {
    setErro(null); setOk(false)
    if (!MIME_OK.includes(file.type)) { setErro("Use JPG ou PNG."); return }
    if (file.size > MAX_BYTES) { setErro("Imagem grande demais (máx. 5 MB)."); return }
    setEnviando(true)
    try {
      const ur = await fetch("/api/conta/foto/upload-url", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentType: file.type }),
      })
      const u = await ur.json().catch(() => null)
      if (!ur.ok || !u?.uploadUrl) { setErro("Não foi possível iniciar o envio."); return }
      const put = await fetch(u.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type, "x-ms-blob-type": "BlockBlob" },
        body: file,
      })
      if (!put.ok) { setErro("Falha no upload."); return }
      const rr = await fetch("/api/conta/foto", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ s3Key: u.s3Key }),
      })
      if (!rr.ok && rr.status !== 204) { setErro("Falhou ao salvar a foto."); return }
      setPreview(URL.createObjectURL(file))
      setOk(true); setTimeout(() => setOk(false), 3000)
    } catch { setErro("Erro de conexão.") }
    finally { setEnviando(false) }
  }

  return (
    <div className="flex items-center gap-4">
      <div className="h-16 w-16 overflow-hidden rounded-full bg-gradient-to-br from-primary to-purple-dark flex items-center justify-center text-primary-foreground font-semibold shadow-sm">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="Foto de perfil" className="h-full w-full object-cover" onError={() => setImgErro(true)} />
        ) : (
          <span className="text-lg">{iniciais(me?.nome)}</span>
        )}
      </div>
      <div className="space-y-1.5">
        <input
          ref={fileRef} type="file" accept=".jpg,.jpeg,.png" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) enviar(f) }}
        />
        <Button variant="outline" size="sm" className="gap-2" disabled={enviando} onClick={() => fileRef.current?.click()}>
          {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />} Trocar foto
        </Button>
        {ok && <p className="flex items-center gap-1 text-xs text-success"><Check className="h-3.5 w-3.5" /> Foto atualizada</p>}
        {erro && <p role="alert" className="text-xs text-destructive">{erro}</p>}
        {!ok && !erro && <p className="text-xs text-muted-foreground">JPG ou PNG, até 5 MB.</p>}
      </div>
    </div>
  )
}
