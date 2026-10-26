// Cron-secret check, kept free of framework imports so it can be unit-tested.
export function cronAuthorised(request: { headers: { get(name: string): string | null } }, env: Record<string, string | undefined> = process.env): { ok: true } | { ok: false; status: number; error: string } {
  const secret = env.CRON_SECRET
  if (!secret || secret.length < 16) return { ok: false, status: 503, error: 'CRON_SECRET is not set (needs 16+ characters), so scheduled monitoring is disabled.' }
  const got = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  if (got.length !== secret.length) return { ok: false, status: 401, error: 'Unauthorised' }
  let diff = 0
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ secret.charCodeAt(i)
  return diff === 0 ? { ok: true } : { ok: false, status: 401, error: 'Unauthorised' }
}
