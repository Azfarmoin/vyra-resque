// Small sliding-window limiter. In-memory, so it is per server instance: on serverless hosting each
// instance counts separately. It stops a runaway client or loop; put a shared limiter (Redis, edge
// middleware) in front if you need a hard global cap.
import { rateLimitsDisabled } from '../devFlags'
const g = globalThis as unknown as { __vyraRate?: Map<string, number[]> }

export function checkRateLimit(key: string, { limit = 12, windowMs = 60_000, now = Date.now() } = {}): { ok: true } | { ok: false; retryAfterS: number } {
  if (rateLimitsDisabled()) return { ok: true }
  const hits: Map<string, number[]> = (g.__vyraRate ??= new Map())
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs)
  if (recent.length >= limit) {
    hits.set(key, recent)
    return { ok: false, retryAfterS: Math.max(1, Math.ceil((windowMs - (now - recent[0])) / 1000)) }
  }
  recent.push(now)
  hits.set(key, recent)
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k)
  return { ok: true }
}

export const resetRateLimits = () => {
  g.__vyraRate = new Map()
}
