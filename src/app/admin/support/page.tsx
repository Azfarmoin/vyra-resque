'use client'

// Administrator-only: read support requests sent through "Contact us", categorise them and move them
// from Open to In progress to Resolved. The message and sender details cannot be edited.
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import SiteHeader from '@/components/common/SiteHeader'
import Icon from '@/components/ui/Icon'
import { EmptyCrate } from '@/components/ui/Illustrations'
import { useSession } from '@/lib/session'
import { supportHeaders } from '@/lib/supportClient'
import { SUPPORT_CATEGORIES, SUPPORT_STATUSES, type SupportCategory, type SupportRequestRow, type SupportStatus } from '@/lib/support'

const STATUS_PILL: Record<SupportStatus, string> = { open: 'bg-primary-100 text-primary-800', in_progress: 'bg-warning-100 text-warning-700', resolved: 'bg-success-100 text-success-800' }
const fmt = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export default function AdminSupportPage() {
  const { user, ready } = useSession()
  const [rows, setRows] = useState<SupportRequestRow[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [status, setStatus] = useState<SupportStatus | 'all'>('all')
  const [category, setCategory] = useState<SupportCategory | 'all'>('all')
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [rowError, setRowError] = useState<Record<string, string>>({})

  const isAdmin = user?.role === 'admin'

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/support?scope=all', { headers: await supportHeaders(user), cache: 'no-store' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Could not load support requests.')
      setRows(body.requests)
      setLoadError('')
    } catch (e) {
      setLoadError((e as Error).message)
    }
  }, [user])

  useEffect(() => { if (ready && isAdmin) load() }, [ready, isAdmin, load])

  const update = async (row: SupportRequestRow, patch: { status?: SupportStatus; category?: SupportCategory }) => {
    setSaving(row.id)
    setRowError((e) => ({ ...e, [row.id]: '' }))
    try {
      const res = await fetch(`/api/support/${row.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(await supportHeaders(user)) }, body: JSON.stringify(patch) })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'The change could not be saved.')
      setRows((all) => (all ?? []).map((r) => (r.id === row.id ? body.request : r)))
    } catch (e) {
      setRowError((x) => ({ ...x, [row.id]: (e as Error).message }))
    } finally {
      setSaving(null)
    }
  }

  const counts = useMemo(() => {
    const c: Record<SupportStatus, number> = { open: 0, in_progress: 0, resolved: 0 }
    for (const r of rows ?? []) c[r.status]++
    return c
  }, [rows])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (rows ?? []).filter(
      (r) =>
        (status === 'all' || r.status === status) &&
        (category === 'all' || r.category === category) &&
        (!q || `${r.reference} ${r.name} ${r.email ?? ''} ${r.subject} ${r.message} ${r.report_reference ?? ''}`.toLowerCase().includes(q)),
    )
  }, [rows, status, category, query])

  return (
    <div className="page">
      <SiteHeader />
      <main id="main" className="container-x py-6 sm:py-10">
        <header className="max-w-2xl">
          <h1 className="text-4xl font-semibold sm:text-5xl">Support requests</h1>
          <p className="mt-2 text-lg text-ink-700">Requests sent through Contact us. Change a request’s category and status as you work through it.</p>
        </header>

        {!ready ? (
          <p className="mt-8 text-ink-700" role="status">Loading…</p>
        ) : !isAdmin ? (
          <div className="clay mt-8 max-w-xl p-6" style={{ borderRadius: 28 }}>
            <h2 className="flex items-center gap-2 text-2xl font-semibold"><Icon name="lock" /> Administrators only</h2>
            <p className="mt-2 text-ink-700">{user ? 'Your account is not an administrator.' : 'Sign in with an administrator account to read support requests.'}</p>
            {!user && <Link href="/auth/login" className="btn-primary mt-4 inline-flex">Sign in</Link>}
          </div>
        ) : (
          <>
            <section aria-label="Summary" className="mt-8 grid gap-3 sm:grid-cols-3">
              {(Object.keys(SUPPORT_STATUSES) as SupportStatus[]).map((s) => (
                <button key={s} type="button" aria-pressed={status === s} onClick={() => setStatus(status === s ? 'all' : s)} className={`clay-sm p-4 text-left ${status === s ? 'outline outline-2 outline-ink-900' : ''}`}>
                  <span className="text-sm font-bold text-ink-600">{SUPPORT_STATUSES[s]}</span>
                  <span className="block font-display text-4xl font-semibold tabular-nums">{rows ? counts[s] : '–'}</span>
                </button>
              ))}
            </section>

            <section aria-label="Filters" className="mt-6 flex flex-wrap items-end gap-3">
              <div className="min-w-[14rem] flex-1">
                <label htmlFor="sup-q" className="label">Search</label>
                <input id="sup-q" type="search" className="input" placeholder="Reference, name, subject, message…" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
              <div>
                <label htmlFor="sup-status" className="label">Status</label>
                <select id="sup-status" className="input" value={status} onChange={(e) => setStatus(e.target.value as SupportStatus | 'all')}>
                  <option value="all">All statuses</option>
                  {Object.entries(SUPPORT_STATUSES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="sup-cat" className="label">Category</label>
                <select id="sup-cat" className="input" value={category} onChange={(e) => setCategory(e.target.value as SupportCategory | 'all')}>
                  <option value="all">All categories</option>
                  {Object.entries(SUPPORT_CATEGORIES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <button type="button" className="btn-ghost" onClick={load} aria-label="Refresh the list"><Icon name="refresh" size={16} /> Refresh</button>
            </section>

            {loadError && <p role="alert" className="mt-4 font-bold text-critical-700">{loadError}</p>}
            {!rows && !loadError && <p className="mt-6 text-ink-700" role="status">Loading requests…</p>}

            {rows && (
              <section aria-label="Requests" className="mt-6">
                <p className="text-sm font-semibold text-ink-700" role="status">{shown.length} of {rows.length} requests</p>
                {shown.length === 0 ? (
                  <div className="clay mt-3 flex max-w-xl flex-col items-center gap-3 p-8 text-center">
                    <EmptyCrate className="w-28" />
                    <p className="text-lg font-semibold">{rows.length === 0 ? 'No support requests yet.' : 'No requests match these filters.'}</p>
                  </div>
                ) : (
                  <ul className="mt-3 space-y-3">
                    {shown.map((r) => {
                      const open = expanded === r.id
                      return (
                        <li key={r.id} className="clay-sm p-4" style={{ borderRadius: 22 }}>
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="flex flex-wrap items-center gap-2">
                                <span className="font-mono text-sm font-bold">{r.reference}</span>
                                <span className={`pill ${STATUS_PILL[r.status]}`}>{SUPPORT_STATUSES[r.status]}</span>
                                {!r.user_id && <span className="pill bg-sand-200 text-ink-700">No account</span>}
                              </p>
                              <p className="mt-1 break-words font-display text-xl font-semibold leading-snug">{r.subject}</p>
                              <p className="text-sm text-ink-700">{r.name}{r.email ? ` · ${r.email}` : ''} · {fmt(r.created_at)}{r.report_reference ? ` · Report ${r.report_reference}` : ''}</p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <div>
                                <label htmlFor={`st-${r.id}`} className="sr-only">Status for {r.reference}</label>
                                <select id={`st-${r.id}`} className="input !py-2 !text-sm" value={r.status} disabled={saving === r.id} onChange={(e) => update(r, { status: e.target.value as SupportStatus })}>
                                  {Object.entries(SUPPORT_STATUSES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                                </select>
                              </div>
                              <div>
                                <label htmlFor={`ct-${r.id}`} className="sr-only">Category for {r.reference}</label>
                                <select id={`ct-${r.id}`} className="input !py-2 !text-sm" value={r.category} disabled={saving === r.id} onChange={(e) => update(r, { category: e.target.value as SupportCategory })}>
                                  {Object.entries(SUPPORT_CATEGORIES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                                </select>
                              </div>
                            </div>
                          </div>
                          {rowError[r.id] && <p role="alert" className="mt-2 text-sm font-bold text-critical-700">{rowError[r.id]}</p>}
                          <button type="button" className="mt-2 text-sm font-bold underline decoration-2 underline-offset-4" aria-expanded={open} aria-controls={`msg-${r.id}`} onClick={() => setExpanded(open ? null : r.id)}>
                            {open ? 'Hide message' : 'Read message'}
                          </button>
                          {open && <p id={`msg-${r.id}`} className="clay-inset mt-2 whitespace-pre-wrap break-words p-4 text-[15px]">{r.message}</p>}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>
            )}
          </>
        )}
      </main>
    </div>
  )
}
