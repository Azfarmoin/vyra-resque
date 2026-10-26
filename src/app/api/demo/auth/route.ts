import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { getStore } from '@/lib/db'
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from '@/lib/demoAccounts'
import { demoUsers } from '@/lib/adminAuth'
import { demoAuthAllowed } from '@/lib/demoGuard'

// Demo sign-in. Only available in demo mode; with a real Supabase project this answers { demo: false }.
const users = demoUsers // same shared in-memory list the Accounts page uses
const isDemo = () => getStore().mode === 'demo' && demoAuthAllowed()
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function GET() {
  if (!isDemo()) return NextResponse.json({ demo: false })
  return NextResponse.json({
    demo: true,
    password: DEMO_PASSWORD,
    accounts: DEMO_ACCOUNTS.map(({ email, full_name, role, blurb }) => ({ email, full_name, role, blurb })),
  })
}

export async function POST(request: NextRequest) {
  if (!isDemo()) return NextResponse.json({ error: 'Demo accounts are only available in demo mode.' }, { status: 404 })
  const body = await request.json().catch(() => ({}))
  const email = String(body.email ?? '').trim().toLowerCase()
  const password = String(body.password ?? '')

  if (body.action === 'register') {
    const full_name = String(body.full_name ?? '').trim()
    // Self-service sign-up ALWAYS creates a citizen. Asking for responder access only records a request that an
    // administrator must approve (Accounts page); it never grants the role. Admin is never self-service.
    const requested_role = body.role === 'responder' ? ('responder' as const) : null
    if (!full_name) return NextResponse.json({ error: 'Enter your full name.' }, { status: 400 })
    if (!EMAIL_RE.test(email)) return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 })
    if (password.length < 6) return NextResponse.json({ error: 'Use a password of at least 6 characters.' }, { status: 400 })
    if (users().some((u) => u.email === email)) return NextResponse.json({ error: 'An account with this email already exists.' }, { status: 409 })
    users().push({ id: randomUUID(), email, full_name, role: 'citizen', password, requested_role })
    return NextResponse.json({ ok: true, role: 'citizen', requested_role }, { status: 201 })
  }

  const user = users().find((u) => u.email === email && u.password === password)
  if (!user) return NextResponse.json({ error: 'Invalid login credentials' }, { status: 401 })
  return NextResponse.json({ user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role, demo: true } })
}
