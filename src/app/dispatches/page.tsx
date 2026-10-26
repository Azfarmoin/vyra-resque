'use client'

<<<<<<< HEAD
// Rescue missions: each assignment moves through Assigned -> En route -> On scene -> Completed.
import { useEffect, useRef, useState } from 'react'
import { authHeaders } from '@/lib/routingClient'
import Link from 'next/link'
import SiteHeader from '@/components/common/SiteHeader'
import Icon, { type IconName } from '@/components/ui/Icon'
import { EmptyCrate } from '@/components/ui/Illustrations'
import { useDialog } from '@/components/ui/useDialog'
import { resourceTypeLabel } from '@/lib/matching'
import { formatTime } from '@/lib/client'
=======
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { resourceTypeLabel } from '@/lib/matching'
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895

interface Dispatch {
  id: string
  status: string
  notes: string | null
  assigned_at: string
  completed_at: string | null
  match_score: number | null
  distance_km: number | null
  match_explanation: { warnings?: string[] } | null
  emergency_reports: {
    id: string
    location_address: string
<<<<<<< HEAD
    people_count: number | null
=======
    people_count: number
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
    priority_score: number
    status: string
    immediate_danger: boolean
  } | null
  rescue_teams: { id: string; team_name: string; team_leader: string | null; contact_number: string | null } | null
  dispatch_resources: { id: string; quantity: number; resources: { resource_type: string; name: string | null } | null }[]
}

const STEPS = ['pending', 'en_route', 'on_scene', 'completed']
const STEP_LABELS: Record<string, string> = {
  pending: 'Assigned',
  en_route: 'En route',
  on_scene: 'On scene',
  completed: 'Completed',
<<<<<<< HEAD
  cancelled: 'Cancelled',
}
const LANE_ICON: Record<string, IconName> = { pending: 'list', en_route: 'route', on_scene: 'pin', completed: 'check', cancelled: 'close' }
const LANE_HINT: Record<string, string> = {
  pending: 'Team picked, not moving yet',
  en_route: 'Heading to the case',
  on_scene: 'Helping people now',
  completed: 'Closed, team is free again',
  cancelled: 'Stopped, team is free again',
}

// The mission's own timestamps are the only ones we have, so the timeline shows exactly those.
function Timeline({ d }: { d: Dispatch }) {
  const idx = STEPS.indexOf(d.status)
  const rows: { label: string; when: string | null; reached: boolean }[] = [{ label: 'Assigned', when: formatTime(d.assigned_at), reached: true }]
  if (d.status !== 'cancelled') {
    rows.push({ label: 'En route', when: null, reached: idx >= 1 })
    rows.push({ label: 'On scene', when: null, reached: idx >= 2 })
    rows.push({ label: 'Completed', when: d.status === 'completed' && d.completed_at ? formatTime(d.completed_at) : null, reached: d.status === 'completed' })
  } else {
    rows.push({ label: 'Cancelled', when: d.completed_at ? formatTime(d.completed_at) : null, reached: true })
  }
  return (
    <ol className="relative space-y-4 border-l-2 border-sand-300 pl-6" aria-label="Mission timeline">
      {rows.map((r) => (
        <li key={r.label} className="relative">
          <span
            className={`absolute -left-[35px] top-0.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-sand-100 ${r.reached ? 'bg-success-700 text-white' : 'bg-sand-300 text-ink-700'}`}
            aria-hidden="true"
          >
            {r.reached ? <Icon name="check" size={14} /> : null}
          </span>
          <p className="font-bold">
            {r.label}
            <span className="sr-only">{r.reached ? ' (reached)' : ' (not reached yet)'}</span>
          </p>
          <p className="text-sm text-ink-700">{r.when ?? (r.reached ? 'Reached. The time was not recorded.' : 'Not reached yet')}</p>
        </li>
      ))}
    </ol>
  )
}

function MissionDialog({ d, busy, onClose, onUpdate }: { d: Dispatch; busy: boolean; onClose: () => void; onUpdate: (status: string) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useDialog(ref, onClose)
  const idx = STEPS.indexOf(d.status)
  const next = idx >= 0 && idx < STEPS.length - 1 ? STEPS[idx + 1] : null
  const active = ['pending', 'en_route', 'on_scene'].includes(d.status)
  const rep = d.emergency_reports

  return (
    <div className="fixed inset-0 z-[2000] flex items-end justify-center bg-ink-900/55 p-0 sm:items-center sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="mission-title" tabIndex={-1} className="clay max-h-[92vh] w-full max-w-2xl overflow-y-auto p-5 outline-none sm:p-8" style={{ borderRadius: 32 }}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="pill bg-sand-200 text-ink-800">{STEP_LABELS[d.status] ?? d.status}</p>
            <h2 id="mission-title" className="mt-2 text-3xl font-semibold">{d.rescue_teams?.team_name ?? 'Unknown team'}</h2>
            <p className="text-ink-700">{rep?.location_address ?? 'Unknown case'}</p>
          </div>
          <button type="button" onClick={onClose} className="btn-ghost btn-sm !px-2.5" aria-label="Close mission details"><Icon name="close" size={18} /></button>
        </div>

        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <section aria-labelledby="mission-tl">
            <h3 id="mission-tl" className="mb-3 text-xl font-semibold">Timeline</h3>
            <Timeline d={d} />
          </section>
          <section className="space-y-4 text-[15px]" aria-label="Mission details">
            <div>
              <h3 className="text-xl font-semibold">The case</h3>
              <p className="mt-1">{rep?.people_count == null ? 'Number of people unknown' : `${rep.people_count} ${rep.people_count === 1 ? 'person' : 'people'}`}, urgency score {rep?.priority_score ?? 'unknown'}{rep?.immediate_danger ? ', immediate danger' : ''}.</p>
              {rep && <Link className="mt-1 inline-flex items-center gap-1 font-bold underline decoration-2 underline-offset-4" href={`/dashboard?id=${rep.id}`}>Open in dispatcher <Icon name="arrow" size={15} /></Link>}
              {rep && <Link className="mt-1 flex items-center gap-1 font-bold underline decoration-2 underline-offset-4" href={`/shelters?tab=find&incident=${rep.id}&dispatch=${d.id}${rep.people_count != null ? `&people=${rep.people_count}` : ''}`}>Find shelter for evacuees <Icon name="arrow" size={15} /></Link>}
            </div>
            <div>
              <h3 className="text-xl font-semibold">The team</h3>
              <p className="mt-1">
                {d.rescue_teams?.team_leader ? `Leader: ${d.rescue_teams.team_leader}` : 'No leader listed'}
                {d.rescue_teams?.contact_number && (
                  <>
                    {' '}
                    <a className="font-bold underline decoration-2 underline-offset-4" href={`tel:${d.rescue_teams.contact_number}`}>{d.rescue_teams.contact_number}</a>
                  </>
                )}
              </p>
              {(d.distance_km != null || d.match_score != null) && (
                <p className="text-ink-700">{d.distance_km != null ? `${d.distance_km} km away` : ''}{d.distance_km != null && d.match_score != null ? ', ' : ''}{d.match_score != null ? `match ${d.match_score} out of 100` : ''}</p>
              )}
            </div>
            {d.dispatch_resources.length > 0 && (
              <div>
                <h3 className="text-xl font-semibold">Supplies on this mission</h3>
                <ul className="mt-1 list-disc pl-5">
                  {d.dispatch_resources.map((r) => (
                    <li key={r.id}>{resourceTypeLabel(r.resources?.resource_type ?? '')}{r.resources?.name ? ` (${r.resources.name})` : ''} × {r.quantity}</li>
                  ))}
                </ul>
              </div>
            )}
            {d.notes && <p><span className="font-bold">Notes:</span> {d.notes}</p>}
            {d.match_explanation?.warnings?.length ? (
              <p className="flex gap-2 rounded-2xl bg-warning-100 p-3 font-semibold" role="note"><Icon name="alert" size={18} className="mt-0.5 shrink-0" /> {d.match_explanation.warnings.join(' · ')}</p>
            ) : null}
          </section>
        </div>

        {active && (
          <div className="mt-6 flex flex-wrap gap-3 border-t border-sand-200 pt-5">
            {next && (
              <button disabled={busy} onClick={() => onUpdate(next)} className="btn-primary">
                Mark {STEP_LABELS[next].toLowerCase()}
              </button>
            )}
            <button disabled={busy} onClick={() => onUpdate('cancelled')} className="btn-ghost">Cancel mission</button>
          </div>
        )}
      </div>
    </div>
  )
=======
  cancelled: 'Cancelled'
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
}

export default function DispatchesPage() {
  const [dispatches, setDispatches] = useState<Dispatch[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'active' | 'all'>('active')
  const [updating, setUpdating] = useState<string | null>(null)
<<<<<<< HEAD
  const [error, setError] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [lane, setLane] = useState('pending')
=======
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895

  const fetchDispatches = async () => {
    try {
      const response = await fetch(`/api/dispatches${filter === 'active' ? '?active=true' : ''}`)
      if (response.ok) setDispatches(await response.json())
<<<<<<< HEAD
      else setError('Missions could not be loaded. Try again in a moment.')
    } catch (error) {
      console.error('Failed to fetch dispatches:', error)
      setError('Missions could not be loaded. Check your connection.')
=======
    } catch (error) {
      console.error('Failed to fetch dispatches:', error)
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setLoading(true)
    fetchDispatches()
    const timer = setInterval(fetchDispatches, 15000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter])

  const updateStatus = async (id: string, status: string) => {
    if (status === 'cancelled' && !confirm('Cancel this assignment? The team and resources will be released.')) return
    setUpdating(id)
<<<<<<< HEAD
    setError('')
    try {
      const response = await fetch(`/api/dispatches/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ status }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        setError(data.error || 'The mission could not be updated.')
=======
    try {
      const response = await fetch(`/api/dispatches/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        alert(data.error || 'Failed to update dispatch')
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
      }
      await fetchDispatches()
    } finally {
      setUpdating(null)
    }
  }

<<<<<<< HEAD
  const lanes = filter === 'active' ? ['pending', 'en_route', 'on_scene'] : ['pending', 'en_route', 'on_scene', 'completed', 'cancelled']
  const inLane = (s: string) => dispatches.filter((d) => d.status === s)
  const open = dispatches.find((d) => d.id === openId) ?? null

  return (
    <div className="page">
      <SiteHeader />
      <main id="main" className="container-x py-6 sm:py-10">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-2xl">
            <h1 className="text-4xl font-semibold sm:text-5xl">Rescue missions</h1>
            <p className="mt-2 text-lg text-ink-700">Move each team through its mission. Closing a mission frees the team and its supplies.</p>
          </div>
          <div className="clay-inset flex gap-1 p-1" role="group" aria-label="Which missions to show" style={{ borderRadius: 20 }}>
            {(['active', 'all'] as const).map((f) => (
              <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} className={`rounded-2xl px-4 py-2 text-sm font-bold ${filter === f ? 'clay-sm' : 'text-ink-600'}`}>
                {f === 'active' ? 'Active' : 'All, with history'}
              </button>
            ))}
          </div>
        </header>

        {error && <p className="field-error mt-4" role="alert"><Icon name="alert" size={16} className="mt-0.5 shrink-0" /> {error}</p>}

        {/* Phones: one lane at a time */}
        <div className="clay-inset mt-6 flex gap-1 overflow-x-auto p-1 lg:hidden" role="tablist" aria-label="Mission stages" style={{ borderRadius: 20 }}>
          {lanes.map((s) => (
            <button key={s} role="tab" aria-selected={lane === s} onClick={() => setLane(s)} className={`whitespace-nowrap rounded-2xl px-3.5 py-2 text-sm font-bold ${lane === s ? 'clay-sm' : 'text-ink-600'}`}>
              {STEP_LABELS[s]} <span className="tabular-nums">{inLane(s).length}</span>
=======
  const count = (s: string) => dispatches.filter(d => d.status === s).length

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/dashboard" className="text-gray-600 hover:text-gray-900">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
              </Link>
              <h1 className="text-2xl font-bold text-gray-900">Team Dispatches</h1>
            </div>
            <div className="flex items-center gap-4">
              <Link href="/dashboard" className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors">
                Dashboard
              </Link>
              <Link href="/resources" className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors">
                Resources
              </Link>
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {(['pending', 'en_route', 'on_scene'] as const).map(s => (
            <div key={s} className="bg-white rounded-lg shadow p-6">
              <div className="text-3xl font-bold text-gray-900">{count(s)}</div>
              <div className="text-gray-600 text-sm">{STEP_LABELS[s]}</div>
            </div>
          ))}
        </div>

        <div className="bg-white rounded-lg shadow p-4 mb-6 flex items-center gap-2">
          <span className="text-sm font-medium text-gray-700 mr-2">Show:</span>
          {(['active', 'all'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded-md text-sm font-medium ${filter === f ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
            >
              {f === 'active' ? 'Active' : 'All (incl. history)'}
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
            </button>
          ))}
        </div>

        {loading ? (
<<<<<<< HEAD
          <p className="py-16 text-center font-semibold text-ink-600" role="status">Loading missions...</p>
        ) : dispatches.length === 0 ? (
          <div className="clay mt-6 flex flex-col items-center gap-3 p-10 text-center">
            <EmptyCrate className="w-40" />
            <h2 className="text-2xl font-semibold">No {filter === 'active' ? 'active ' : ''}missions</h2>
            <p className="max-w-md text-ink-700">Assign a team to a case and its mission appears here.</p>
            <Link href="/dashboard" className="btn-primary mt-1">Open the dispatcher workspace</Link>
          </div>
        ) : (
          <div className={`mt-6 grid gap-5 ${lanes.length > 3 ? 'lg:grid-cols-3 xl:grid-cols-5' : 'lg:grid-cols-3'}`}>
            {lanes.map((s, laneIdx) => (
              <section key={s} aria-labelledby={`lane-${s}`} className={`${lane === s ? '' : 'hidden'} lg:block`}>
                <div className="mb-3 flex items-center gap-3">
                  <span className={`flex h-10 w-10 items-center justify-center rounded-2xl ${s === 'completed' ? 'bg-success-700 text-white' : 'clay-sm'}`}><Icon name={LANE_ICON[s]} size={20} /></span>
                  <div>
                    <h2 id={`lane-${s}`} className="text-xl font-semibold leading-tight">{STEP_LABELS[s]} <span className="tabular-nums text-ink-600">{inLane(s).length}</span></h2>
                    <p className="text-sm text-ink-600">{LANE_HINT[s]}</p>
                  </div>
                  {laneIdx < 2 && <Icon name="arrow" size={20} className="ml-auto hidden text-ink-400 lg:block" />}
                </div>
                <ul className="space-y-3">
                  {inLane(s).map((d) => {
                    const idx = STEPS.indexOf(d.status)
                    const next = idx >= 0 && idx < STEPS.length - 1 ? STEPS[idx + 1] : null
                    return (
                      <li key={d.id} data-testid="dispatch-card" className="clay-sm lift p-4" style={{ borderRadius: 22 }}>
                        <button type="button" onClick={() => setOpenId(d.id)} className="block w-full rounded-lg text-left">
                          <span className="block font-display text-xl font-semibold leading-tight">{d.rescue_teams?.team_name ?? 'Unknown team'}</span>
                          <span className="mt-0.5 block text-[15px] text-ink-700">{d.emergency_reports?.location_address ?? 'Unknown case'}</span>
                          <span className="mt-1.5 block text-sm font-semibold text-ink-600">
                            {d.emergency_reports?.people_count == null ? 'People count unknown' : `${d.emergency_reports.people_count} ${d.emergency_reports.people_count === 1 ? 'person' : 'people'}`}{d.emergency_reports?.immediate_danger ? ', immediate danger' : ''}
                            {d.distance_km != null ? `, ${d.distance_km} km` : ''}
                          </span>
                          <span className="mt-1 block text-xs text-ink-600">Assigned {formatTime(d.assigned_at)}</span>
                        </button>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {next && (
                            <button disabled={updating === d.id} onClick={() => updateStatus(d.id, next)} className="btn-primary btn-sm">
                              Mark {STEP_LABELS[next].toLowerCase()}
                            </button>
                          )}
                          <button type="button" onClick={() => setOpenId(d.id)} className="btn-ghost btn-sm">Details</button>
                        </div>
                      </li>
                    )
                  })}
                  {inLane(s).length === 0 && <li className="clay-inset p-4 text-center text-sm font-semibold text-ink-600">Nothing here right now</li>}
                </ul>
              </section>
            ))}
          </div>
        )}
      </main>

      {open && <MissionDialog d={open} busy={updating === open.id} onClose={() => setOpenId(null)} onUpdate={(st) => updateStatus(open.id, st)} />}
=======
          <div className="text-center text-gray-500 py-12">Loading…</div>
        ) : dispatches.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-12 text-center text-gray-500">
            No {filter === 'active' ? 'active ' : ''}dispatches. Assign a team from the{' '}
            <Link href="/dashboard" className="text-teal-600 font-medium">dashboard</Link>.
          </div>
        ) : (
          <div className="space-y-4">
            {dispatches.map(d => {
              const stepIndex = STEPS.indexOf(d.status)
              const next = stepIndex >= 0 && stepIndex < STEPS.length - 1 ? STEPS[stepIndex + 1] : null
              const active = ['pending', 'en_route', 'on_scene'].includes(d.status)
              return (
                <div key={d.id} className="bg-white rounded-lg shadow p-5" data-testid="dispatch-card">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="text-lg font-semibold text-gray-900">
                        {d.rescue_teams?.team_name ?? 'Unknown team'} → {d.emergency_reports?.location_address ?? 'Unknown case'}
                      </div>
                      <div className="text-sm text-gray-600">
                        Priority {d.emergency_reports?.priority_score ?? '—'} · {d.emergency_reports?.people_count ?? '?'} people
                        {d.emergency_reports?.immediate_danger ? ' · immediate danger' : ''}
                        {d.distance_km != null ? ` · ${d.distance_km} km` : ''}
                        {d.match_score != null ? ` · match ${d.match_score}/100` : ''}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        Assigned {new Date(d.assigned_at).toLocaleString()}
                        {d.rescue_teams?.team_leader ? ` · Leader: ${d.rescue_teams.team_leader}` : ''}
                        {d.rescue_teams?.contact_number ? ` (${d.rescue_teams.contact_number})` : ''}
                        {d.completed_at ? ` · Closed ${new Date(d.completed_at).toLocaleString()}` : ''}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {next && (
                        <button
                          disabled={updating === d.id}
                          onClick={() => updateStatus(d.id, next)}
                          className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 disabled:opacity-50"
                        >
                          Mark {STEP_LABELS[next].toLowerCase()}
                        </button>
                      )}
                      {active && (
                        <button
                          disabled={updating === d.id}
                          onClick={() => updateStatus(d.id, 'cancelled')}
                          className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Progress tracker */}
                  <div className="flex items-center mt-4">
                    {d.status === 'cancelled' ? (
                      <span className="px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700">Cancelled</span>
                    ) : (
                      STEPS.map((step, i) => (
                        <div key={step} className="flex items-center flex-1 last:flex-none">
                          <div className="flex flex-col items-center">
                            <div className={`w-4 h-4 rounded-full ${i <= stepIndex ? 'bg-teal-600' : 'bg-gray-200'}`} />
                            <span className={`text-xs mt-1 ${i <= stepIndex ? 'text-teal-700 font-medium' : 'text-gray-400'}`}>
                              {STEP_LABELS[step]}
                            </span>
                          </div>
                          {i < STEPS.length - 1 && (
                            <div className={`h-0.5 flex-1 mx-2 mb-4 ${i < stepIndex ? 'bg-teal-600' : 'bg-gray-200'}`} />
                          )}
                        </div>
                      ))
                    )}
                  </div>

                  {(d.dispatch_resources.length > 0 || d.notes || d.match_explanation?.warnings?.length) && (
                    <div className="mt-3 pt-3 border-t text-sm text-gray-700 space-y-1">
                      {d.dispatch_resources.length > 0 && (
                        <div>
                          <span className="font-medium">Resources:</span>{' '}
                          {d.dispatch_resources
                            .map(r => `${resourceTypeLabel(r.resources?.resource_type ?? '')}${r.resources?.name ? ` (${r.resources.name})` : ''} ×${r.quantity}`)
                            .join(', ')}
                        </div>
                      )}
                      {d.notes && <div><span className="font-medium">Notes:</span> {d.notes}</div>}
                      {d.match_explanation?.warnings?.length ? (
                        <div className="text-orange-700">⚠ {d.match_explanation.warnings.join(' · ')}</div>
                      ) : null}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
    </div>
  )
}
