// Server-side identity for the report endpoints. The browser sends `Authorization: Bearer <token>`;
// we never trust a reporter_id or role that the client merely claims.
import { createClient } from '@supabase/supabase-js'
import { getStore } from './db'
import { DEMO_ACCOUNTS } from './demoAccounts'
import { HttpError } from './reportService'
import { isOpenAccess, openAccessAdmin, userClient } from './adminAuth'
import { demoAuthAllowed } from './demoGuard'

export type Caller =
  | { kind: 'anonymous' }
  | { kind: 'user'; userId: string; role: 'citizen' | 'responder' | 'admin' }
  | { kind: 'invalid' } // a token was sent but it is expired / not recognised

// Demo mode has no real auth server: the demo sign-in is a browser-only session, so the browser
// sends `demo:<accountId>`. It only exists in the in-memory demo database and grants nothing else.
export async function resolveCaller(req: Request): Promise<Caller> {
  if (isOpenAccess()) { const u = openAccessAdmin(); return { kind: 'user', userId: u.id, role: 'admin' } }
  const header = req.headers.get('authorization') || ''
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : ''
  if (!token) return { kind: 'anonymous' }

  if (getStore().mode === 'demo') {
    if (!demoAuthAllowed()) return { kind: 'invalid' }
    const account = token.startsWith('demo:') ? DEMO_ACCOUNTS.find((a) => a.id === token.slice(5)) : undefined
    return account ? { kind: 'user', userId: account.id, role: account.role } : { kind: 'invalid' }
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  let result
  try {
    result = await db.auth.getUser(token)
  } catch {
    throw new HttpError(503, 'Could not reach the sign-in service. The report is kept on your device; try again shortly.')
  }
  if (result.error || !result.data.user) {
    // A network failure inside supabase-js surfaces as status 0 / retryable: do not log people out for that.
    const status = (result.error as { status?: number } | null)?.status
    if (!status || status >= 500) throw new HttpError(503, 'Could not verify your sign-in right now. Try again shortly.')
    return { kind: 'invalid' }
  }
  // Read the role AS the user: profiles is not readable anonymously since migration 011.
  const { data: profile } = await userClient(token).from('profiles').select('role').eq('id', result.data.user.id).maybeSingle()
  const role = (profile?.role as 'citizen' | 'responder' | 'admin' | undefined) ?? 'citizen'
  return { kind: 'user', userId: result.data.user.id, role }
}

export class AuthError extends HttpError {
  constructor(status: number, message: string, public code: 'auth_required' | 'account_mismatch' | 'forbidden') {
    super(status, message)
  }
}
