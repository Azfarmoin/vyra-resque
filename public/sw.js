<<<<<<< HEAD
// VYRA service worker (offline-first reporting).
//
// WHAT IS CACHED: only public, static material, i.e. the app shell for the pages people need without a
// connection ("/", "/report", "/report/saved", and the /safety guides), the offline fallback page, icons and the hashed
// /_next/static build files. Those HTML files are generic shells with no personal data in them.
// WHAT IS NEVER CACHED: /api/* (reports, photos, auth), dashboards, report status pages, anything cross-origin,
// authorization tokens. Reports and photos live in IndexedDB (see src/lib/offline), not here.
const VERSION = 'v3'
const SHELL_CACHE = `vyra-shell-${VERSION}`
const STATIC_CACHE = 'vyra-static' // hashed, immutable build files: kept across versions so old open tabs keep working
const MAX_STATIC_ENTRIES = 400
// The safety guides are static pages, so they are kept for offline use from the first visit.
const GUIDES = ['flood', 'urban-flood', 'earthquake', 'fire', 'collapse', 'storm', 'landslide', 'heat', 'electrical', 'road', 'chemical', 'tsunami']
const PAGES = ['/', '/report', '/report/saved', '/alerts', '/map', '/safety', '/safety/now', ...GUIDES.map((g) => `/safety/${g}`)]
const PRECACHE = [...PAGES, '/offline.html', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png']
const NAV_TIMEOUT_MS = 4000

const isStaticBuildFile = (path) => path.startsWith('/_next/static/')

function buildFilesIn(html) {
  const found = new Set()
  for (const m of html.matchAll(/\/_next\/static\/[A-Za-z0-9_\-./%~@+]+\.(?:js|css|woff2?)/g)) found.add(m[0])
  for (const m of html.matchAll(/static\/(?:chunks|css|media)\/[A-Za-z0-9_\-./%~@+]+\.(?:js|css|woff2?)/g)) found.add(`/_next/${m[0]}`)
  return [...found]
}

async function cacheStatic(urls) {
  const cache = await caches.open(STATIC_CACHE)
  await Promise.all(
    urls.map(async (u) => {
      try {
        if (await cache.match(u)) return
        const res = await fetch(u)
        if (res.ok) await cache.put(u, res)
      } catch (e) {
        /* offline or missing: the page still works from what is cached */
      }
    })
  )
  const keys = await cache.keys()
  if (keys.length > MAX_STATIC_ENTRIES) await Promise.all(keys.slice(0, keys.length - MAX_STATIC_ENTRIES).map((k) => cache.delete(k)))
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const shell = await caches.open(SHELL_CACHE)
      const chunkUrls = new Set()
      await Promise.all(
        PRECACHE.map(async (url) => {
          try {
            const res = await fetch(url, { cache: 'reload' })
            if (!res.ok) return
            if ((res.headers.get('content-type') || '').includes('text/html') && url !== '/offline.html') {
              buildFilesIn(await res.clone().text()).forEach((u) => chunkUrls.add(u))
            }
            await shell.put(url, res)
          } catch (e) {
            /* keep installing: offline.html is the only hard requirement */
          }
        })
      )
      await cacheStatic([...chunkUrls])
      if (!(await shell.match('/offline.html'))) throw new Error('offline.html could not be cached')
      await self.skipWaiting()
    })()
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(names.filter((n) => n.startsWith('vyra-shell-') && n !== SHELL_CACHE).map((n) => caches.delete(n)))
      await caches.delete('vyra-shell-v1')
      await self.clients.claim()
    })()
  )
})

// The page tells us which build files it actually loaded (including lazily loaded map code) so the form
// opens offline next time. Only same-origin /_next/static/ files are accepted.
self.addEventListener('message', (event) => {
  const data = event.data || {}
  if (data.type === 'SKIP_WAITING') self.skipWaiting()
  if (data.type === 'CACHE_URLS' && Array.isArray(data.urls)) {
    const safe = data.urls
      .map((u) => {
        try {
          const url = new URL(u, self.location.origin)
          return url.origin === self.location.origin ? url.pathname : null
        } catch (e) {
          return null
        }
      })
      .filter((p) => p && isStaticBuildFile(p))
    event.waitUntil(cacheStatic([...new Set(safe)]))
  }
})

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms)
    promise.then((v) => { clearTimeout(t); resolve(v) }, (e) => { clearTimeout(t); reject(e) })
  })
}

async function handleNavigation(request) {
  const path = new URL(request.url).pathname.replace(/\/$/, '') || '/'
  const shell = await caches.open(SHELL_CACHE)
  const isShellPage = PAGES.includes(path)
  try {
    // A flaky "lie-fi" connection must not leave the form hanging: after a few seconds use the cached shell.
    const res = await withTimeout(fetch(request), isShellPage ? NAV_TIMEOUT_MS : 15000)
    if (res.ok && isShellPage) shell.put(path, res.clone())
    return res
  } catch (e) {
    if (isShellPage) {
      const cached = await shell.match(path)
      if (cached) return cached
    }
    // A safety page that was never saved falls back to the safety index.
    if (path.startsWith('/safety')) { const idx = await shell.match('/safety'); if (idx) return idx }
    // Any other page (dashboard, status page...) cannot work offline: send people to the form instead.
    return (await shell.match('/report')) || (await shell.match('/offline.html')) || Response.error()
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return // map tiles etc.: never touched
  if (url.pathname.startsWith('/api/')) return // private data: always the network, never the cache
  if (url.searchParams.has('_rsc') || request.headers.get('RSC')) return // Next client-side navigation data

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request))
    return
  }
  if (isStaticBuildFile(url.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC_CACHE)
        const hit = await cache.match(request)
        if (hit) return hit
        const res = await fetch(request)
        if (res.ok) cache.put(request, res.clone())
        return res
      })()
    )
    return
  }
  if (url.pathname.startsWith('/icons/') || url.pathname === '/manifest.webmanifest' || url.pathname === '/offline.html') {
    event.respondWith(
      (async () => {
        const shell = await caches.open(SHELL_CACHE)
        const hit = await shell.match(url.pathname)
        if (hit) return hit
        return fetch(request)
      })()
    )
  }
})

// ---- Early-warning push notifications ---------------------------------------------------------
// The payload is minimal (title, short body, link): it carries no location. A notice only appears when the push
// service delivered it, which needs a working internet connection on the device.
self.addEventListener('push', event => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch (e) { /* ignore malformed payload */ }
  const title = typeof data.title === 'string' ? data.title.slice(0, 120) : 'VYRA alert'
  const body = typeof data.body === 'string' ? data.body.slice(0, 200) : 'Open VYRA for details.'
  // Only same-origin relative links are followed.
  const url = typeof data.url === 'string' && data.url.startsWith('/') && !data.url.startsWith('//') ? data.url : '/alerts'
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag: typeof data.tag === 'string' ? data.tag : 'vyra-alert', // same alert replaces its earlier notice
      renotify: false,
      requireInteraction: data.severity === 'emergency',
      data: { url },
    })
  )
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/alerts'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if ('focus' in c) { c.navigate(url); return c.focus() }
      }
      return self.clients.openWindow(url)
    })
  )
})
=======
// VYRA service worker: keeps the app shell (especially /report) loadable offline.
// API calls are never cached; offline reports are queued in IndexedDB by the page.
const CACHE = 'vyra-shell-v1'
const PRECACHE = ['/', '/report']

self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then(cache => Promise.all(PRECACHE.map(url => cache.add(url).catch(() => undefined))))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

async function networkFirst(request, fallbackUrl) {
  const cache = await caches.open(CACHE)
  try {
    const response = await fetch(request)
    if (response.ok) cache.put(request, response.clone())
    return response
  } catch (err) {
    const cached = (await cache.match(request, { ignoreVary: true })) || (fallbackUrl && (await cache.match(fallbackUrl)))
    if (cached) return cached
    throw err
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE)
  const cached = await cache.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response.ok) cache.put(request, response.clone())
  return response
}

self.addEventListener('fetch', event => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request))
  } else if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, '/report'))
  } else {
    event.respondWith(networkFirst(request))
  }
})
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
