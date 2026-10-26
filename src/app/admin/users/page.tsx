'use client'

// Administrator-only: create sign-in accounts (citizen, responder or admin) and see who has one.
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import SiteHeader from '@/components/common/SiteHeader'
import Icon from '@/components/ui/Icon'
import { FieldError } from '@/components/auth/AuthShell'
import { useSession } from '@/lib/session'

type Role = 'citizen' | 'responder' | 'admin'
interface Account { id: string; email: string; full_name: string | null; role: Role; created_at: string | null; requested_role?: 'responder' | null }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const ROLES: { value: Role; title: string; text: string }[] = [
  { value: 'citizen', title: 'Citizen', text: 'Asks for help and follows their reports.' },
  { value: 'responder', title: 'Responder', text: 'Works the dispatcher queue, map and missions.' },
  { value: 'admin', title: 'Administrator', text: 'Everything a responder does, plus managing accounts.' },
]
const ROLE_PILL: Record<Role, string> = { admin: 'bg-primary-100 text-primary-800', responder: 'bg-warning-100 text-warning-700', citizen: 'bg-sand-200 text-ink-700' }

function makePassword() {
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = crypto.getRandomValues(new Uint32Array(12))
  return Array.from(bytes, (b) => chars[b % chars.length]).join('')
}

export default function AdminUsersPage() {
  const { user, ready } = useSession()
  const [accounts, setAccounts] = useState<Account[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [form, setForm] = useState({ full_name: '', email: '', password: '', role: 'responder' as Role })
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<'full_name' | 'email' | 'password', string>>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<{ email: string; password: string; role: Role; confirmed: boolean } | null>(null)
  const [showPassword, setShowPassword] = useState(true)
  const [filter, setFilter] = useState('')
  const errorRef = useRef<HTMLDivElement>(null)

  const isAdmin = user?.role === 'admin'

  // Real mode proves who we are with the Supabase access token; demo mode (no token) names the demo admin.
  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    if (!user) return {}
    if (user.demo) return { 'x-demo-admin': user.email }
    const { supabase } = await import('@/lib/supabase')
    const { data } = await supabase.auth.getSession()
    return data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {}
  }, [user])

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/users', { headers: await authHeaders(), cache: 'no-store' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Could not load accounts.')
      setAccounts(body.users)
      setLoadError('')
    } catch (e) {
      setLoadError((e as Error).message)
    }
  }, [authHeaders])

  useEffect(() => {
    if (ready && isAdmin) load()
  }, [ready, isAdmin, load])

  const failWith = (message: string) => {
    setError(message)
    setTimeout(() => errorRef.current?.focus(), 0)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setCreated(null)
    const errs: typeof fieldErrors = {}
    if (!form.full_name.trim()) errs.full_name = 'Enter the full name.'
    if (!form.email.trim()) errs.email = 'Enter an email address.'
    else if (!EMAIL_RE.test(form.email.trim())) errs.email = 'Enter a valid email address, like name@example.com.'
    if (form.password.length < 6) errs.password = 'Use at least 6 characters.'
    setFieldErrors(errs)
    const bad = (['full_name', 'email', 'password'] as const).find((k) => errs[k])
    if (bad) return void document.getElementById(`acc-${bad}`)?.focus()

    setBusy(true)
    try {
      const res = await fetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeaders()) }, body: JSON.stringify(form) })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) return failWith(body.error || 'The account could not be created.')
      setCreated({ email: body.user.email, password: form.password, role: body.user.role, confirmed: body.confirmed !== false })
      setForm({ full_name: '', email: '', password: '', role: form.role })
      load()
    } catch {
      failWith('The account could not be created. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  const [roleMsg, setRoleMsg] = useState('')
  const changeRole = async (a: Account, role: Role) => {
    if (role === a.role) return
    if (!window.confirm(`Change ${a.full_name || a.email} from ${a.role} to ${role}?`)) return
    setRoleMsg('')
    try {
      const res = await fetch('/api/admin/users', { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(await authHeaders()) }, body: JSON.stringify({ id: a.id, role }) })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'The role could not be changed.')
      setRoleMsg(`${a.email} is now ${role}.`)
      load()
    } catch (e) {
      setRoleMsg((e as Error).message)
    }
  }

  const shown = (accounts ?? []).filter((a) => `${a.full_name ?? ''} ${a.email} ${a.role}`.toLowerCase().includes(filter.trim().toLowerCase()))

  return (
    <div className="page">
      <SiteHeader />
      <main id="main" className="container-x py-6 sm:py-10">
        <header className="max-w-2xl">
          <h1 className="text-4xl font-semibold sm:text-5xl">Accounts</h1>
          <p className="mt-2 text-lg text-ink-700">Create sign-in accounts for responders, citizens and other administrators.</p>
        </header>

        {!ready ? (
          <p className="mt-8 text-ink-700" role="status">Loading...</p>
        ) : !isAdmin ? (
          <div className="clay mt-8 max-w-xl p-6" style={{ borderRadius: 28 }}>
            <h2 className="flex items-center gap-2 text-2xl font-semibold"><Icon name="lock" /> Administrators only</h2>
            <p className="mt-2 text-ink-700">{user ? 'Your account is not an administrator.' : 'Sign in with an administrator account to manage accounts.'}</p>
            {!user && <Link href="/auth/login" className="btn-primary mt-4 inline-flex">Sign in</Link>}
          </div>
        ) : (
          <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,420px)_1fr]">
            <section aria-labelledby="new-account" className="clay p-5 sm:p-7" style={{ borderRadius: 28 }}>
              <h2 id="new-account" className="text-2xl font-semibold">New account</h2>

              {error && (
                <div ref={errorRef} tabIndex={-1} role="alert" className="mt-4 flex items-start gap-2 rounded-2xl border-2 border-critical-700 bg-critical-100 p-3.5 text-[15px] font-bold outline-none">
                  <Icon name="alert" size={18} className="mt-0.5 shrink-0" /> {error}
                </div>
              )}
              {created && (
                <div role="status" className="mt-4 rounded-2xl border-2 border-success-700 bg-success-100 p-3.5 text-[15px]">
                  <p className="flex items-center gap-2 font-bold"><Icon name="check" size={18} /> Account created ({created.role})</p>
                  <p className="mt-1">Email: <strong>{created.email}</strong></p>
                  <p>Password: <strong className="font-mono">{created.password}</strong></p>
                  <p className="mt-1 text-ink-700">Share these details privately. The password is not shown again.</p>
                  {!created.confirmed && <p className="mt-1 font-semibold">Email confirmation is on in Supabase, so this person must click the link in their inbox before signing in. To skip that, turn off &ldquo;Confirm email&rdquo; or set SUPABASE_SERVICE_ROLE_KEY on the server.</p>}
                </div>
              )}

              <form onSubmit={submit} noValidate className="mt-5 space-y-5">
                <div>
                  <label htmlFor="acc-full_name" className="label">Full name</label>
                  <input id="acc-full_name" className="input" autoComplete="off" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} aria-invalid={!!fieldErrors.full_name} />
                  <FieldError id="acc-full_name-error">{fieldErrors.full_name}</FieldError>
                </div>
                <div>
                  <label htmlFor="acc-email" className="label">Email address</label>
                  <input id="acc-email" type="email" className="input" autoComplete="off" placeholder="name@example.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} aria-invalid={!!fieldErrors.email} />
                  <FieldError id="acc-email-error">{fieldErrors.email}</FieldError>
                </div>
                <fieldset>
                  <legend className="label">Role</legend>
                  <div className="grid gap-2.5">
                    {ROLES.map((r) => (
                      <label key={r.value} className="chip !items-start !py-3">
                        <input type="radio" name="acc-role" value={r.value} checked={form.role === r.value} onChange={() => setForm({ ...form, role: r.value })} className="mt-0.5" />
                        <span>
                          <span className="block font-bold">{r.title}</span>
                          <span className="block text-sm font-normal text-ink-700">{r.text}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div>
                  <label htmlFor="acc-password" className="label">Password</label>
                  <div className="flex gap-2">
                    <input id="acc-password" type={showPassword ? 'text' : 'password'} className="input font-mono" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} aria-invalid={!!fieldErrors.password} aria-describedby="acc-password-hint" />
                    <button type="button" className="btn-ghost btn-sm shrink-0" onClick={() => { setForm({ ...form, password: makePassword() }); setShowPassword(true) }}>
                      <Icon name="refresh" size={16} /> Generate
                    </button>
                  </div>
                  <p id="acc-password-hint" className="hint mt-1.5">At least 6 characters. <button type="button" className="font-bold underline underline-offset-4" onClick={() => setShowPassword((v) => !v)}>{showPassword ? 'Hide' : 'Show'}</button></p>
                  <FieldError id="acc-password-error">{fieldErrors.password}</FieldError>
                </div>
                <button type="submit" disabled={busy} className="btn-primary w-full py-3.5 text-base">{busy ? 'Creating...' : 'Create account'}</button>
              </form>
            </section>

            <section aria-labelledby="all-accounts">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <h2 id="all-accounts" className="text-2xl font-semibold">All accounts{accounts ? ` (${accounts.length})` : ''}</h2>
                <div className="flex items-center gap-2">
                  <label htmlFor="acc-filter" className="sr-only">Filter accounts</label>
                  <input id="acc-filter" className="input !py-2" placeholder="Filter by name, email or role" value={filter} onChange={(e) => setFilter(e.target.value)} />
                  <button type="button" className="btn-ghost btn-sm" onClick={load} aria-label="Refresh the list"><Icon name="refresh" size={16} /></button>
                </div>
              </div>
              {loadError && <p role="alert" className="mt-4 font-bold text-critical-700">{loadError}</p>}
              {roleMsg && <p role="status" className="mt-4 font-semibold">{roleMsg}</p>}
              {!accounts && !loadError && <p className="mt-4 text-ink-700" role="status">Loading accounts...</p>}
              {accounts && (
                <ul className="mt-4 space-y-2.5" aria-label="Accounts">
                  {shown.map((a) => (
                    <li key={a.id} className="clay-sm flex flex-wrap items-center justify-between gap-2 px-4 py-3" style={{ borderRadius: 20 }}>
                      <div className="min-w-0">
                        <p className="truncate font-bold">{a.full_name || '(no name)'}</p>
                        <p className="truncate text-sm text-ink-700">{a.email}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {a.requested_role === 'responder' && a.role === 'citizen' && <span className="pill bg-warning-100 text-warning-700">Asked for responder access</span>}
                        <span className={`pill ${ROLE_PILL[a.role] ?? ROLE_PILL.citizen}`}>{a.role}</span>
                        <label className="sr-only" htmlFor={`role-${a.id}`}>Role for {a.email}</label>
                        <select id={`role-${a.id}`} className="input !w-auto !py-1.5 text-sm" value={a.role} onChange={(e) => changeRole(a, e.target.value as Role)}>
                          <option value="citizen">Citizen</option>
                          <option value="responder">Responder</option>
                          <option value="admin">Administrator</option>
                        </select>
                      </div>
                    </li>
                  ))}
                  {shown.length === 0 && <li className="text-ink-700">No accounts match.</li>}
                </ul>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  )
}
