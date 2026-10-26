'use client'

// Administrators: data-source health, alerts (all origins), conflicts, problems, audit trail, delivery outcomes,
// and publishing human-verified announcements.
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import SiteHeader from '@/components/common/SiteHeader'
import { OriginBadge, SeverityBadge, fmt } from '@/components/alerts/AlertBits'
import { useSession } from '@/lib/session'
import { HAZARD_TYPES, SEVERITIES, SEVERITY_LABELS, type AlertRecord, type AuditEntry, type Conflict, type HazardType, type IngestIssue, type NotificationRow, type ProviderHealth, type Severity } from '@/lib/alerts/types'
import type { AlertProvider } from '@/lib/alerts/providers'

type ProviderRow = Pick<AlertProvider, 'id' | 'name' | 'origin' | 'docs' | 'minIntervalMinutes' | 'staleAfterMinutes' | 'unconfiguredReason'> & { enabled: boolean; health: ProviderHealth | null; freshness: { state: string; lastSuccessAt: string | null; ageMinutes: number | null } }
interface Overview {
  storage: { persistent: boolean; note: string | null; mode: string }
  push: { configured: boolean; subscribers: number }
  cronConfigured: boolean
  providers: ProviderRow[]
  alerts: AlertRecord[]
  conflicts: Conflict[]
  issues: IngestIssue[]
  audit: AuditEntry[]
  notifications: { recent: NotificationRow[]; counts: Record<string, number> }
}

export default function AdminAlertsPage() {
  const { user, ready } = useSession()
  const isAdmin = user?.role === 'admin'
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ title: '', description: '', instruction: '', severity: 'watch' as Severity, hazard_type: 'other' as HazardType, affected_area: '', lat: '', lng: '', radiusKm: '', source_url: '', expires_at: '', notify: false, verified: false })

  const headers = useCallback(async (): Promise<Record<string, string>> => {
    if (!user) return {}
    if (user.demo) return { 'x-demo-admin': user.email }
    const { supabase } = await import('@/lib/supabase')
    const { data: s } = await supabase.auth.getSession()
    return s.session ? { Authorization: `Bearer ${s.session.access_token}` } : {}
  }, [user])

  const call = useCallback(async (url: string, method = 'GET', body?: unknown) => {
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...(await headers()) }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json.error || 'Request failed')
    return json
  }, [headers])

  const load = useCallback(async () => { try { setData(await call('/api/admin/alerts')); setError('') } catch (e) { setError((e as Error).message) } }, [call])
  useEffect(() => { if (ready && isAdmin) load() }, [ready, isAdmin, load])

  async function act(fn: () => Promise<unknown>, ok: string) {
    setBusy(true); setNote('')
    try { await fn(); setNote(ok); await load() } catch (e) { setNote((e as Error).message) } finally { setBusy(false) }
  }
  const publish = () => act(() => call('/api/admin/alerts', 'POST', {
    title: form.title, description: form.description, instruction: form.instruction || null, severity: form.severity, hazard_type: form.hazard_type, affected_area: form.affected_area,
    circle: form.lat && form.lng && form.radiusKm ? { lat: Number(form.lat), lng: Number(form.lng), radiusKm: Number(form.radiusKm) } : null,
    source_url: form.source_url || null, expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : '', notify: form.notify, verified_confirmation: form.verified,
  }), 'Announcement published.')

  if (!ready) return null
  if (!isAdmin) return <div className="page"><SiteHeader /><main id="main" className="container-x py-10"><p>Administrators only. <Link className="underline" href="/auth/login">Sign in</Link></p></main></div>

  const f = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value })
  const input = 'w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm'

  return (
    <div className="page">
      <SiteHeader />
      <main id="main" className="container-x space-y-6 pb-16 pt-6">
        <h1 className="font-display text-3xl font-semibold">Early-warning administration</h1>
        {error && <p role="alert" className="rounded-xl bg-critical-100 p-3 text-sm font-semibold">{error}</p>}
        {note && <p role="status" className="rounded-xl bg-sand-200 p-3 text-sm font-semibold">{note}</p>}
        {data && (
          <>
            <section className="grid gap-3 text-sm sm:grid-cols-3" aria-label="System status">
              <div className="clay-sm p-3" style={{ borderRadius: 18 }}><strong>Storage:</strong> {data.storage.persistent ? 'database' : 'server memory only'}{data.storage.note && <p className="mt-1 text-warning-700">{data.storage.note}</p>}</div>
              <div className="clay-sm p-3" style={{ borderRadius: 18 }}><strong>Scheduler secret:</strong> {data.cronConfigured ? 'set' : 'NOT set: scheduled monitoring is off'}</div>
              <div className="clay-sm p-3" style={{ borderRadius: 18 }}><strong>Push:</strong> {data.push.configured ? `configured, ${data.push.subscribers} subscriber(s)` : 'VAPID keys not set'} · delivery: {Object.entries(data.notifications.counts).map(([k, v]) => `${k} ${v}`).join(', ') || 'none yet'}</div>
            </section>

            <section aria-labelledby="prov"><div className="flex flex-wrap items-center gap-3"><h2 id="prov" className="font-display text-xl font-semibold">Data sources</h2>
              <button className="btn-primary btn-sm" disabled={busy} onClick={() => act(() => call('/api/admin/alerts/run', 'POST'), 'Check finished.')}>Check all sources now</button></div>
              <div className="mt-2 space-y-3">{data.providers.map((p) => (
                <article key={p.id} className="clay-sm p-3 text-sm" style={{ borderRadius: 18 }}>
                  <div className="flex flex-wrap items-center gap-2"><strong>{p.name}</strong><OriginBadge origin={p.origin} />
                    <span className={`pill ${p.unconfiguredReason ? 'bg-ink-100 text-ink-800' : p.freshness.state === 'fresh' ? 'bg-success-100 text-success-800' : 'bg-warning-100 text-warning-700'}`}>{p.unconfiguredReason ? 'Unconfigured' : p.freshness.state === 'fresh' ? 'Fresh' : 'Stale / failing'}</span>
                    {!p.unconfiguredReason && <label className="ml-auto flex items-center gap-1"><input type="checkbox" checked={p.enabled} onChange={(e) => act(() => call('/api/admin/alerts/providers', 'PATCH', { provider: p.id, enabled: e.target.checked }), 'Saved.')} /> Enabled</label>}</div>
                  {p.unconfiguredReason && <p className="mt-1 font-semibold">{p.unconfiguredReason}</p>}
                  <dl className="mt-2 grid gap-1 sm:grid-cols-2">
                    <div><dt className="inline font-bold">Feed: </dt><dd className="inline break-all">{p.docs.feedUrl ?? 'not set'}</dd></div>
                    <div><dt className="inline font-bold">Coverage: </dt><dd className="inline">{p.docs.coverage}</dd></div>
                    <div><dt className="inline font-bold">Hazards: </dt><dd className="inline">{p.docs.hazards.map((h) => HAZARD_TYPES[h]).join(', ')}</dd></div>
                    <div><dt className="inline font-bold">Update frequency: </dt><dd className="inline">{p.docs.updateFrequency}</dd></div>
                    <div><dt className="inline font-bold">Authentication: </dt><dd className="inline">{p.docs.authentication}</dd></div>
                    <div><dt className="inline font-bold">Last success: </dt><dd className="inline">{fmt(p.health?.last_success_at ?? null)}{p.health?.consecutive_failures ? ` · ${p.health.consecutive_failures} failure(s) in a row` : ''}</dd></div>
                  </dl>
                  {p.health?.last_error && <p className="mt-1 text-critical-700">Last error: {p.health.last_error}</p>}
                  <p className="mt-1 text-ink-700"><strong>Limits:</strong> {p.docs.limitations}</p>
                </article>))}</div>
            </section>

            {data.conflicts.length > 0 && <section aria-labelledby="cf"><h2 id="cf" className="font-display text-xl font-semibold">Conflicting sources</h2><ul className="mt-2 list-disc pl-5 text-sm">{data.conflicts.map((c) => <li key={c.alert_ids.join('-')}>{HAZARD_TYPES[c.hazard_type]}: {c.reason}</li>)}</ul></section>}

            <section aria-labelledby="al"><h2 id="al" className="font-display text-xl font-semibold">Alerts ({data.alerts.length})</h2>
              <div className="mt-2 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-ink-200"><th className="p-2">Level</th><th>Type</th><th>Title</th><th>Status</th><th>Updated</th><th>Review flags</th><th /></tr></thead><tbody>
                {data.alerts.map((a) => (<tr key={a.id} className="border-b border-ink-100 align-top"><td className="p-2"><SeverityBadge severity={a.severity} /></td><td><OriginBadge origin={a.origin} /></td><td className="max-w-xs"><strong>{a.title}</strong><br /><span className="text-ink-600">{a.source_name} · rev {a.revision}</span></td><td>{a.status}{a.expires_at ? ` · until ${fmt(a.expires_at)}` : ''}</td><td>{fmt(a.last_updated_at)}</td><td className="max-w-[16rem] text-warning-700">{a.review_flags.join('; ')}</td>
                  <td>{a.origin === 'manual' && a.status === 'active' && <button className="btn-ghost btn-sm" disabled={busy} onClick={() => act(() => call(`/api/admin/alerts/${a.id}`, 'DELETE'), 'Withdrawn.')}>Withdraw</button>}</td></tr>))}
                {!data.alerts.length && <tr><td className="p-2" colSpan={7}>No alerts stored. Nothing has been imported or published.</td></tr>}
              </tbody></table></div><p className="mt-1 text-xs text-ink-600">Imported alerts cannot be edited: VYRA never overrides the severity or instructions of an authority.</p></section>

            <section aria-labelledby="pub" className="clay-sm p-4" style={{ borderRadius: 22 }}><h2 id="pub" className="font-display text-xl font-semibold">Publish a verified announcement</h2>
              <p className="mt-1 text-sm text-ink-700">Written by a person, shown as "Announcement by VYRA administrators", never as an official alert. Only publish what you have confirmed with an authoritative source. Maximum 30 days.</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="text-sm font-bold sm:col-span-2">Title<input className={input} value={form.title} onChange={f('title')} maxLength={200} /></label>
                <label className="text-sm font-bold sm:col-span-2">What is happening (facts only)<textarea className={input} rows={3} value={form.description} onChange={f('description')} maxLength={4000} /></label>
                <label className="text-sm font-bold sm:col-span-2">Instructions from the authority (optional)<textarea className={input} rows={2} value={form.instruction} onChange={f('instruction')} maxLength={2000} /></label>
                <label className="text-sm font-bold">Level<select className={input} value={form.severity} onChange={f('severity')}>{SEVERITIES.map((s) => <option key={s} value={s}>{SEVERITY_LABELS[s]}</option>)}</select></label>
                <label className="text-sm font-bold">Hazard<select className={input} value={form.hazard_type} onChange={f('hazard_type')}>{(Object.keys(HAZARD_TYPES) as HazardType[]).map((h) => <option key={h} value={h}>{HAZARD_TYPES[h]}</option>)}</select></label>
                <label className="text-sm font-bold">Area (words)<input className={input} value={form.affected_area} onChange={f('affected_area')} /></label>
                <label className="text-sm font-bold">Link to the original source (https)<input className={input} value={form.source_url} onChange={f('source_url')} /></label>
                <label className="text-sm font-bold">Expires<input type="datetime-local" className={input} value={form.expires_at} onChange={f('expires_at')} /></label>
                <fieldset className="grid grid-cols-3 gap-2 text-sm font-bold"><legend className="sr-only">Optional circle boundary</legend>
                  <label>Lat<input className={input} value={form.lat} onChange={f('lat')} inputMode="decimal" /></label><label>Lng<input className={input} value={form.lng} onChange={f('lng')} inputMode="decimal" /></label><label>Radius km<input className={input} value={form.radiusKm} onChange={f('radiusKm')} inputMode="decimal" /></label></fieldset>
              </div>
              <p className="mt-1 text-xs text-ink-600">Without a boundary the announcement is shown to everyone and push goes to all subscribers who allow this level.</p>
              <label className="mt-3 flex items-start gap-2 text-sm"><input type="checkbox" checked={form.verified} onChange={f('verified')} /> I have verified this information with an authoritative source.</label>
              <label className="mt-1 flex items-start gap-2 text-sm"><input type="checkbox" checked={form.notify} onChange={f('notify')} /> Also send push notifications now.</label>
              <button className="btn-primary mt-3" disabled={busy || !form.verified || !form.title || !form.description || !form.affected_area || !form.expires_at} onClick={publish}>Publish announcement</button></section>

            <section aria-labelledby="is"><h2 id="is" className="font-display text-xl font-semibold">Malformed or rejected source data</h2>
              <ul className="mt-2 space-y-1 text-sm">{data.issues.slice(0, 30).map((i) => <li key={i.id}>{fmt(i.created_at)} · <strong>{i.provider}</strong> · {i.kind}: {i.detail}</li>)}{!data.issues.length && <li>None.</li>}</ul></section>
            <section aria-labelledby="nt"><h2 id="nt" className="font-display text-xl font-semibold">Notification delivery</h2>
              <ul className="mt-2 space-y-1 text-sm">{data.notifications.recent.slice(0, 20).map((n) => <li key={n.id}>{fmt(n.created_at)} · {n.kind} · <strong>{n.outcome}</strong>{n.detail ? ` · ${n.detail}` : ''}</li>)}{!data.notifications.recent.length && <li>None sent yet.</li>}</ul></section>
            <section aria-labelledby="au"><h2 id="au" className="font-display text-xl font-semibold">Audit trail</h2>
              <ul className="mt-2 space-y-1 text-sm">{data.audit.slice(0, 50).map((e) => <li key={e.id}>{fmt(e.at)} · {e.actor} · <strong>{e.action}</strong> · {e.detail}</li>)}{!data.audit.length && <li>No actions recorded.</li>}</ul></section>
          </>
        )}
      </main>
    </div>
  )
}
