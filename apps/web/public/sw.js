// Push notification handler
self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? { title: 'Meowlendar', body: 'You have a notification' }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url },
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/'
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (new URL(client.url).pathname === url && 'focus' in client) {
          return client.focus()
        }
      }
      return clients.openWindow(url)
    })
  )
})

// Basic offline caching (app shell). Bumping CACHE_NAME purges every older
// cache on activate — required whenever bundled CSS/JS changes shape (e.g.
// the Meowlendar rebrand: stale poolendar-v2 kept serving the dark-only CSS;
// v4 is the V2 redesign, whose new icons would otherwise stay cache-first stale).
const CACHE_NAME = 'meowlendar-v4'
const PRECACHE = ['/', '/manifest.json']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return

  const url = new URL(event.request.url)

  // Network-first for API calls and auth routes — never serve stale data
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/callback')) {
    event.respondWith(fetch(event.request))
    return
  }

  // Cache-first for immutable media (images, fonts). JS/CSS deliberately
  // fall through to network-first below: cache-first bundles served stale
  // UI after every redesign, and in dev it fights HMR.
  if (url.pathname.match(/\.(png|jpg|jpeg|svg|webp|woff2?|ico)$/)) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached
        return fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone))
          }
          return response
        })
      })
    )
    return
  }

  // Network-first for navigation and other requests, fall back to cache
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone))
        }
        return response
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match('/')))
  )
})
