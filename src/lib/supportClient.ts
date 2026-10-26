'use client'

// Browser helpers for the support pages: how the current person proves who they are to /api/support.
// Real Supabase mode sends the access token; demo mode (no token) names the demo user, like the Accounts page does.
import type { SessionUser } from './demoAccounts'

export async function supportHeaders(user: SessionUser | null): Promise<Record<string, string>> {
  if (!user) return {}
  if (user.demo) return { 'x-demo-user': user.email }
  try {
    const { supabase } = await import('./supabase')
    const { data } = await supabase.auth.getSession()
    return data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {}
  } catch {
    return {}
  }
}
