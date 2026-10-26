// Responder/admin gate for route-analysis endpoints. Mirrors adminAuth.ts:
//  * Supabase mode: `Authorization: Bearer <access token>`; the token is verified with Supabase and the role is read from `profiles`.
//  * Demo mode: `x-demo-user: <email>` matched against the in-memory demo accounts (demo data only).
// Citizens and anonymous callers are refused: route analysis exposes incident details.
import type { NextRequest } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { demoUsers, isDemoMode, isOpenAccess, openAccessAdmin, plainClient, serviceClient, userClient } from '../adminAuth'
import { demoAuthAllowed } from '../demoGuard'

export interface Responder {
  id: string
  email: string
  name: string
  role: 'responder' | 'admin'
  /** Supabase client acting AS this user, so row-level security applies. Null in demo mode. */
  db: SupabaseClient | null
}

export type ResponderCheck = { ok: true; user: Responder } | { ok: false; status: 401 | 403; error: string }

export async function requireResponder(request: NextRequest): Promise<ResponderCheck> {
  if (isOpenAccess()) {
    const u = openAccessAdmin()
    return { ok: true, user: { id: u.id, email: u.email, name: u.full_name, role: 'admin', db: null } }
  }
  if (isDemoMode()) {
    if (!demoAuthAllowed()) return { ok: false, status: 401, error: 'Demo sign-in is disabled on this deployment.' }
    const email = (request.headers.get('x-demo-user') || '').trim().toLowerCase()
    const u = demoUsers().find((x) => x.email === email)
    if (!u) return { ok: false, status: 401, error: 'Sign in as a responder first.' }
    if (u.role !== 'responder' && u.role !== 'admin') return { ok: false, status: 403, error: 'Route analysis is for responders and administrators.' }
    return { ok: true, user: { id: u.id, email: u.email, name: u.full_name, role: u.role, db: null } }
  }

  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return { ok: false, status: 401, error: 'Sign in as a responder first.' }
  const anon = plainClient()
  const { data, error } = await anon.auth.getUser(token)
  if (error || !data.user) return { ok: false, status: 401, error: 'Your sign-in has expired. Sign in again.' }
  const { data: profile } = await (serviceClient() ?? userClient(token)).from('profiles').select('role, full_name').eq('id', data.user.id).maybeSingle()
  if (profile?.role !== 'responder' && profile?.role !== 'admin') return { ok: false, status: 403, error: 'Route analysis is for responders and administrators.' }
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || '', process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  return { ok: true, user: { id: data.user.id, email: data.user.email ?? '', name: profile.full_name || data.user.email || 'Responder', role: profile.role, db } }
}
