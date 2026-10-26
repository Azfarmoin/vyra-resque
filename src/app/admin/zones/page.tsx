'use client'

// Responders and administrators: create, edit, deactivate and cancel map zones. Every important change needs a reason
// and is written to the audit log by the server (and, with Supabase, by a database trigger).
import { useCallback, useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import SiteHeader from '@/components/common/SiteHeader'
import Icon from '@/components/ui/Icon'
import { TrustBadge, ZoneSwatch } from '@/components/map/ZoneUi'
import type { DrawMode } from '@/components/map/ZoneEditorMap'
import { useSession } from '@/lib/session'
import { DEFAULT_CENTER } from '@/lib/constants'
import { formatTime } from '@/lib/client'
import { zoneApi, authHeaders } from '@/lib/zones/client'
import type { Suggestion } from '@/lib/zones/evidence'
import { closeRing, isValidRadius } from '@/lib/zones/geometry'
import { displayState, HAZARD_LABELS, SEVERITY_LABELS, STATE_LABELS, validateZoneInput, ZONE_STYLES, zoneBBox } from '@/lib/zones/rules'
import { HAZARD_TYPES, SEVERITIES, ZONE_TYPES, type DisasterZone, type Position, type ZoneAuditEntry, type ZoneType } from '@/lib/zones/types'

const EditorMap = dynamic(() => import('@/components/map/ZoneEditorMap'), { ssr: false, loading: () => <div className="flex h-full items-center justify-center bg-sand-200 font-semibold">Loading map...</div> })

interface Form {
  name: string; zone_type: ZoneType; severity: string; hazard_type: string; description: string; precautions: string; status_detail: string
  evacuation_status: '' | 'order' | 'proposed'; verification: 'unverified' | 'human_verified' | 'official'; source_name: string; source_url: string
  valid_from: string; valid_until: string; boundary_quality: 'approximate' | 'surveyed' | 'official'; radius_m: string; radius_basis: string
  related_report_ids: string; lifecycle: 'active' | 'draft'; change_reason: string
}
const EMPTY: Form = { name: '', zone_type: 'caution', severity: 'moderate', hazard_type: 'flood', description: '', precautions: '', status_detail: '', evacuation_status: '', verification: 'unverified', source_name: '', source_url: '', valid_from: '', valid_until: '', boundary_quality: 'approximate', radius_m: '', radius_basis: '', related_report_ids: '', lifecycle: 'active', change_reason: '' }
const toLocal = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date(iso).getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : '')
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null)

function toForm(z: DisasterZone): Form {
  return {
    name: z.name, zone_type: z.zone_type, severity: z.severity, hazard_type: z.hazard_type, description: z.description, precautions: z.precautions ?? '', status_detail: z.status_detail ?? '',
    evacuation_status: z.evacuation_status ?? '', verification: z.verification_status === 'official' ? 'official' : z.verification_status === 'human_verified' ? 'human_verified' : 'unverified',
    source_name: z.source_name ?? '', source_url: z.source_url ?? '', valid_from: toLocal(z.valid_from), valid_until: toLocal(z.valid_until), boundary_quality: z.boundary_quality,
    radius_m: z.radius_m ? String(z.radius_m) : '', radius_basis: z.radius_basis ?? '', related_report_ids: z.related_report_ids.join(', '), lifecycle: z.lifecycle === 'draft' ? 'draft' : 'active', change_reason: '',
  }
}

export default function AdminZonesPage() {
  const { user, ready } = useSession()
  const isAdmin = user?.role === 'admin'
  const isStaff = isAdmin || user?.role === 'responder'
  const [zones, setZones] = useState<DisasterZone[]>([])
  const [loadError, setLoadError] = useState('')
  const [selected, setSelected] = useState<DisasterZone | null>(null)
  const [form, setForm] = useState<Form>(EMPTY)
  const [mode, setMode] = useState<DrawMode>('polygon')
  const [points, setPoints] = useState<Position[]>([])
  const [complex, setComplex] = useState(false) // MultiPolygon / holes: attributes editable, boundary kept as stored
  const [errors, setErrors] = useState<string[]>([])
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [audit, setAudit] = useState<ZoneAuditEntry[]>([])
  const [fit, setFit] = useState<[[number, number], [number, number]] | null>(null)
  const [offline, setOffline] = useState(false)
  const [sugg, setSugg] = useState<Suggestion[] | null>(null)
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine)
    update()
    window.addEventListener('online', update); window.addEventListener('offline', update)
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update) }
  }, [])

  const load = useCallback(async () => {
    try {
      const res = await zoneApi.list(user, { hidden: true, full: true })
      setZones(res.zones)
      setLoadError('')
    } catch (e) { setLoadError((e as Error).message) }
  }, [user])
  useEffect(() => { if (ready && isStaff) load() }, [ready, isStaff, load])

  const select = useCallback(async (z: DisasterZone | null) => {
    setErrors([]); setNotice(''); setSelected(z); setAudit([])
    if (!z) { setForm(EMPTY); setPoints([]); setComplex(false); setFit(null); return }
    setForm(toForm(z))
    const g = z.geometry
    setComplex(g.type === 'MultiPolygon' || (g.type === 'Polygon' && g.coordinates.length > 1))
    if (g.type === 'Polygon') { setMode('polygon'); setPoints(g.coordinates[0].slice(0, -1)) }
    else if (g.type === 'LineString') { setMode('line'); setPoints(g.coordinates) }
    else if (g.type === 'Point') { setMode(z.boundary_kind === 'circle' ? 'circle' : 'point'); setPoints([g.coordinates]) }
    else setPoints([])
    setFit([[z.bbox[1], z.bbox[0]], [z.bbox[3], z.bbox[2]]])
    try { setAudit((await zoneApi.audit(user, z.id)).audit) } catch { /* history is optional for editing */ }
  }, [user])

  // Open /admin/zones?id=... from the public map.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('id')
    if (id && zones.length && !selected) { const z = zones.find((x) => x.id === id); if (z) select(z) }
  }, [zones, selected, select])

  const analyze = (commit: boolean) => run(async () => {
    const res = await fetch('/api/zones/suggest', { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json', ...(await authHeaders(user)) }, body: JSON.stringify({ commit }) })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Analysis failed')
    setSugg(data.suggestions)
  }, commit ? 'Drafts saved. They are private until you review and publish them.' : 'Analysis finished. Nothing was changed.')

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }))

  const buildBody = () => {
    const ver = form.verification
    const geometry = complex && selected ? selected.geometry
      : mode === 'polygon' ? { type: 'Polygon', coordinates: [closeRing(points)] }
      : mode === 'line' ? { type: 'LineString', coordinates: points }
      : { type: 'Point', coordinates: points[0] }
    return {
      name: form.name, zone_type: form.zone_type, severity: form.severity, hazard_type: form.hazard_type, description: form.description, precautions: form.precautions || null,
      status_detail: form.status_detail || null, evacuation_status: form.zone_type === 'evacuation' ? form.evacuation_status || null : null,
      verification_status: ver, source_type: ver === 'official' ? 'official_manual' : 'responder', source_name: form.source_name || null, source_url: form.source_url || null,
      valid_from: fromLocal(form.valid_from), valid_until: fromLocal(form.valid_until), boundary_quality: form.boundary_quality,
      boundary_kind: complex && selected ? selected.boundary_kind : mode === 'circle' ? 'circle' : mode === 'line' ? 'road' : mode === 'point' ? 'point' : selected?.boundary_kind === 'administrative' ? 'administrative' : 'drawn',
      geometry, radius_m: mode === 'circle' ? Number(form.radius_m) || null : null, radius_basis: mode === 'circle' ? form.radius_basis || null : null,
      related_report_ids: form.related_report_ids.split(/[\s,]+/).filter(Boolean), related_shelter_ids: selected?.related_shelter_ids ?? [], related_road_ids: selected?.related_road_ids ?? [],
      lifecycle: selected && selected.lifecycle !== 'draft' ? selected.lifecycle : form.lifecycle, change_reason: form.change_reason || null,
    }
  }

  // Instant feedback uses the same rules the server applies; the server stays the authority.
  const preview = useMemo(() => validateZoneInput(buildBody()), [form, points, mode, complex, selected]) // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true); setErrors([]); setNotice('')
    try { await fn(); setNotice(done); await load() }
    catch (e) { setErrors([(e as Error).message]) }
    finally { setBusy(false) }
  }

  const save = () => {
    if (!preview.ok) return setErrors(preview.errors)
    const body = buildBody()
    run(async () => {
      if (selected) { const r = await zoneApi.update(user, selected.id, { ...body, revision: selected.revision }); await select(r.zone) }
      else { const r = await zoneApi.create(user, body); await select(r.zone) }
    }, selected ? 'Zone updated.' : 'Zone created.')
  }
  const act = (action: 'deactivate' | 'cancel' | 'reactivate') => {
    if (!selected) return
    if (form.change_reason.trim().length < 5) return setErrors(['Write a reason (at least 5 characters) before changing the status of a zone.'])
    run(async () => { const r = await zoneApi.update(user, selected.id, { action, revision: selected.revision, change_reason: form.change_reason }); await select(r.zone) }, `Zone ${action === 'reactivate' ? 'reactivated' : action === 'cancel' ? 'cancelled' : 'deactivated'}.`)
  }
  const discard = () => selected && confirm('Delete this draft permanently?') && run(async () => { await zoneApi.remove(user, selected.id); await select(null) }, 'Draft deleted.')

  const radiusOk = isValidRadius(Number(form.radius_m))
  const locked = !!selected && !isAdmin && (selected.verification_status === 'official' || selected.evacuation_status === 'order')
  const verifyOptions = isAdmin ? ['unverified', 'human_verified', 'official'] : ['unverified', 'human_verified']
  const state = selected ? displayState(selected) : null

  if (!ready) return <div className="page min-h-screen"><SiteHeader /></div>
  if (!isStaff) {
    return (
      <div className="page min-h-screen"><SiteHeader />
        <main id="main" className="mx-auto max-w-xl p-6"><div className="clay p-6" style={{ borderRadius: 28 }}>
          <h1 className="font-display text-2xl font-semibold">Zone management</h1>
          <p className="mt-2">Only signed-in responders and administrators can manage map zones. {user ? 'Your account does not have this permission.' : <Link href="/auth/login" className="font-bold underline">Sign in</Link>}</p>
        </div></main>
      </div>
    )
  }

  return (
    <div className="page min-h-screen">
      <SiteHeader />
      <main id="main" className="mx-auto grid max-w-7xl gap-4 p-3 sm:p-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        <h1 className="sr-only">Manage map zones</h1>

        <aside className="clay space-y-3 p-4 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto" style={{ borderRadius: 28 }} aria-label="Existing zones">
          <button type="button" className="btn-primary w-full" onClick={() => select(null)}><Icon name="plus" size={18} /> New zone</button>
          {loadError && <p className="rounded-xl bg-critical-100 p-2.5 text-sm font-semibold text-critical-700" role="alert">{loadError}</p>}
          <div className="clay-inset space-y-2 p-3 text-xs text-ink-700">
            <p className="font-display text-sm font-semibold text-ink-900">Suggestions from reports</p>
            <p>Looks for 3+ nearby open reports (verified count double) outside zones, or just outside unofficial ones. Zones never change by themselves.</p>
            <div className="flex gap-2"><button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => analyze(false)}>Analyze</button><button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => analyze(true)}>Save as drafts</button></div>
            {sugg && (sugg.length ? <ul className="space-y-1.5">{sugg.map((x, i) => <li key={i}><strong className="text-ink-900">{x.title}</strong><br />{x.basis}</li>)}</ul> : <p>No suggestions right now. That does not mean there is no hazard.</p>)}
          </div>
          <ul className="space-y-1">
            {zones.map((z) => (
              <li key={z.id}>
                <button type="button" onClick={() => select(z)} aria-current={selected?.id === z.id} className={`flex min-h-[48px] w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left hover:bg-sand-200/70 ${selected?.id === z.id ? 'clay-inset' : ''}`}>
                  <ZoneSwatch type={z.zone_type} size={24} />
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold">{z.name}</span><span className="block truncate text-xs text-ink-600">{STATE_LABELS[displayState(z)].split(' - ')[0]} · {z.verification_status.replace('_', ' ')}{z.feed_id ? ' · feed' : ''}</span></span>
                </button>
              </li>
            ))}
            {!zones.length && !loadError && <li className="text-sm text-ink-600">No zones yet.</li>}
          </ul>
        </aside>

        <section className="space-y-4" aria-label={selected ? 'Edit zone' : 'New zone'}>
          <div className="clay overflow-hidden p-1.5" style={{ borderRadius: 28 }}>
            <div className="flex flex-wrap items-center gap-2 p-2">
              {(['polygon', 'circle', 'line', 'point'] as DrawMode[]).map((m) => (
                <button key={m} type="button" disabled={complex || locked} className={`btn-sm ${mode === m ? 'btn-primary' : 'btn-ghost'}`} aria-pressed={mode === m} onClick={() => { setMode(m); setPoints([]) }}>
                  {{ polygon: 'Area (polygon)', circle: 'Circle', line: 'Road line', point: 'Marker only' }[m]}
                </button>
              ))}
              <button type="button" className="btn-ghost btn-sm" disabled={!points.length || complex || locked} onClick={() => setPoints((p) => p.slice(0, -1))}>Undo point</button>
              <button type="button" className="btn-ghost btn-sm" disabled={!points.length || complex || locked} onClick={() => setPoints([])}>Clear</button>
            </div>
            <p className="px-3 pb-2 text-xs text-ink-700">
              {complex ? 'This boundary has holes or several parts. You can edit its details but not redraw it here.'
                : mode === 'polygon' ? 'Tap the map to add boundary points (at least 3). Drag a numbered point to move it.'
                : mode === 'circle' ? 'Tap the map to place the centre. A circle needs a radius with a documented basis; otherwise draw an area or use a marker.'
                : mode === 'line' ? 'Tap along the road to add points (at least 2).' : 'Tap the map to place the marker. A marker has no boundary.'}
            </p>
            <div className="h-[380px] overflow-hidden" style={{ borderRadius: 22 }}>
              <EditorMap center={DEFAULT_CENTER} mode={mode} points={complex || locked ? (selected ? points : []) : points} radiusM={radiusOk ? Number(form.radius_m) : null} onChange={(p) => { if (!complex && !locked) setPoints(p) }} fit={fit} color={ZONE_STYLES[form.zone_type].colour} />
            </div>
          </div>

          <div className="clay space-y-4 p-4 sm:p-5" style={{ borderRadius: 28 }}>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-xl font-semibold">{selected ? `Edit: ${selected.name}` : 'New zone'}</h2>
              {selected && <TrustBadge v={selected.verification_status} />}
              {state && <span className="pill bg-sand-200 text-ink-800">{STATE_LABELS[state].split(' - ')[0]}</span>}
              {selected?.feed_id && <span className="pill bg-primary-100 text-primary-800">Imported from a feed</span>}
            </div>
            {locked && <p className="rounded-xl bg-warning-100 p-2.5 text-sm font-semibold">This is an official warning or evacuation order. Only an administrator can change it.</p>}

            <fieldset disabled={locked || busy} className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2"><label className="label" htmlFor="z-name">Name</label><input id="z-name" className="input" value={form.name} onChange={(e) => set('name', e.target.value)} /></div>
              <div><label className="label" htmlFor="z-type">Zone type</label>
                <select id="z-type" className="input" value={form.zone_type} onChange={(e) => set('zone_type', e.target.value as ZoneType)}>{ZONE_TYPES.map((t) => <option key={t} value={t}>{ZONE_STYLES[t].label}</option>)}</select></div>
              <div><label className="label" htmlFor="z-sev">Severity</label>
                <select id="z-sev" className="input" value={form.severity} onChange={(e) => set('severity', e.target.value)}>{SEVERITIES.map((t) => <option key={t} value={t}>{SEVERITY_LABELS[t]}</option>)}</select></div>
              <div><label className="label" htmlFor="z-haz">Hazard category</label>
                <select id="z-haz" className="input" value={form.hazard_type} onChange={(e) => set('hazard_type', e.target.value)}>{HAZARD_TYPES.map((t) => <option key={t} value={t}>{HAZARD_LABELS[t]}</option>)}</select></div>
              <div><label className="label" htmlFor="z-ver">Verification</label>
                <select id="z-ver" className="input" value={form.verification} onChange={(e) => set('verification', e.target.value as Form['verification'])}>
                  {verifyOptions.map((v) => <option key={v} value={v}>{{ unverified: 'Not verified', human_verified: 'Verified by a person (not official)', official: 'Official warning (administrators)' }[v]}</option>)}</select></div>
              {form.zone_type === 'evacuation' && (
                <div className="sm:col-span-2"><label className="label" htmlFor="z-evac">Evacuation status</label>
                  <select id="z-evac" className="input" value={form.evacuation_status} onChange={(e) => set('evacuation_status', e.target.value as Form['evacuation_status'])}>
                    <option value="">Choose...</option><option value="proposed">Proposed plan (not an order)</option>{isAdmin && <option value="order">Official evacuation order</option>}</select>
                  {!isAdmin && <p className="mt-1 text-xs text-ink-600">Only administrators can publish an evacuation order. You can propose a plan.</p>}</div>
              )}
              <div className="sm:col-span-2"><label className="label" htmlFor="z-desc">Hazard description</label><textarea id="z-desc" rows={3} className="input" value={form.description} onChange={(e) => set('description', e.target.value)} /></div>
              <div className="sm:col-span-2"><label className="label" htmlFor="z-prec">Recommended precautions</label><textarea id="z-prec" rows={2} className="input" value={form.precautions} onChange={(e) => set('precautions', e.target.value)} /></div>
              {form.zone_type === 'restricted' && <div className="sm:col-span-2"><label className="label" htmlFor="z-status">Exact status (what is restricted or unknown)</label><textarea id="z-status" rows={2} className="input" value={form.status_detail} onChange={(e) => set('status_detail', e.target.value)} /></div>}
              <div><label className="label" htmlFor="z-src">Source / issuing authority</label><input id="z-src" className="input" value={form.source_name} onChange={(e) => set('source_name', e.target.value)} /></div>
              <div><label className="label" htmlFor="z-url">Source link (optional)</label><input id="z-url" type="url" className="input" value={form.source_url} onChange={(e) => set('source_url', e.target.value)} placeholder="https://" /></div>
              <div><label className="label" htmlFor="z-from">Starts</label><input id="z-from" type="datetime-local" className="input" value={form.valid_from} onChange={(e) => set('valid_from', e.target.value)} /></div>
              <div><label className="label" htmlFor="z-until">Expires</label><input id="z-until" type="datetime-local" className="input" value={form.valid_until} onChange={(e) => set('valid_until', e.target.value)} /></div>
              <div><label className="label" htmlFor="z-bq">Boundary accuracy</label>
                <select id="z-bq" className="input" value={form.boundary_quality} onChange={(e) => set('boundary_quality', e.target.value as Form['boundary_quality'])}>
                  <option value="approximate">Approximate (labelled on the map)</option><option value="surveyed">Surveyed on site</option>{isAdmin && <option value="official">Official boundary</option>}</select></div>
              <div><label className="label" htmlFor="z-rep">Linked emergency report IDs</label><input id="z-rep" className="input" value={form.related_report_ids} onChange={(e) => set('related_report_ids', e.target.value)} placeholder="comma separated" /></div>
              {mode === 'circle' && (<>
                <div><label className="label" htmlFor="z-rad">Radius (metres)</label><input id="z-rad" inputMode="numeric" className="input" value={form.radius_m} onChange={(e) => set('radius_m', e.target.value)} /></div>
                <div><label className="label" htmlFor="z-rb">Basis for the radius</label><input id="z-rb" className="input" value={form.radius_basis} onChange={(e) => set('radius_basis', e.target.value)} placeholder="e.g. official 500 m isolation distance" /></div>
              </>)}
              {(!selected || selected.lifecycle === 'draft') && <label className="flex items-center gap-2 text-sm font-semibold sm:col-span-2"><input type="checkbox" checked={form.lifecycle === 'draft'} onChange={(e) => set('lifecycle', e.target.checked ? 'draft' : 'active')} /> Keep as a draft (not shown on the public map). Untick to publish.</label>}
              <div className="sm:col-span-2"><label className="label" htmlFor="z-why">Reason for this change {selected ? '(required for important changes)' : '(optional)'}</label><input id="z-why" className="input" value={form.change_reason} onChange={(e) => set('change_reason', e.target.value)} /></div>
            </fieldset>

            {(errors.length > 0 || (!preview.ok && (form.name || form.description))) && (
              <ul className="space-y-1 rounded-xl bg-critical-100 p-3 text-sm font-semibold text-critical-700" role="alert">
                {(errors.length ? errors : preview.errors).map((e) => <li key={e}>{e}</li>)}
              </ul>
            )}
            {notice && <p className="rounded-xl bg-success-100 p-2.5 text-sm font-bold text-success-800" role="status">{notice}</p>}

            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-primary" onClick={save} disabled={busy || locked}>{busy ? 'Saving...' : selected ? 'Save changes' : 'Create zone'}</button>
              {selected && state && !['cancelled', 'deactivated'].includes(selected.lifecycle) && selected.lifecycle !== 'draft' && (<>
                <button type="button" className="btn-ghost" onClick={() => act('deactivate')} disabled={busy || locked}>Deactivate</button>
                <button type="button" className="btn-ghost" onClick={() => act('cancel')} disabled={busy || locked}>Cancel zone</button>
              </>)}
              {selected && ['cancelled', 'deactivated'].includes(selected.lifecycle) && <button type="button" className="btn-ghost" onClick={() => act('reactivate')} disabled={busy || locked}>Reactivate</button>}
              {selected?.lifecycle === 'draft' && isAdmin && <button type="button" className="btn-ghost" onClick={discard} disabled={busy}>Delete draft</button>}
            </div>
            <p className="text-xs text-ink-600">Changes are visible to the public as soon as they are saved and are recorded in the audit log. Zones are cancelled, not deleted, so their history is kept. {offline && 'You are offline: edits are not queued, so reconnect to save.'}</p>
          </div>

          {selected && (
            <div className="clay p-4 sm:p-5" style={{ borderRadius: 28 }}>
              <h2 className="font-display text-xl font-semibold">History</h2>
              <ol className="mt-2 space-y-2 text-sm">
                {audit.map((a) => (
                  <li key={a.id} className="clay-inset p-2.5">
                    <p className="font-bold">{a.action.replace('_', ' ')} <span className="font-normal text-ink-600">by {a.actor}{a.actor_role ? ` (${a.actor_role})` : ''} · {formatTime(a.created_at)}</span></p>
                    {a.reason && <p>Reason: {a.reason}</p>}
                    {Object.keys(a.changes).length > 0 && <p className="text-xs text-ink-600">Changed: {Object.keys(a.changes).join(', ')}</p>}
                  </li>
                ))}
                {!audit.length && <li className="text-ink-600">No history available.</li>}
              </ol>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
