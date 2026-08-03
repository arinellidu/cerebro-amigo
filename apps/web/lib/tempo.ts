// Util de tempo puro (sem next/headers) — seguro em client e server.

// "agora", "há 2h", "ontem", "12/05".
export function tempoRelativo(iso: string | null): string {
  if (!iso) return "sem mensagens"
  const d = new Date(iso).getTime()
  const diff = Date.now() - d
  const min = Math.floor(diff / 60000)
  if (min < 1) return "agora"
  if (min < 60) return `há ${min}min`
  const h = Math.floor(min / 60)
  if (h < 24) return `há ${h}h`
  const dias = Math.floor(h / 24)
  if (dias === 1) return "ontem"
  if (dias < 7) return `há ${dias}d`
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })
}
