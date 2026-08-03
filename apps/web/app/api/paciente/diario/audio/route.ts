import { NextRequest, NextResponse } from "next/server"
import { gatewayFetch } from "@/lib/gateway-fetch"
import { cookies } from "next/headers"
import { isSameOrigin } from "@/lib/same-origin"

const GATEWAY = process.env.API_GATEWAY_URL ?? "http://localhost:5050"

// Tipos de áudio aceitos (gravação do diário no portal). Whitelist estreita: webm/mp4/ogg
// são os formatos que o MediaRecorder do browser emite; mpeg cobre upload manual de .mp3.
const TIPOS_AUDIO_PERMITIDOS = new Set(["audio/webm", "audio/mp4", "audio/ogg", "audio/mpeg"])
// Teto de 25 MB: corta abuso de upload na superfície autenticada sem barrar uma gravação real.
const TAMANHO_MAX_AUDIO = 25 * 1024 * 1024

export async function POST(req: NextRequest) {
  // CSRF (T1-9): cookie de sessão é sameSite=lax e não barra POST cross-site.
  if (!isSameOrigin(req)) {
    return NextResponse.json({ erro: "origem inválida" }, { status: 403 })
  }

  const cookieStore = await cookies()
  const token = cookieStore.get("paciente_token")?.value
  if (!token) {
    return NextResponse.json({ erro: "não autenticado" }, { status: 401 })
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ erro: "body inválido" }, { status: 400 })
  }

  const audio = form.get("audio") as File | null
  if (!audio || audio.size === 0) {
    return NextResponse.json({ erro: "campo 'audio' obrigatório" }, { status: 400 })
  }

  // Validação de tipo: rejeita o que não for áudio reconhecido antes de gastar o gateway.
  if (!TIPOS_AUDIO_PERMITIDOS.has(audio.type)) {
    return NextResponse.json({ erro: "formato de áudio não suportado" }, { status: 415 })
  }

  // Validação de tamanho: corta upload acima do teto antes de encaminhar.
  if (audio.size > TAMANHO_MAX_AUDIO) {
    return NextResponse.json({ erro: "áudio excede o tamanho máximo" }, { status: 413 })
  }

  // Encaminha multipart para o gateway (que converte base64 e chama agents-py)
  const gatewayForm = new FormData()
  gatewayForm.append("audio", audio)

  let res: Response
  try {
    res = await gatewayFetch(`${GATEWAY}/api/v1/portal/paciente/diario/audio/transcrever`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: gatewayForm,
    })
  } catch {
    return NextResponse.json({ erro: "gateway indisponível" }, { status: 502 })
  }

  const body = await res.text()
  return new NextResponse(body, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  })
}
