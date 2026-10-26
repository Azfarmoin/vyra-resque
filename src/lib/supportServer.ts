// Server side of "Contact us": who is asking, spam checks, rate limiting, and saving/reading requests.
// Real Supabase mode: the caller's own access token is forwarded to Supabase so Row Level Security
// (supabase/migrations/007_support_requests.sql) decides what they may see or change. The service key
// is never used here. Demo mode keeps everything in memory, mirroring the same rules.
// Nothing in this file sends email.
import { rateLimitsDisabled } from './devFlags'
import { createHash, randomInt, randomUUID } from 'node:crypto'
import { demoAuthAllowed } from './demoGuard'
import type { NextRequest } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { demoUsers, isDemoMode, plainClient, serviceClient, isOpenAccess, openAccessAdmin } from './adminAuth'
import { HttpError } from './reportService'
import {
  SUPPORT_LIMITS, SUPPORT_REF_ALPHABET, countLinks,
  type SupportInput, type SupportRequestRow, type SupportStatus, type SupportCategory,
} from './support'

// ---------------------------------------------------------------- who is calling

export interface Caller {
  userId: string | null
  email: string | null
  role: 'citizen' | 'responder' | 'admin' | null
  token: string | null // Supabase access token (real mode only)
}

const ANON: Caller = { userId: null, email: null, role: null, token: null }

/** Works out who is calling. Never throws: an unknown or expired caller is simply anonymous. */
export async function identify(request: NextRequest): Promise<Caller> {
  if (isOpenAccess()) { const u = openAccessAdmin(); return { userId: u.id, email: u.email, role: 'admin', token: null } }
  if (isDemoMode()) {
    if (!demoAuthAllowed()) return ANON
    const email = (request.headers.get('x-demo-user') || '').trim().toLowerCase()
    const u = email ? demoUsers().find((d) => d.email === email) : undefined
    return u ? { userId: u.id, email: u.email, role: u.role, token: null } : ANON
  }
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return ANON
  const { data, error } = await plainClient().auth.getUser(token)
  if (error || !data.user) return ANON
  const { data: profile } = await (serviceClient() ?? userClient(token)).from('profiles').select('role').eq('id', data.user.id).maybeSingle()
  return { userId: data.user.id, email: data.user.email ?? null, role: (profile?.role as Caller['role']) ?? 'citizen', token }
}

/** A Supabase client that acts as the caller (so RLS applies), or as an anonymous visitor. */
function userClient(token: string | null): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }),
    },
  })
}

// ---------------------------------------------------------------- spam protection

const WINDOW_MS = 60 * 60 * 1000
const MAX_PER_WINDOW = 5
const MIN_GAP_MS = 10_000
const DEDUPE_MS = 10 * 60_000
const hits = new Map<string, { t: number; h: string }[]>() // key -> accepted submissions (time, content hash)

/** Per-sender limit: 5 per hour and at least 10 seconds apart. Best effort per server instance;
 *  in Supabase mode the database enforces its own limit too (the function in migration 007).
 *  Re-sending the exact same message is not counted: it is answered with the original reference. */
export function checkRateLimit(key: string, hash = '', now = Date.now()): { ok: true } | { ok: false; retryAfterSec: number } {
  if (rateLimitsDisabled()) return { ok: true }
  const recent = (hits.get(key) ?? []).filter((e) => now - e.t < WINDOW_MS)
  if (hash && recent.some((e) => e.h === hash && now - e.t < DEDUPE_MS)) return { ok: true }
  if (recent.length) {
    const sinceLast = now - recent[recent.length - 1].t
    if (sinceLast < MIN_GAP_MS) return { ok: false, retryAfterSec: Math.ceil((MIN_GAP_MS - sinceLast) / 1000) }
  }
  if (recent.length >= MAX_PER_WINDOW) return { ok: false, retryAfterSec: Math.ceil((WINDOW_MS - (now - recent[0].t)) / 1000) }
  hits.set(key, recent)
  return { ok: true }
}
export const recordSubmission = (key: string, hash = '', now = Date.now()) => {
  hits.set(key, [...(hits.get(key) ?? []).filter((e) => now - e.t < WINDOW_MS), { t: now, h: hash }])
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((e) => now - e.t < WINDOW_MS)) hits.delete(k) // keep memory bounded
}
export const resetRateLimits = () => hits.clear()

/** A hash of the sender's network address. The address itself is never stored. */
export function clientKey(request: NextRequest): string {
  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || request.headers.get('x-real-ip') || 'unknown'
  return createHash('sha256').update(`vyra-support|${process.env.SUPPORT_HASH_SALT || ''}|${ip}`).digest('hex').slice(0, 32)
}

/** Cheap checks that stop most scripted spam without annoying people. Returns an error message, or null if fine. */
export function spamVerdict(body: { website?: string; elapsed_ms?: number }, input: Pick<SupportInput, 'message' | 'subject' | 'name'>): string | null {
  if (body.website && body.website.trim()) return 'This request looks automated and was not sent.' // honeypot filled in
  if (typeof body.elapsed_ms !== 'number' || body.elapsed_ms < SUPPORT_LIMITS.minFillMs) return 'That was very fast. Please check your message and send it again.'
  if (countLinks(`${input.message} ${input.subject} ${input.name}`) > SUPPORT_LIMITS.maxLinks) return `Please include at most ${SUPPORT_LIMITS.maxLinks} links.`
  if (/(.)\1{14,}/.test(input.message)) return 'Your message has a long run of repeated characters. Please rewrite it.'
  const letters = input.message.replace(/[^\p{L}]/gu, '')
  if (letters.length >= 10 && new Set(letters.toLowerCase()).size <= 2) return 'Please write your message in full sentences so support can understand it.'
  return null
}

// ---------------------------------------------------------------- demo (in-memory) storage

const g = globalThis as unknown as { __vyraSupport?: (SupportRequestRow & { sender_key: string; content_hash: string })[] }
const demoRows = () => (g.__vyraSupport ??= [])
export const resetDemoSupport = () => { g.__vyraSupport = [] }

export const hashContent = (i: Pick<SupportInput, 'category' | 'subject' | 'message'>) =>
  createHash('md5').update(`${i.category}|${i.subject}|${i.message}`.toLowerCase()).digest('hex')
const newReference = () => 'SUP-' + Array.from({ length: 8 }, () => SUPPORT_REF_ALPHABET[randomInt(SUPPORT_REF_ALPHABET.length)]).join('')

const PUBLIC_COLUMNS = 'id, reference, user_id, name, email, subject, category, message, report_reference, status, created_at, updated_at'
const strip = ({ sender_key: _s, content_hash: _c, ...row }: SupportRequestRow & { sender_key?: string; content_hash?: string }): SupportRequestRow => row

// ---------------------------------------------------------------- operations

export async function createSupportRequest(input: SupportInput, caller: Caller, key: string): Promise<{ reference: string; duplicate: boolean }> {
  if (isDemoMode()) {
    const sender = caller.userId ? `user:${caller.userId}` : `anon:${key}`
    const content_hash = hashContent(input)
    const rows = demoRows()
    const same = rows.find((r) => r.sender_key === sender && r.content_hash === content_hash && Date.now() - Date.parse(r.created_at) < 10 * 60_000)
    if (same) return { reference: same.reference, duplicate: true }
    const now = new Date().toISOString()
    let reference = newReference()
    while (rows.some((r) => r.reference === reference)) reference = newReference()
    rows.push({
      id: randomUUID(), reference, user_id: caller.userId, name: input.name, email: input.email, subject: input.subject, category: input.category,
      message: input.message, report_reference: input.report_reference, status: 'open', created_at: now, updated_at: now, sender_key: sender, content_hash,
    })
    return { reference, duplicate: false }
  }

  const { data, error } = await userClient(caller.token).rpc('submit_support_request', {
    p_name: input.name, p_email: input.email, p_subject: input.subject, p_category: input.category, p_message: input.message,
    p_report_reference: input.report_reference, p_client_key: key,
  })
  if (error) {
    if (error.code === 'PT429' || /rate_limited/.test(error.message)) throw new HttpError(429, 'Too many support requests. Please wait a while before sending another.')
    if (error.code === '23514') throw new HttpError(400, 'One of the fields is not valid. Check the form and try again.')
    if (error.code === '42883' || error.code === 'PGRST202') throw new HttpError(503, 'Support is not set up yet: the database migration 007_support_requests.sql has not been run.')
    console.error('support insert failed', error)
    throw new HttpError(500, 'Your request could not be saved. Your message is still in the form: try again.')
  }
  const out = data as { reference?: string; duplicate?: boolean } | null
  if (!out?.reference) throw new HttpError(500, 'Your request could not be saved. Your message is still in the form: try again.')
  return { reference: out.reference, duplicate: !!out.duplicate }
}

/** Mine: the caller's own requests. All: everything (staff only; Supabase RLS enforces this independently). */
export async function listSupportRequests(caller: Caller, scope: 'mine' | 'all'): Promise<SupportRequestRow[]> {
  if (!caller.userId) throw new HttpError(401, 'Sign in to see your support requests.')
  if (scope === 'all' && caller.role !== 'admin') throw new HttpError(403, 'Only administrators can view all support requests.')

  if (isDemoMode()) {
    return demoRows()
      .filter((r) => scope === 'all' || r.user_id === caller.userId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map(strip)
  }
  let q = userClient(caller.token).from('support_requests').select(PUBLIC_COLUMNS).order('created_at', { ascending: false }).limit(500)
  if (scope === 'mine') q = q.eq('user_id', caller.userId)
  const { data, error } = await q
  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205') throw new HttpError(503, 'Support is not set up yet: the database migration 007_support_requests.sql has not been run.')
    console.error('support list failed', error)
    throw new HttpError(500, 'Support requests could not be loaded.')
  }
  return (data ?? []) as SupportRequestRow[]
}

export async function updateSupportRequest(caller: Caller, id: string, patch: { status?: SupportStatus; category?: SupportCategory }): Promise<SupportRequestRow> {
  if (!caller.userId) throw new HttpError(401, 'Sign in as an administrator first.')
  if (caller.role !== 'admin') throw new HttpError(403, 'Only administrators can update support requests.')

  if (isDemoMode()) {
    const row = demoRows().find((r) => r.id === id)
    if (!row) throw new HttpError(404, 'Support request not found.')
    if (patch.status) row.status = patch.status
    if (patch.category) row.category = patch.category
    row.updated_at = new Date().toISOString()
    return strip(row)
  }
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, 'Support request not found.')
  const { data, error } = await userClient(caller.token).from('support_requests').update(patch).eq('id', id).select(PUBLIC_COLUMNS).maybeSingle()
  if (error) {
    console.error('support update failed', error)
    throw new HttpError(error.code === '42501' ? 403 : 500, error.code === '42501' ? 'You are not allowed to change this request.' : 'The request could not be updated.')
  }
  if (!data) throw new HttpError(404, 'Support request not found, or you are not allowed to change it.')
  return data as SupportRequestRow
}
