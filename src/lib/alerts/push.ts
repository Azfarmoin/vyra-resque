// Standards-based Web Push (RFC 8030 / VAPID) via the `web-push` package.
// The sender is injected everywhere it is used, so tests never need the package or the network.

export interface PushTarget { endpoint: string; keys: { p256dh: string; auth: string } }
export type PushResult = { ok: true } | { ok: false; status: number; message: string }
export type PushSender = (target: PushTarget, payload: string) => Promise<PushResult>

// Push services whose endpoints we will contact. The server POSTs to whatever endpoint a browser registered, so an
// open list would let anyone make the server call internal addresses (SSRF). Extend with ALERT_PUSH_HOST_SUFFIXES.
const DEFAULT_SUFFIXES = ['fcm.googleapis.com', 'push.services.mozilla.com', 'push.apple.com', 'notify.windows.com']

export function isAllowedPushEndpoint(endpoint: string, extra = ''): boolean {
  let u: URL
  try { u = new URL(endpoint) } catch { return false }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return false
  const host = u.hostname.toLowerCase()
  if (/^[\d.]+$/.test(host) || host.includes(':') || host === 'localhost') return false // no IP literals
  const suffixes = [...DEFAULT_SUFFIXES, ...extra.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)]
  return suffixes.some((s) => host === s || host.endsWith(`.${s}`))
}

export function vapidConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT)
}

export async function createWebPushSender(env: Record<string, string | undefined> = process.env): Promise<PushSender | null> {
  if (!vapidConfigured(env)) return null
  const mod = await import('web-push')
  const webpush = (mod as unknown as { default?: typeof import('web-push') }).default ?? (mod as unknown as typeof import('web-push'))
  webpush.setVapidDetails(env.VAPID_SUBJECT!, env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!)
  return async (target, payload) => {
    try {
      await webpush.sendNotification(target, payload, { TTL: 3600, urgency: 'high' })
      return { ok: true }
    } catch (e) {
      const err = e as { statusCode?: number; message?: string }
      return { ok: false, status: err.statusCode ?? 0, message: (err.message || 'push failed').replace(/https?:\/\/\S+/g, '[url]').slice(0, 200) }
    }
  }
}
