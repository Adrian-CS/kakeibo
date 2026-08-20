/*
 * Service worker minimo: "network first, cache de reserva".
 *
 * No hay lista de ficheros que mantener: se guarda en cache lo que se va
 * pidiendo, asi que tras la primera visita la app abre sin conexion y
 * siempre que haya red se sirve la version nueva.
 */
const CACHE = 'kakeibo-v1'

self.addEventListener('install', (event) => {
  self.skipWaiting()
  event.waitUntil(caches.open(CACHE))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE)
      try {
        const fresh = await fetch(req)
        if (fresh && fresh.status === 200) cache.put(req, fresh.clone())
        return fresh
      } catch {
        const hit = await cache.match(req)
        if (hit) return hit
        // navegacion sin red: devolvemos el index guardado
        if (req.mode === 'navigate') {
          const index = await cache.match(new URL('./', self.location.href).href)
          if (index) return index
        }
        return new Response('Sin conexion', { status: 503, statusText: 'offline' })
      }
    })(),
  )
})
