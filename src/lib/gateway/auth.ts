// Gateways (radio bridges, SMS provider webhooks, operators importing files) authenticate with a shared secret that only
// the server and the gateway know. Without a configured key, gateway ingestion is switched off entirely.
import { timingSafeEqual } from 'node:crypto'

export const MIN_KEY_LENGTH = 16

export function gatewayConfigured(): boolean {
  return (process.env.GATEWAY_API_KEY ?? '').length >= MIN_KEY_LENGTH
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export function checkGatewayKey(req: Request): 'ok' | 'unconfigured' | 'invalid' {
  if (!gatewayConfigured()) return 'unconfigured'
  const h = req.headers.get('authorization') || ''
  const token = h.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : ''
  return token && safeEqual(token, process.env.GATEWAY_API_KEY!) ? 'ok' : 'invalid'
}
