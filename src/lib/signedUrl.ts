// Short-lived signed links to a private photo. The link is minted by the server only after it checked that
// the caller is staff, expires in minutes, and names exactly one photo of one report.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const SIGNED_URL_TTL_S = 300
const g = globalThis as unknown as { __vyraSignSecret?: string }
// SUPABASE_SERVICE_ROLE_KEY / VYRA_SIGNING_SECRET exist only on the server. Without either, a random per-process
// secret is used (links then stop working after a restart, which is fine for short-lived links).
const secret = () => process.env.VYRA_SIGNING_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || (g.__vyraSignSecret ??= randomBytes(32).toString('hex'))
const mac = (reportId: string, attId: string, exp: number) => createHmac('sha256', secret()).update(`${reportId}.${attId}.${exp}`).digest('hex')

export function signPhotoUrl(reportId: string, attId: string, now = Date.now()) {
  const exp = Math.floor(now / 1000) + SIGNED_URL_TTL_S
  return { url: `/api/reports/${reportId}/attachments/${attId}?exp=${exp}&sig=${mac(reportId, attId, exp)}`, expires_at: new Date(exp * 1000).toISOString() }
}

export function verifyPhotoSignature(reportId: string, attId: string, exp: string | null, sig: string | null, now = Date.now()): boolean {
  const e = Number(exp)
  if (!sig || !Number.isInteger(e) || e * 1000 < now || e * 1000 > now + (SIGNED_URL_TTL_S + 5) * 1000) return false
  const a = Buffer.from(sig, 'hex')
  const b = Buffer.from(mac(reportId, attId, e), 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}
