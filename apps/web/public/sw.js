// Service Worker do portal do paciente (Cérebro Amigo).
// Responsabilidades:
//   1. Cache de assets estáticos (shell do PWA) para funcionamento offline.
//   2. Receber Web Push e abrir a tela certa no clique.
//   3. Fallback offline para navegação (pagina offline.html).
//
// Estratégia de cache:
//   - Precache: /p, /p/conversa, /p/diario, /p/medicacoes, CSS, fontes, icons.
//   - Runtime (stale-while-revalidate): API calls (/api/paciente/*) — serve do
//     cache enquanto busca atualização em background.
//   - Network-first: HTML pages — tenta rede, cai para cache.

const CACHE_NAME = 'ca-pwa-v1'
const PRECACHE_ASSETS = [
  '/p',
  '/p/conversa',
  '/p/diario',
  '/p/medicacoes',
  '/p/humor',
  '/p/checkins',
  '/p/perfil',
  '/offline.html',
  '/manifest.json',
  '/icon-light-32x32.png',
  '/icon-light-192x192.png',
  '/icon-light-512x512.png',
  '/apple-icon.png',
]

// ─── Instalação: pré-cache do shell ────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting()),
  )
})

// ─── Ativação: limpa caches antigos ───────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

// ─── Fetch: estratégia por tipo de request ─────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Ignora requests não-GET e non-HTTP(S)
  if (request.method !== 'GET') return

  // 0. SSE / streaming (EventSource): NUNCA interceptar. cache.put(clone) num
  //    stream infinito trava a conexão → EventSource reconecta em loop (~3s) e a
  //    sinalização da teleconsulta nunca completa. Deixa passar direto pra rede.
  if (request.headers.get('accept')?.includes('text/event-stream')) return

  // 1. API calls → stale-while-revalidate (cache em background)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(staleWhileRevalidate(request))
    return
  }

  // 2. HTML navigation → network-first (cai para cache)
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request))
    return
  }

  // 3. Assets estáticos → cache-first
  event.respondWith(cacheFirst(request))
})

// ─── Estratégias de cache ─────────────────────────────────────────────────

async function cacheFirst(request) {
  const cached = await caches.match(request)
  if (cached) return cached
  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME)
      cache.put(request, response.clone())
    }
    return response
  } catch {
    // Sem cache e sem rede: retorna 503 vazio
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' })
  }
}

async function networkFirst(request) {
  try {
    const networkResponse = await fetch(request)
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME)
      cache.put(request, networkResponse.clone())
    }
    return networkResponse
  } catch {
    const cached = await caches.match(request)
    if (cached) return cached
    // Fallback: offline.html, depois /p, depois texto puro.
    const offlinePage = await caches.match('/offline.html')
    if (offlinePage) return offlinePage
    const fallback = await caches.match('/p')
    if (fallback) return fallback
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' })
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME)
  const cached = await cache.match(request)

  const fetchPromise = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone())
      return response
    })
    .catch(() => cached)

  // Retorna cache imediatamente (mesmo que stale); atualiza em background.
  return cached || fetchPromise
}

// ─── Web Push ─────────────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  let data = { titulo: 'Cérebro Amigo', corpo: '', url: '/p' }
  try {
    if (event.data) data = { ...data, ...event.data.json() }
  } catch {
    if (event.data) data.corpo = event.data.text()
  }

  const options = {
    body: data.corpo,
    icon: '/icon-light-32x32.png',
    badge: '/icon-light-32x32.png',
    data: { url: data.url || '/p' },
    tag: data.tag || undefined,
    renotify: false,
  }

  event.waitUntil(self.registration.showNotification(data.titulo, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/p'

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if (client.url.includes('/p') && 'focus' in client) {
            client.focus()
            if ('navigate' in client) client.navigate(url)
            return
          }
        }
        if (self.clients.openWindow) return self.clients.openWindow(url)
      }),
  )
})
