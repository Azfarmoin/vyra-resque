'use client'

// Who is signed in: a demo session kept in localStorage, or a real Supabase session.
import { useCallback, useEffect, useState } from 'react'
import type { SessionUser } from './demoAccounts'

const KEY = 'vyra.session'

export function readSession(): SessionUser | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as SessionUser) : null
  } catch {
    return null
  }
}

export function saveSession(user: SessionUser) {
  try {
    localStorage.setItem(KEY, JSON.stringify(user))
    window.dispatchEvent(new Event('vyra:session'))
  } catch {
    /* storage unavailable: the user just has to sign in again next time */
  }
}

export async function signOut() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
  try {
    // Forget who owned this device's reports, so the next person is never shown them (they stay stored, untouched).
    const { clearCachedIdentity } = await import('./offline/identity')
    await clearCachedIdentity()
  } catch {
    /* nothing cached */
  }
  try {
    const { supabase } = await import('./supabase')
    await supabase.auth.signOut()
  } catch {
    /* no real session to end */
  }
  window.dispatchEvent(new Event('vyra:session'))
}

const OPEN_ACCESS = process.env.NEXT_PUBLIC_VYRA_OPEN_ACCESS === 'true'
const OPEN_ACCESS_USER: SessionUser = { id: '90000000-0000-4000-8000-000000000001', email: 'admin@demo.vyra', full_name: 'Open access (testing)', role: 'admin', demo: true } as SessionUser

export function useSession() {
  const [user, setUser] = useState<SessionUser | null>(OPEN_ACCESS ? OPEN_ACCESS_USER : null)
  const [ready, setReady] = useState(false)

  const load = useCallback(async () => {
    if (OPEN_ACCESS) { setUser(OPEN_ACCESS_USER); setReady(true); return }
    const demo = readSession()
    if (demo) {
      setUser(demo)
      setReady(true)
      return
    }
    try {
      const { supabase } = await import('./supabase')
      const { data } = await supabase.auth.getUser()
      if (data.user) {
        const { data: profile } = await supabase.from('profiles').select('role, full_name').eq('id', data.user.id).maybeSingle()
        setUser({ id: data.user.id, email: data.user.email ?? '', full_name: profile?.full_name ?? data.user.email ?? 'Signed in', role: (profile?.role as SessionUser['role']) ?? 'citizen', demo: false })
      } else setUser(null)
    } catch {
      setUser(null)
    }
    setReady(true)
  }, [])

  useEffect(() => {
    load()
    window.addEventListener('vyra:session', load)
    return () => window.removeEventListener('vyra:session', load)
  }, [load])

  return { user, ready }
}
