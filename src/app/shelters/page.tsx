'use client'

// Shelter placement assistant: dashboard, explainable recommendations, reservations, coverage/planning and registry.
// Everything here is decision SUPPORT: a person confirms before anyone is sent. Permissions are enforced by the API, not by this page.
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useSearchParams } from 'next/navigation'
import SiteHeader from '@/components/common/SiteHeader'
import { authHeaders } from '@/lib/routingClient'
import { useSession } from '@/lib/session'
import { FACILITY_KEYS, FACILITY_LABELS } from '@/lib/shelters/types'
import type { Dashboard } from '@/lib/shelters/dashboard'
import type { Recommendation, ShelterAssessment } from '@/lib/shelters/engine'
import type { CoverageResult, HypotheticalReport } from '@/lib/shelters/coverage'
import type { ReservationRecord, ShelterException, ShelterRecord } from '@/lib/shelters/types'

const CoverageMap = dynamic(() => import('@/components/shelters/ShelterCoverageMap'), { ssr: false, loading: () => <p role="status" className="p-4">Loading map...</p> })

type Tab = 'dashboard' | 'find' | 'reservations' | 'coverage' | 'registry'
type Api<T> = { ok: boolean; status: number; data: T & { error?: string; code?: string } }
async function api<T = Record<string, unknown>>(path: string, method = 'GET', body?: unknown): Promise<Api<T>> {
  const res = await fetch(`/api/shelters${path}`, { method, headers: { 'Content-Type': 'application/json', ...(await authHeaders()) }, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' })
  return { ok: res.ok, status: res.status, data: (await res.json().catch(() => ({}))) as Api<T>['data'] }
}
const newKey = () => (globalThis.crypto?.randomUUID?.() ?? `k-${Date.now()}-${Math.random().toString(36).slice(2)}`)
const tierPill: Record<string, string> = { recommended: 'bg-success-100 text-success-800', review_required: 'bg-warning-100 text-warning-700', excluded: 'bg-critical-100 text-critical-700' }
const tierText: Record<string, string> = { recommended: 'Recommended', review_required: 'Review first', excluded: 'Excluded' }
const sevMark: Record<string, string> = { block: 'Blocks', flag: 'Warning', info: 'Note' }

function ErrorBox({ msg }: { msg: string }) { return msg ? <p role="alert" className="mt-3 rounded-2xl border-2 border-critical-700 bg-critical-100 p-3 text-[15px] font-bold">{msg}</p> : null }
const Card = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => <section className={`clay p-5 ${className}`} style={{ borderRadius: 24 }}>{children}</section>
const Num = ({ label, v, hint }: { label: string; v: React.ReactNode; hint?: string }) => (
  <div className="clay-sm px-4 py-3" style={{ borderRadius: 18 }}><p className="text-sm text-ink-700">{label}</p><p className="text-2xl font-extrabold">{v}</p>{hint && <p className="text-xs text-ink-700">{hint}</p>}</div>
)

function Inner() {
  const { user, ready } = useSession()
  const params = useSearchParams()
  const [tab, setTab] = useState<Tab>(params.get('tab') === 'find' || params.get('lat') ? 'find' : 'dashboard')
  const staff = user?.role === 'responder' || user?.role === 'admin'
  const isAdmin = user?.role === 'admin'

  if (!ready) return <p className="mt-8" role="status">Loading...</p>
  if (!staff) return (
    <Card className="mt-6"><h1 className="text-2xl font-extrabold">Shelter tools are for responders</h1>
      <p className="mt-2 text-ink-700">Sign in with a responder or administrator account to find shelters for evacuation groups and manage reservations. If you need shelter, use the Map to see verified shelters, or call emergency services.</p></Card>
  )
  const tabs: [Tab, string][] = [['dashboard', 'Dashboard'], ['find', 'Find a shelter'], ['reservations', 'Reservations'], ['coverage', 'Coverage & planning'], ['registry', 'Registry']]
  return (
    <>
      <h1 className="mt-6 text-3xl font-extrabold">Shelters</h1>
      <p className="mt-1 max-w-3xl text-ink-700">Decision support for placing evacuees. Recommendations explain themselves, never treat the closest shelter as automatically best, and need a person to confirm before anyone is sent.</p>
      <div role="tablist" aria-label="Shelter tools" className="mt-4 flex flex-wrap gap-2">
        {tabs.map(([id, label]) => (
          <button key={id} role="tab" id={`tab-${id}`} aria-selected={tab === id} aria-controls={`panel-${id}`} onClick={() => setTab(id)} className={`rounded-xl px-4 py-2 font-bold ${tab === id ? 'clay-inset' : 'clay-sm'}`}>{label}</button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="mt-4">
        {tab === 'dashboard' && <DashboardTab />}
        {tab === 'find' && <FindTab initial={{ lat: params.get('lat') ?? '', lng: params.get('lng') ?? '', people: params.get('people') ?? '', incident: params.get('incident') ?? '', dispatch: params.get('dispatch') ?? '' }} onReserved={() => setTab('reservations')} />}
        {tab === 'reservations' && <ReservationsTab />}
        {tab === 'coverage' && <CoverageTab />}
        {tab === 'registry' && <RegistryTab isAdmin={isAdmin} />}
      </div>
    </>
  )
}

// ------------------------------------------------------------------------------------------------------------ dashboard
function DashboardTab() {
  const [d, setD] = useState<(Dashboard & { hazardDataNotices?: string[] }) | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { api<Dashboard & { hazardDataNotices?: string[] }>('/dashboard').then((r) => (r.ok ? setD(r.data) : setErr(r.data.error || 'Could not load the dashboard.'))) }, [])
  if (err) return <ErrorBox msg={err} />
  if (!d) return <p role="status">Loading dashboard...</p>
  const s = d.summary
  return (
    <div className="space-y-4">
      {d.hazardDataNotices?.map((n) => <p key={n} role="status" className="rounded-2xl border-2 border-warning-700 bg-warning-100 p-3 font-bold">{n}</p>)}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Num label="Free places" v={s.totalAvailable} hint="Upper bound: includes flagged records" />
        <Num label="Occupied / held" v={`${s.totalOccupied} / ${s.totalReserved}`} />
        <Num label="Open / full / closed" v={`${s.open} / ${s.full} / ${s.closed}`} />
        <Num label="Stale or estimated occupancy" v={s.staleOccupancy} />
        <Num label="Unverified or stale records" v={s.staleVerification} />
        <Num label="Access problems" v={s.accessProblems} />
        <Num label="Hazard-exposed (verified)" v={s.hazardExposed} />
        <Num label="Potentially exposed" v={s.potentiallyExposed} />
      </div>
      <p className="text-sm text-ink-700">{s.capacityNote}</p>
      <Card>
        <h2 className="text-xl font-extrabold">Needs attention</h2>
        {d.attention.length === 0 ? <p className="mt-2">No shelter has an open warning.</p> : (
          <ul className="mt-3 space-y-2">{d.attention.map((r) => (
            <li key={r.id} className="clay-sm px-4 py-3" style={{ borderRadius: 18 }}>
              <p className="font-bold">{r.name} <span className="font-normal text-ink-700">({r.status})</span></p>
              <ul className="mt-1 list-disc pl-5 text-sm">{r.flags.map((f, i) => <li key={i}><strong>{f.severity === 'high' ? 'Important: ' : ''}</strong>{f.message}</li>)}</ul>
            </li>))}
          </ul>)}
      </Card>
      <Card>
        <h2 className="text-xl font-extrabold">All shelters</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <caption className="sr-only">Occupancy and remaining capacity per shelter</caption>
            <thead><tr className="border-b-2 border-sand-300"><th scope="col" className="py-2">Shelter</th><th scope="col">Status</th><th scope="col">Occupied</th><th scope="col">Held</th><th scope="col">Free</th><th scope="col">Data quality</th></tr></thead>
            <tbody>{d.rows.map((r) => (
              <tr key={r.id} className="border-b border-sand-200 align-top">
                <th scope="row" className="py-2 pr-2 font-bold">{r.name}</th>
                <td>{r.status}</td>
                <td>{r.max == null ? 'capacity unknown' : `${r.occupied} / ${r.max}`}{r.percentFull != null && <meter className="ml-2 align-middle" min={0} max={100} value={Math.min(100, r.percentFull)} aria-label={`${r.percentFull}% full`} />}</td>
                <td>{r.reserved}</td><td>{r.available ?? '-'}</td>
                <td className="text-xs">{r.dataQuality.occupancy.label}<br />{r.dataQuality.verification.label}</td>
              </tr>))}</tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

// ------------------------------------------------------------------------------------------------------------ find
const NEED_FIELDS: [string, string][] = [['wheelchairUsers', 'Wheelchair users'], ['mobilityAssistance', 'Need mobility help'], ['oxygenUsers', 'Need oxygen'], ['essentialMedication', 'Essential medication'], ['infants', 'Infants'], ['elderly', 'Older adults'], ['pregnant', 'Pregnancy-related needs']]

function FindTab({ initial, onReserved }: { initial: { lat: string; lng: string; people: string; incident: string; dispatch: string }; onReserved: () => void }) {
  const [lat, setLat] = useState(initial.lat), [lng, setLng] = useState(initial.lng)
  const [party, setParty] = useState(initial.people || '4')
  const [needs, setNeeds] = useState<Record<string, string>>({})
  const [together, setTogether] = useState(false)
  const [vehicle, setVehicle] = useState('car')
  const [flood, setFlood] = useState(false)
  const [busy, setBusy] = useState(false), [err, setErr] = useState('')
  const [rec, setRec] = useState<(Recommendation & { hazardDataNotices?: string[]; integrations?: Record<string, string>; floodScenario?: { name: string } | null }) | null>(null)
  const [reserving, setReserving] = useState<ShelterAssessment | null>(null)

  const run = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(''); setRec(null); setBusy(true)
    const n: Record<string, unknown> = { partySize: Number(party) }
    for (const [k] of NEED_FIELDS) if (needs[k]) n[k] = Number(needs[k])
    if (together) n.keepFamilyTogether = true
    const r = await api<typeof rec & object>('/recommend', 'POST', { origin: { lat: Number(lat), lng: Number(lng) }, needs: n, vehicle, useActiveFloodZones: flood, ...(initial.incident ? { incidentId: initial.incident } : {}) })
    setBusy(false)
    if (!r.ok) return setErr(r.data.error || 'Could not get recommendations.')
    setRec(r.data as NonNullable<typeof rec>)
  }
  return (
    <div className="space-y-4">
      <Card>
        <form onSubmit={run} className="grid gap-3 md:grid-cols-4">
          <label className="block"><span className="font-bold">Group location, latitude</span><input className="input" required inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} /></label>
          <label className="block"><span className="font-bold">Longitude</span><input className="input" required inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} /></label>
          <label className="block"><span className="font-bold">People in the group</span><input className="input" required type="number" min={1} max={5000} value={party} onChange={(e) => setParty(e.target.value)} /></label>
          <label className="block"><span className="font-bold">Travelling by</span>
            <select className="input" value={vehicle} onChange={(e) => setVehicle(e.target.value)}>{['car', 'truck', 'ambulance', 'boat', 'walking'].map((v) => <option key={v}>{v}</option>)}</select></label>
          <fieldset className="md:col-span-4"><legend className="font-bold">Needs in the group (counts only: do not enter names or diagnoses)</legend>
            <div className="mt-1 grid grid-cols-2 gap-3 md:grid-cols-4">
              {NEED_FIELDS.map(([k, label]) => <label key={k} className="block text-sm">{label}<input className="input" type="number" min={0} max={Number(party) || 0} value={needs[k] ?? ''} onChange={(e) => setNeeds({ ...needs, [k]: e.target.value })} /></label>)}
              <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" checked={together} onChange={(e) => setTogether(e.target.checked)} /> Keep family members together</label>
            </div></fieldset>
          <label className="flex items-center gap-2 md:col-span-3"><input type="checkbox" checked={flood} onChange={(e) => setFlood(e.target.checked)} /> Treat active flood zones as a flood scenario (flags shelters inside them)</label>
          <button className="btn-primary" disabled={busy}>{busy ? 'Checking shelters and routes...' : 'Find shelters'}</button>
        </form>
        <ErrorBox msg={err} />
      </Card>

      {rec && (
        <div className="space-y-4" aria-live="polite">
          {rec.humanReview.required && (
            <div role="alert" className="rounded-2xl border-2 border-warning-700 bg-warning-100 p-4">
              <h2 className="text-lg font-extrabold">Human review needed</h2>
              <ul className="mt-1 list-disc pl-5">{rec.humanReview.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
              {rec.humanReview.unmetRequirements.length > 0 && (<><p className="mt-2 font-bold">Unmet requirements</p>
                <ul className="list-disc pl-5">{rec.humanReview.unmetRequirements.map((u) => <li key={u.requirement}><strong>{u.requirement}</strong>: not met at {u.failedAt} shelter(s){u.examples.length ? `, for example ${u.examples[0]}` : ''}</li>)}</ul></>)}
            </div>)}
          {rec.notices.map((n) => <p key={n} role="status" className="rounded-2xl border-2 border-warning-700 bg-warning-100 p-3 font-bold">{n}</p>)}
          {rec.hazardDataNotices?.map((n) => <p key={n} role="status" className="rounded-2xl border-2 border-warning-700 bg-warning-100 p-3 font-bold">{n}</p>)}
          {rec.closest && <p className="text-sm"><strong>Closest shelter ({rec.closest.name}, {(rec.closest.straightLineM / 1000).toFixed(1)} km straight line):</strong> {rec.closest.outcome}</p>}
          <h2 className="text-xl font-extrabold">Options ({rec.recommended.length})</h2>
          {rec.recommended.length === 0 && <p>No shelter can be recommended. See the exclusions below and the review note above.</p>}
          <ol className="space-y-3">{rec.recommended.map((a) => <AssessmentCard key={a.shelterId} a={a} onReserve={() => setReserving(a)} />)}</ol>
          <details className="clay-sm p-4" style={{ borderRadius: 20 }}><summary className="cursor-pointer text-lg font-extrabold">Excluded shelters ({rec.excluded.length}) and why</summary>
            <ul className="mt-3 space-y-3">{rec.excluded.map((a) => <AssessmentCard key={a.shelterId} a={a} />)}</ul></details>
          {rec.integrations && <details className="text-sm"><summary className="cursor-pointer font-bold">What this check can and cannot see</summary><ul className="mt-2 list-disc pl-5">{Object.values(rec.integrations).map((t) => <li key={t}>{t}</li>)}</ul></details>}
          <p className="text-sm text-ink-700">{rec.disclaimer}</p>
        </div>)}
      {reserving && rec && <ReserveDialog a={reserving} needs={rec.needs} initial={initial} onClose={() => setReserving(null)} onDone={onReserved} />}
    </div>
  )
}

function AssessmentCard({ a, onReserve }: { a: ShelterAssessment; onReserve?: () => void }) {
  return (
    <li className="clay-sm p-4" style={{ borderRadius: 20 }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-extrabold">{a.rank ? `${a.rank}. ` : ''}{a.name}{a.area ? <span className="font-normal text-ink-700"> ({a.area})</span> : null}</h3>
        <span className={`pill ${tierPill[a.tier]}`}>{tierText[a.tier]}{a.score != null ? `, fit ${a.score}/100` : ''}</span>
      </div>
      <p className="mt-1">{a.summary}</p>
      {a.tier !== 'excluded' && (
        <p className="mt-1 text-sm text-ink-700">
          {a.travel.durationMin != null ? `${a.travel.durationMin} min` : '-'}{a.travel.distanceM ? `, ${(a.travel.distanceM / 1000).toFixed(1)} km` : ''} ({a.travel.basis === 'road' ? 'road route' : 'ESTIMATE, not a road route'}) ·
          {' '}{a.availability.available} free of {a.availability.max} ({a.availability.usable} relied on) · {a.dataQuality.occupancy.label} · {a.dataQuality.verification.label}
        </p>)}
      <details className="mt-2"><summary className="cursor-pointer font-bold">Why ({a.reasons.filter((r) => r.severity !== 'info').length} warning/blocking, {a.reasons.filter((r) => r.severity === 'info').length} notes)</summary>
        <ul className="mt-1 list-disc pl-5 text-sm">{a.reasons.map((r, i) => <li key={i}><strong>{sevMark[r.severity]}:</strong> {r.message}</li>)}</ul>
        {a.requirements.length > 0 && <><p className="mt-2 text-sm font-bold">Required for this group</p><ul className="list-disc pl-5 text-sm">{a.requirements.map((r) => <li key={r.id}>{r.met ? 'Met' : 'NOT met'}: {r.label}. {r.detail}</li>)}</ul></>}
        {a.scoreBreakdown.length > 0 && <><p className="mt-2 text-sm font-bold">Score breakdown (ordering aid only, not a safety rating)</p>
          <ul className="list-disc pl-5 text-sm">{a.scoreBreakdown.map((b) => <li key={b.key}>{b.label}: {b.points}/{b.max}. {b.detail}</li>)}</ul></>}
      </details>
      {onReserve && <button className="btn-primary btn-sm mt-3" onClick={onReserve} aria-label={`Reserve places at ${a.name}`}>Reserve places...</button>}
    </li>
  )
}

function ReserveDialog({ a, needs, initial, onClose, onDone }: { a: ShelterAssessment; needs: Recommendation['needs']; initial: { incident: string; dispatch: string }; onClose: () => void; onDone: () => void }) {
  const [label, setLabel] = useState(''), [eta, setEta] = useState('30'), [hold, setHold] = useState('90')
  const [busy, setBusy] = useState(false), [err, setErr] = useState('')
  const key = useRef(newKey()) // one key per dialog: a retry after a network error cannot book twice
  const first = useRef<HTMLInputElement>(null)
  useEffect(() => first.current?.focus(), [])
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('')
    const r = await api('/reservations', 'POST', { shelterId: a.shelterId, groupLabel: label, incidentId: initial.incident || null, dispatchId: initial.dispatch || null, needs, expectedArrivalAt: new Date(Date.now() + Number(eta) * 60_000).toISOString(), holdMinutes: Number(hold), idempotencyKey: key.current })
    setBusy(false)
    if (!r.ok) return setErr(`${r.data.error || 'Could not reserve.'}`)
    onDone()
  }
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="rv-title" className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/50 p-4" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <form onSubmit={submit} className="clay w-full max-w-md p-5" style={{ borderRadius: 24 }}>
        <h2 id="rv-title" className="text-xl font-extrabold">Reserve at {a.name}</h2>
        <p className="mt-1 text-sm text-ink-700">Holds {needs.partySize} place(s). This is a hold, not an arrival: people are counted as inside only when you confirm they arrived.{a.tier === 'review_required' ? ' This option has warnings: confirm with the shelter first.' : ''}</p>
        <label className="mt-3 block font-bold">Group label (no names or medical details)<input ref={first} className="input" required minLength={2} maxLength={60} value={label} onChange={(e) => setLabel(e.target.value)} /></label>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="block font-bold">Arrives in (min)<input className="input" type="number" min={0} max={4320} value={eta} onChange={(e) => setEta(e.target.value)} /></label>
          <label className="block font-bold">Hold for (min)<input className="input" type="number" min={15} max={1440} value={hold} onChange={(e) => setHold(e.target.value)} /></label>
        </div>
        <ErrorBox msg={err} />
        <div className="mt-4 flex gap-2"><button className="btn-primary" disabled={busy}>{busy ? 'Reserving...' : 'Reserve'}</button><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button></div>
      </form>
    </div>
  )
}

// ------------------------------------------------------------------------------------------------------------ reservations
function ReservationsTab() {
  const [rows, setRows] = useState<ReservationRecord[] | null>(null)
  const [names, setNames] = useState<Record<string, string>>({})
  const [err, setErr] = useState(''), [note, setNote] = useState('')
  const [count, setCount] = useState<Record<string, string>>({}), [reason, setReason] = useState<Record<string, string>>({})
  const load = useCallback(async () => {
    const [r, s] = await Promise.all([api<{ reservations: ReservationRecord[] }>('/reservations'), api<{ shelters: ShelterRecord[] }>('')])
    if (!r.ok) return setErr(r.data.error || 'Could not load reservations.')
    setRows(r.data.reservations); setNames(Object.fromEntries((s.data.shelters ?? []).map((x) => [x.id, x.name])))
  }, [])
  useEffect(() => { load() }, [load])
  const act = async (id: string, body: object, ok: string) => {
    setErr(''); setNote('')
    const r = await api(`/reservations/${id}`, 'PATCH', body)
    if (!r.ok) setErr(r.data.error || 'That action was refused.'); else setNote(ok)
    load()
  }
  if (!rows) return err ? <ErrorBox msg={err} /> : <p role="status">Loading reservations...</p>
  const order = { reserved: 0, arrived: 1, expired: 2, cancelled: 3, departed: 4 } as Record<string, number>
  const sorted = [...rows].sort((a, b) => order[a.status] - order[b.status])
  return (
    <div className="space-y-3">
      <ErrorBox msg={err} />{note && <p role="status" className="rounded-2xl border-2 border-success-700 bg-success-100 p-3 font-bold">{note}</p>}
      {sorted.length === 0 && <p>No reservations yet. Use "Find a shelter" to hold places for a group.</p>}
      <ul className="space-y-3">{sorted.map((r) => (
        <li key={r.id} className="clay-sm p-4" style={{ borderRadius: 20 }}>
          <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-extrabold">{r.group_label} at {names[r.shelter_id] ?? 'shelter'}</h3><span className="pill">{r.status}</span></div>
          <p className="text-sm text-ink-700">{r.party_size} reserved{r.arrived_count ? `, ${r.arrived_count} arrived` : ''} · expected {r.expected_arrival_at ? new Date(r.expected_arrival_at).toLocaleString() : 'time not set'}
            {r.status === 'reserved' && ` · hold ends ${new Date(r.hold_expires_at).toLocaleTimeString()}`}{r.confirmed_arrival_at && ` · arrival confirmed ${new Date(r.confirmed_arrival_at).toLocaleTimeString()}`}{r.cancel_reason && ` · ${r.cancel_reason}`}</p>
          {r.status === 'reserved' && (
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <label className="text-sm">People who arrived<input className="input !w-28 !py-1.5" type="number" min={1} max={r.party_size} placeholder={String(r.party_size)} value={count[r.id] ?? ''} onChange={(e) => setCount({ ...count, [r.id]: e.target.value })} /></label>
              <button className="btn-primary btn-sm" onClick={() => act(r.id, { action: 'confirm_arrival', ...(count[r.id] ? { arrivedCount: Number(count[r.id]) } : {}) }, 'Arrival confirmed.')}>Confirm arrival</button>
              <button className="btn-secondary btn-sm" onClick={() => act(r.id, { action: 'extend_hold', minutes: 30 }, 'Hold extended by 30 minutes.')}>Extend hold 30 min</button>
              <label className="text-sm">Reason<input className="input !w-48 !py-1.5" value={reason[r.id] ?? ''} onChange={(e) => setReason({ ...reason, [r.id]: e.target.value })} /></label>
              <button className="btn-secondary btn-sm" disabled={(reason[r.id] ?? '').trim().length < 3} onClick={() => act(r.id, { action: 'cancel', reason: reason[r.id] }, 'Reservation cancelled; places released.')}>Cancel</button>
            </div>)}
          {r.status === 'arrived' && <button className="btn-secondary btn-sm mt-2" onClick={() => act(r.id, { action: 'depart' }, 'Departure recorded.')}>Record departure</button>}
        </li>))}</ul>
    </div>
  )
}

// ------------------------------------------------------------------------------------------------------------ coverage
function CoverageTab() {
  const [cov, setCov] = useState<CoverageResult | null>(null)
  const [cellKm, setCellKm] = useState('1'), [reach, setReach] = useState('30')
  const [sites, setSites] = useState<{ id: string; name: string; lat: number; lng: number; capacity: number }[]>([])
  const [rep, setRep] = useState<HypotheticalReport | null>(null)
  const [err, setErr] = useState(''), [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    setBusy(true); setErr('')
    const r = await api<CoverageResult>(`/coverage?cellKm=${encodeURIComponent(cellKm)}&reachMinutes=${encodeURIComponent(reach)}`)
    setBusy(false)
    if (!r.ok) return setErr(r.data.error || 'Could not analyse coverage.')
    setCov(r.data)
  }, [cellKm, reach])
  useEffect(() => { load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [])
  const compare = async () => {
    setBusy(true); setErr('')
    const r = await api<HypotheticalReport>('/coverage', 'POST', { cellKm: Number(cellKm), reachMinutes: Number(reach), candidates: sites.map(({ name, lat, lng, capacity }) => ({ name, lat, lng, capacity })) })
    setBusy(false)
    if (!r.ok) return setErr(r.data.error || 'Could not compare sites.')
    setRep(r.data)
  }
  const sum = cov?.summary
  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm font-bold">Cell size (km)<input className="input !w-24" type="number" min={0.5} max={5} step={0.5} value={cellKm} onChange={(e) => setCellKm(e.target.value)} /></label>
          <label className="text-sm font-bold">Reach (minutes)<input className="input !w-24" type="number" min={5} max={120} value={reach} onChange={(e) => setReach(e.target.value)} /></label>
          <button className="btn-primary btn-sm" onClick={load} disabled={busy}>{busy ? 'Working...' : 'Update map'}</button>
        </div>
        <ErrorBox msg={err} />
        {cov && <p className="mt-3 text-sm text-ink-700">{cov.method.join(' ')}</p>}
        {sum && <p className="mt-2 font-bold">{sum.none} cell(s) with no shelter in reach, {sum.limited} limited, {sum.adequate} adequate. Reported people in cells with no shelter in reach: {sum.demandNone}; with limited access: {sum.demandLimited}.</p>}
        <div className="mt-3"><CoverageMap coverage={cov} sites={sites} onPick={(lat, lng) => setSites((s) => s.length >= 10 ? s : [...s, { id: `p${s.length + 1}`, name: `Site ${s.length + 1}`, lat, lng, capacity: 200 }])} /></div>
        {cov && cov.sheltersNotCounted.length > 0 && <details className="mt-3 text-sm"><summary className="cursor-pointer font-bold">Shelters not counted as coverage ({cov.sheltersNotCounted.length})</summary><ul className="mt-1 list-disc pl-5">{cov.sheltersNotCounted.map((s) => <li key={s.id}>{s.name}: {s.reason}</li>)}</ul></details>}
      </Card>
      <Card>
        <h2 className="text-xl font-extrabold">Hypothetical sites (planning only)</h2>
        <p className="text-sm text-ink-700">Click the map to propose a site, then compare how each would change access. This does not say a site is suitable, safe or buildable.</p>
        <ul className="mt-3 space-y-2">{sites.map((s, i) => (
          <li key={s.id} className="flex flex-wrap items-end gap-2">
            <label className="text-sm">Name<input className="input !w-40 !py-1.5" value={s.name} maxLength={60} onChange={(e) => setSites(sites.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} /></label>
            <label className="text-sm">Capacity<input className="input !w-24 !py-1.5" type="number" min={10} value={s.capacity} onChange={(e) => setSites(sites.map((x, j) => (j === i ? { ...x, capacity: Number(e.target.value) } : x)))} /></label>
            <span className="text-sm">{s.lat}, {s.lng}</span>
            <button className="btn-secondary btn-sm" onClick={() => setSites(sites.filter((_, j) => j !== i))} aria-label={`Remove ${s.name}`}>Remove</button>
          </li>))}</ul>
        <button className="btn-primary btn-sm mt-3" disabled={!sites.length || busy} onClick={compare}>Compare sites</button>
        {rep && (
          <div className="mt-4 space-y-3">
            <p className="text-sm font-bold">{rep.disclaimer}</p>
            <ol className="space-y-2">{rep.candidates.map((c) => (
              <li key={c.id} className="clay-sm p-3" style={{ borderRadius: 18 }}>
                <p className="font-extrabold">{c.name} ({c.capacity} places)</p>
                <p className="text-sm">Reaches {c.demandNewlyReached} more reported people; cells with no shelter in reach {c.noneCellsBefore} to {c.noneCellsAfter}; limited {c.limitedCellsBefore} to {c.limitedCellsAfter}; average nearest shelter {c.avgNearestMinBefore ?? '-'} to {c.avgNearestMinAfter ?? '-'} min (estimates).</p>
                <p className="text-sm">{c.note}</p>
                {c.siteFlags.length > 0 && <ul className="list-disc pl-5 text-sm text-critical-700">{c.siteFlags.map((f, i) => <li key={i}>{f}</li>)}</ul>}
                <details className="text-sm"><summary className="cursor-pointer font-bold">Not assessed</summary><ul className="list-disc pl-5">{c.notAssessed.map((n) => <li key={n}>{n}</li>)}</ul></details>
              </li>))}</ol>
            {rep.combined && <p className="text-sm">All sites together would reach {rep.combined.demandNewlyReached} more reported people.</p>}
          </div>)}
      </Card>
    </div>
  )
}

// ------------------------------------------------------------------------------------------------------------ registry
function RegistryTab({ isAdmin }: { isAdmin: boolean }) {
  const [rows, setRows] = useState<ShelterRecord[] | null>(null)
  const [sel, setSel] = useState<string>('')
  const [err, setErr] = useState(''), [note, setNote] = useState('')
  const [exceptions, setExceptions] = useState<ShelterException[]>([])
  const load = useCallback(async () => {
    const [r, e] = await Promise.all([api<{ shelters: ShelterRecord[] }>(''), api<{ exceptions: ShelterException[] }>('/exceptions')])
    if (!r.ok) return setErr(r.data.error || 'Could not load shelters.')
    setRows(r.data.shelters); setExceptions(e.data.exceptions ?? [])
  }, [])
  useEffect(() => { load() }, [load])
  const s = useMemo(() => rows?.find((x) => x.id === sel) ?? null, [rows, sel])
  if (!rows) return err ? <ErrorBox msg={err} /> : <p role="status">Loading registry...</p>
  return (
    <div className="grid gap-4 md:grid-cols-[18rem,1fr]">
      <Card><h2 className="text-lg font-extrabold">Shelters</h2>
        <ul className="mt-2 space-y-1">{rows.map((r) => <li key={r.id}><button className={`w-full rounded-xl px-3 py-2 text-left ${sel === r.id ? 'clay-inset' : 'clay-sm'}`} onClick={() => { setSel(r.id); setNote(''); setErr('') }}><span className="font-bold">{r.name}</span><br /><span className="text-xs">{r.status} · {r.verification_status}</span></button></li>)}</ul></Card>
      <div className="space-y-4">
        <ErrorBox msg={err} />{note && <p role="status" className="rounded-2xl border-2 border-success-700 bg-success-100 p-3 font-bold">{note}</p>}
        {!s ? <p>Select a shelter to update its headcount{isAdmin ? ', edit its record, or authorize an exception' : ''}.</p> : <ShelterEditor key={s.id + (s.updated_at ?? '')} s={s} isAdmin={isAdmin} exceptions={exceptions.filter((e) => e.shelter_id === s.id)} onDone={(m, e) => { setNote(m); setErr(e); load() }} />}
      </div>
    </div>
  )
}

function ShelterEditor({ s, isAdmin, exceptions, onDone }: { s: ShelterRecord; isAdmin: boolean; exceptions: ShelterException[]; onDone: (note: string, err: string) => void }) {
  const [count, setCount] = useState(String(s.current_occupancy ?? 0)), [basis, setBasis] = useState('counted')
  const [f, setF] = useState({ capacity: String(s.capacity ?? ''), status: s.status, verification_status: s.verification_status, wheelchair_access: s.wheelchair_access, responsible_org: s.responsible_org ?? '', data_source: s.data_source ?? '', location_verified: s.location_verified, open24h: !!s.opening_hours?.open24h })
  const [fac, setFac] = useState<Record<string, { value: string; documented: boolean }>>(Object.fromEntries(FACILITY_KEYS.map((k) => [k, { value: s.facilities[k]?.value ?? 'unknown', documented: !!s.facilities[k]?.documented_at }])))
  const [ex, setEx] = useState({ kind: 'over_capacity', extra: '20', reason: '', hours: '4' })
  const saveOcc = async () => { const r = await api(`/${s.id}`, 'PATCH', { occupancy: { count: Number(count), basis } }); onDone(r.ok ? 'Headcount saved.' : '', r.ok ? '' : r.data.error || 'Refused.') }
  const saveReg = async () => {
    const body: Record<string, unknown> = { status: f.status, verification_status: f.verification_status, wheelchair_access: f.wheelchair_access, responsible_org: f.responsible_org || null, data_source: f.data_source || null, location_verified: f.location_verified, opening_hours: f.open24h ? { open24h: true } : s.opening_hours?.weekly ? s.opening_hours : null, facilities: Object.fromEntries(Object.entries(fac).map(([k, v]: [string, { value: string; documented: boolean }]) => [k, { value: v.value, documented: v.documented }])) }
    if (f.capacity) body.capacity = Number(f.capacity)
    const r = await api<{ warnings?: { message: string }[] }>(`/${s.id}`, 'PATCH', body)
    onDone(r.ok ? `Saved.${(r.data.warnings ?? []).map((w) => ' ' + w.message).join('')}` : '', r.ok ? '' : r.data.error || 'Refused.')
  }
  const addEx = async () => { const r = await api('/exceptions', 'POST', { shelterId: s.id, kind: ex.kind, extraCapacity: ex.kind === 'over_capacity' ? Number(ex.extra) : 0, reason: ex.reason, expiresAt: new Date(Date.now() + Number(ex.hours) * 3_600_000).toISOString() }); onDone(r.ok ? 'Exception recorded.' : '', r.ok ? '' : r.data.error || 'Refused.') }
  const revoke = async (id: string) => { const r = await api(`/exceptions/${id}`, 'DELETE'); onDone(r.ok ? 'Exception revoked.' : '', r.ok ? '' : r.data.error || 'Refused.') }
  return (
    <>
      <Card><h2 className="text-xl font-extrabold">{s.name}</h2>
        <p className="text-sm text-ink-700">Responsible organization: {s.responsible_org ?? 'not recorded'} · Source: {s.data_source ?? 'not recorded'} · Last verified: {s.last_verified_at ? new Date(s.last_verified_at).toLocaleDateString() : 'never'}</p>
        <h3 className="mt-3 font-extrabold">Update headcount</h3>
        <div className="mt-1 flex flex-wrap items-end gap-2">
          <label className="text-sm">People inside now<input className="input !w-28" type="number" min={0} value={count} onChange={(e) => setCount(e.target.value)} /></label>
          <label className="text-sm">How you know<select className="input" value={basis} onChange={(e) => setBasis(e.target.value)}><option value="counted">Counted by me or staff</option><option value="reported">Reported by shelter</option><option value="estimated">Estimate</option></select></label>
          <button className="btn-primary btn-sm" onClick={saveOcc}>Save headcount</button>
        </div>
      </Card>
      {isAdmin ? (
        <>
          <Card><h3 className="text-lg font-extrabold">Registry record</h3>
            <div className="mt-2 grid gap-3 md:grid-cols-3">
              <label className="text-sm font-bold">Maximum capacity<input className="input" type="number" min={1} value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value })} /></label>
              <label className="text-sm font-bold">Status<select className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as typeof f.status })}><option>open</option><option>full</option><option>closed</option></select></label>
              <label className="text-sm font-bold">Verification<select className="input" value={f.verification_status} onChange={(e) => setF({ ...f, verification_status: e.target.value as typeof f.verification_status })}><option>verified</option><option>unverified</option><option>needs_review</option><option>rejected</option></select></label>
              <label className="text-sm font-bold">Wheelchair access<select className="input" value={f.wheelchair_access} onChange={(e) => setF({ ...f, wheelchair_access: e.target.value as typeof f.wheelchair_access })}><option>unknown</option><option>full</option><option>partial</option><option>none</option></select></label>
              <label className="text-sm font-bold">Responsible organization<input className="input" value={f.responsible_org} onChange={(e) => setF({ ...f, responsible_org: e.target.value })} /></label>
              <label className="text-sm font-bold">Data source<input className="input" value={f.data_source} onChange={(e) => setF({ ...f, data_source: e.target.value })} /></label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.location_verified} onChange={(e) => setF({ ...f, location_verified: e.target.checked })} /> Location pin verified</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.open24h} onChange={(e) => setF({ ...f, open24h: e.target.checked })} /> Open 24 hours</label>
            </div>
            <fieldset className="mt-3"><legend className="font-extrabold">Facilities (tick "documented" only when someone has confirmed it)</legend>
              <div className="mt-1 grid gap-2 md:grid-cols-2">{FACILITY_KEYS.map((k) => (
                <div key={k} className="flex flex-wrap items-center gap-2 text-sm"><span className="w-48 font-bold">{FACILITY_LABELS[k]}</span>
                  <select aria-label={`${FACILITY_LABELS[k]} availability`} className="input !w-28 !py-1" value={fac[k].value} onChange={(e) => setFac({ ...fac, [k]: { ...fac[k], value: e.target.value } })}><option value="unknown">unknown</option><option value="yes">yes</option><option value="no">no</option></select>
                  <label className="flex items-center gap-1"><input type="checkbox" disabled={fac[k].value !== 'yes'} checked={fac[k].documented && fac[k].value === 'yes'} onChange={(e) => setFac({ ...fac, [k]: { ...fac[k], documented: e.target.checked } })} /> documented</label></div>))}</div></fieldset>
            <button className="btn-primary mt-3" onClick={saveReg}>Save record</button>
            <p className="mt-2 text-xs text-ink-700">Setting a shelter to closed cancels its active holds and reports them back. Moving the pin clears location verification.</p>
          </Card>
          <Card><h3 className="text-lg font-extrabold">Authorized exceptions</h3>
            <p className="text-sm text-ink-700">The only way a closed or full shelter can be recommended or reserved. Recorded with your name, a reason, and an expiry (72 hours at most).</p>
            <ul className="mt-2 list-disc pl-5 text-sm">{exceptions.map((e) => <li key={e.id}>{e.kind}{e.kind === 'over_capacity' ? ` +${e.extra_capacity}` : ''} until {new Date(e.expires_at).toLocaleString()}: {e.reason} ({e.authorized_by_name}){e.revoked_at ? ' [revoked]' : !(Date.parse(e.expires_at) > Date.now()) ? ' [expired]' : <button className="btn-secondary btn-sm ml-2" onClick={() => revoke(e.id)}>Revoke</button>}</li>)}</ul>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <label className="text-sm">Type<select className="input" value={ex.kind} onChange={(e) => setEx({ ...ex, kind: e.target.value })}><option value="over_capacity">Over capacity</option><option value="closed_use">Use while closed</option></select></label>
              {ex.kind === 'over_capacity' && <label className="text-sm">Extra places<input className="input !w-24" type="number" min={1} value={ex.extra} onChange={(e) => setEx({ ...ex, extra: e.target.value })} /></label>}
              <label className="text-sm">Hours (max 72)<input className="input !w-24" type="number" min={1} max={72} value={ex.hours} onChange={(e) => setEx({ ...ex, hours: e.target.value })} /></label>
              <label className="text-sm">Reason<input className="input !w-64" minLength={10} value={ex.reason} onChange={(e) => setEx({ ...ex, reason: e.target.value })} /></label>
              <button className="btn-primary btn-sm" disabled={ex.reason.trim().length < 10} onClick={addEx}>Authorize</button>
            </div>
          </Card>
        </>) : <p className="text-sm text-ink-700">Registry edits, verification and exceptions are for administrators.</p>}
    </>
  )
}

export default function SheltersPage() {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main id="main" className="mx-auto max-w-6xl px-4 pb-16">
        <Suspense fallback={<p className="mt-8" role="status">Loading...</p>}><Inner /></Suspense>
      </main>
    </div>
  )
}
