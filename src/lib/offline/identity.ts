'use client'

// Who is using the app right now, as far as this device can tell (works offline).
import { getDb } from './db'
import { ANON } from './types'
import { readSession } from '../session'

export interface Identity {
  owner: string // user id or ANON
  userId: string | null
  email: string | null
  token: string | null // bearer token for the server; null when signed out or when we cannot refresh offline
}

const ANONYMOUS: Identity = { owner: ANON, userId: null, email: null, token: null }

async function remember(i: Identity | null) {
  try {
    const db = await getDb()
    if (i) await db.put('meta', { key: 'lastIdentity', value: { userId: i.userId, email: i.email } })
    else await db.delete('meta', 'lastIdentity')
  } catch {
    /* identity cache is a convenience only */
  }
}

/** Forget the cached identity (called on sign-out so a shared device never keeps the old owner). */
export async function clearCachedIdentity() {
  await remember(null)
}

export async function getIdentity(): Promise<Identity> {
  // Demo accounts live only in this browser; the server accepts "demo:<id>" in demo mode only.
  const demo = readSession()
  if (demo?.demo) return { owner: demo.id, userId: demo.id, email: demo.email, token: `demo:${demo.id}` }

  try {
    const { supabase } = await import('../supabase')
    const { data, error } = await supabase.auth.getSession()
    if (data.session) {
      const id: Identity = { owner: data.session.user.id, userId: data.session.user.id, email: data.session.user.email ?? null, token: data.session.access_token }
      await remember(id)
      return id
    }
    // No usable session. If we are simply offline and the token could not be refreshed, keep showing the
    // same owner's reports (but with no token) instead of silently switching to "anonymous".
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false
    if (error || offline) {
      const cached = (await (await getDb()).get('meta', 'lastIdentity'))?.value as { userId: string; email: string | null } | undefined
      if (cached?.userId) return { owner: cached.userId, userId: cached.userId, email: cached.email, token: null }
    } else {
      await remember(null)
    }
  } catch {
    /* fall through to anonymous */
  }
  return ANONYMOUS
}
