// Helper de Web Push no client. Registra o service worker e gerencia a
// subscription junto ao BFF (/api/paciente/push). Sem segredo aqui — só a
// VAPID public key (NEXT_PUBLIC_*). O envio real é do notifier-py.

const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""

export function pushSuportado(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  )
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/")
  const raw = atob(b64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

async function registrarSW(): Promise<ServiceWorkerRegistration> {
  const reg = await navigator.serviceWorker.register("/sw.js")
  await navigator.serviceWorker.ready
  return reg
}

export async function statusPush(): Promise<"ativo" | "inativo" | "negado"> {
  if (!pushSuportado()) return "inativo"
  if (Notification.permission === "denied") return "negado"
  const reg = await navigator.serviceWorker.getRegistration("/sw.js")
  const sub = await reg?.pushManager.getSubscription()
  return sub ? "ativo" : "inativo"
}

export async function ativarPush(): Promise<"ativo" | "negado" | "erro"> {
  if (!pushSuportado() || !VAPID_PUBLIC) return "erro"
  const permissao = await Notification.requestPermission()
  if (permissao !== "granted") return "negado"

  const reg = await registrarSW()
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC),
    })
  }

  const res = await fetch("/api/paciente/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sub.toJSON()),
  })
  return res.ok ? "ativo" : "erro"
}

export async function desativarPush(): Promise<boolean> {
  if (!pushSuportado()) return false
  const reg = await navigator.serviceWorker.getRegistration("/sw.js")
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return true
  await fetch("/api/paciente/push", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  })
  await sub.unsubscribe()
  return true
}
