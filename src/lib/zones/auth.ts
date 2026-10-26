// Who is calling a zone API? Reuses the existing account system (src/lib/adminAuth.ts):
//  - real Supabase: `Authorization: Bearer <access token>`; the role comes from public.profiles
//  - demo mode: `x-demo-admin: <email>` (the same simulated sign-in the Accounts page uses)
// Anonymous callers get role = null: they can read the public map and nothing else.
import type { NextRequest } from 'next/server'
import { demoUsers, isDemoMode, isOpenAccess, openAccessAdmin, plainClient, serviceClient } from '../adminAuth'
import { demoAuthAllowed } from '../demoGuard'
import type { AnyRole } from './types'

export interface ZoneCaller { id: string | null; email: string | null; name: string | null; role: AnyRole | null; token?: string }
export const ANONYMOUS: ZoneCaller = { id: null, email: null, name: null, role: null }

export async function identify(request: NextRequest | Request): Promise<ZoneCaller> {
  const h = (n: string) => request.headers.get(n) || ''
  if (isOpenAccess()) { const u = openAccessAdmin(); return { id: u.id, email: u.email, name: u.full_name, role: u.role } }
  if (isDemoMode()) {
    if (!demoAuthAllowed()) return ANONYMOUS
    const email = h('x-demo-admin').trim().toLowerCase()
    const u = demoUsers().find((x) => x.email === email)
    return u ? { id: u.id, email: u.email, name: u.full_name, role: u.role } : ANONYMOUS
  }
  const token = h('authorization').replace(/^Bearer\s+/i, '').trim()
  if (!token) return ANONYMOUS
  const client = plainClient()
  const { data, error } = await client.auth.getUser(token)
  if (error || !data.user) return ANONYMOUS
  // The role is read with the user's OWN token, so row level security decides what they may see.
  const authed = (await import('@supabase/supabase-js')).createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || '', process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '', {
    auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data: profile } = await (serviceClient() ?? authed).from('profiles').select('role, full_name').eq('id', data.user.id).maybeSingle()
  const role = (profile?.role as AnyRole | undefined) ?? 'citizen'
  return { id: data.user.id, email: data.user.email ?? null, name: profile?.full_name ?? data.user.email ?? null, role, token }
}
