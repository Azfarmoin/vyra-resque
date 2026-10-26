// Shared request handling for /api/flood/*: auth, body limits, error mapping. Same auth as route analysis (responders and
// admins); citizens and anonymous callers are refused because scenarios touch operational data.
import { NextRequest, NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { requireResponder, type Responder } from '../routing/auth'
import { checkRateLimit } from '../routing/rateLimit'
import { floodConfig } from './config'
import { FloodError } from './types'

export const fail = (status: number, code: string, error: string, extra?: Record<string, unknown>, headers?: Record<string, string>) =>
  NextResponse.json({ code, error, ...extra }, { status, headers: { 'Cache-Control': 'no-store', ...headers } })

export async function guard(request: NextRequest, opt: { admin?: boolean; limit?: { key: string; max: number } } = {}): Promise<{ ok: true; user: Responder } | { ok: false; res: NextResponse }> {
  if (!floodConfig().enabled) return { ok: false, res: fail(404, 'disabled', 'The flood simulator is switched off on this server.') }
  const auth = await requireResponder(request)
  if (!auth.ok) return { ok: false, res: fail(auth.status, auth.status === 401 ? 'unauthenticated' : 'forbidden', auth.status === 401 ? 'Sign in as a responder first.' : 'The flood simulator is for responders and administrators.') }
  if (opt.admin && auth.user.role !== 'admin') return { ok: false, res: fail(403, 'forbidden', 'Only administrators can do this.') }
  if (opt.limit) {
    const l = checkRateLimit(`${opt.limit.key}:${auth.user.id}`, { limit: opt.limit.max })
    if (!l.ok) return { ok: false, res: fail(429, 'rate_limited', 'Too many requests. Wait a moment and try again.', undefined, { 'Retry-After': String(l.retryAfterS) }) }
  }
  return { ok: true, user: auth.user }
}

export async function readJson(request: NextRequest, maxBytes = 400_000): Promise<unknown> {
  const declared = Number(request.headers.get('content-length') || 0)
  if (declared > maxBytes) throw new FloodError('too_large', 413, 'The request is too large.')
  const text = await request.text().catch(() => '')
  if (text.length > maxBytes) throw new FloodError('too_large', 413, 'The request is too large.')
  try { return JSON.parse(text) } catch { throw new FloodError('invalid_request', 400, 'The request body must be JSON.') }
}

export function handle(err: unknown): NextResponse {
  if (err instanceof ZodError) {
    const first = err.issues[0]
    return fail(400, 'invalid_input', first ? `${first.path.join('.') || 'request'}: ${first.message}` : 'Invalid input.', { details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) })
  }
  if (err instanceof FloodError) return fail(err.status, err.code, err.message, err.hint ? { hint: err.hint } : undefined)
  console.error('flood simulator error', err)
  return fail(500, 'internal_error', 'The simulator failed unexpectedly. Emergency reporting and the rest of VYRA are unaffected.')
}
