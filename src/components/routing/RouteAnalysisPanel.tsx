'use client'

// Route comparison panel for the responder map. Decision support only: it never says "safe", it shows
// where each fact came from and how old it is, and a human approves or rejects every route.
import { useEffect, useMemo, useState } from 'react'
import type { RouteFloodResult } from '@/lib/flood/integration'
import Icon from '../ui/Icon'
import { ageLine, formatAge, KIND_LABEL, km, mins, PROXIMITY_LABEL, SEVERITY_LABEL, STATUS_STYLE, VERIFY_LABEL } from './labels'
import { RouteApiError, routeApi } from '@/lib/routingClient'
import { VEHICLE_TYPES, type AnalysisResult, type CandidateRoute, type LatLng, type VehicleType } from '@/lib/routing/types'
import type { SessionUser } from '@/lib/demoAccounts'
import type { RescueTeam, TriagedReport } from '@/lib/types'

const VEHICLE_LABEL: Record<VehicleType, string> = { car: 'Car', ambulance: 'Ambulance', rescue_truck: 'Rescue truck', fire_truck: 'Fire truck' }
const STALE_ANALYSIS_MIN = 15

type Pick = 'origin' | 'destination' | null
type Recorded = { decision: 'approved' | 'rejected'; by: string; at: string }

const fmt = (p: LatLng | null) => (p ? `${p[0].toFixed(5)}, ${p[1].toFixed(5)}` : 'Not set')

function Pill({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-bold ${className}`}>{children}</span>
}

function CandidateCard({
  c, selected, onSelect, analysis, now, recorded, onRecorded, user,
}: {
  c: CandidateRoute; selected: boolean; onSelect: () => void; analysis: AnalysisResult; now: number
  recorded: Recorded | undefined; onRecorded: (r: Recorded) => void; user: SessionUser | null
}) {
  const [note, setNote] = useState('')
  const [ack, setAck] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const style = STATUS_STYLE[c.status]
  const stale = (now - Date.parse(analysis.analyzedAt)) / 60000 > STALE_ANALYSIS_MIN
  const blocking = c.limitations.filter((l) => l.blocksCandidate)
  const info = c.limitations.filter((l) => !l.blocksCandidate)
  const needsReason = c.status !== 'no_hazards_found'

  const decide = async (decision: 'approved' | 'rejected') => {
    if (!analysis.analysisId) return
    setBusy(true)
    setError(null)
    try {
      const res = await routeApi.decide({ analysisId: analysis.analysisId, candidateId: c.id, decision, note: note || undefined, acknowledgedLimitations: ack })
      onRecorded({ decision, by: res.decision.decidedByName, at: res.decision.decidedAt })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className={`rounded-2xl border-2 p-3.5 ${selected ? 'border-ink-900 bg-white' : 'border-sand-300 bg-sand-50'}`} aria-label={`Route ${c.rank}`}>
      <button type="button" onClick={onSelect} className="block w-full text-left" aria-pressed={selected}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-display text-lg font-semibold">Route {c.rank}</span>
          <Pill className={style.cls}>
            <Icon name={style.icon} size={14} /> {c.statusLabel}
          </Pill>
          {c.recommendation === 'candidate_for_dispatcher_review' && (
            <Pill className="border-ink-900 bg-ink-900 text-white"><Icon name="shield" size={14} /> Candidate for dispatcher review</Pill>
          )}
          {c.recalculated && <Pill className="border-ink-600 bg-white text-ink-800"><Icon name="refresh" size={13} /> Recalculated by provider</Pill>}
        </div>
        <p className="mt-1 text-sm font-semibold text-ink-700">
          {km(c.distanceM)} · {mins(c.durationS)} <span className="font-normal text-ink-500">(from {analysis.provider.name})</span>
        </p>
      </button>

      {c.ai && (
        <div className="mt-2 rounded-xl bg-ink-50 p-2.5 text-sm">
          <p className="text-xs font-bold uppercase tracking-wide text-ink-600">AI summary - advisory only</p>
          <p>{c.ai.summary}</p>
          {c.ai.whyUnsuitable && <p className="mt-1"><strong>Concern:</strong> {c.ai.whyUnsuitable}</p>}
        </div>
      )}

      {selected && (
        <div className="mt-3 space-y-3 text-sm">
          <section aria-label="Why this ranking">
            <h4 className="font-bold">Why it is ranked #{c.rank}</h4>
            <ul className="ml-4 list-disc">{c.rankReasons.map((r) => <li key={r}>{r}</li>)}</ul>
          </section>

          <section aria-label="Hazards">
            <h4 className="font-bold">Hazards matched to this route ({c.findings.length})</h4>
            {c.findings.length === 0 ? (
              <p className="text-ink-700">None matched in the available data. This does not establish that the road is clear.</p>
            ) : (
              <ul className="space-y-2">
                {c.findings.map((f) => (
                  <li key={f.hazardId} className={`rounded-xl border p-2 ${f.state === 'inactive' ? 'border-sand-300 opacity-75' : 'border-ink-300 bg-white'}`}>
                    <p className="font-semibold">
                      {KIND_LABEL[f.kind]} <span className="font-normal">· {SEVERITY_LABEL[f.severity]}</span>
                    </p>
                    <p className="flex flex-wrap gap-1.5 py-0.5">
                      <Pill className={f.verification === 'confirmed' ? 'border-ink-900 bg-ink-900 text-white' : 'border-ink-700 border-dashed bg-white text-ink-900'}>
                        {f.verification === 'confirmed' ? <Icon name="check" size={13} /> : <Icon name="info" size={13} />} {VERIFY_LABEL[f.verification]}
                      </Pill>
                      <Pill className="border-ink-300 bg-white text-ink-800">{PROXIMITY_LABEL[f.proximity]} · {f.distanceM} m</Pill>
                      {f.blocksRoad === true && <Pill className="border-critical-700 bg-critical-100 text-critical-700"><Icon name="alert" size={13} /> Records a closure</Pill>}
                      {f.blocksRoad === null && f.state === 'active' && <Pill className="border-ink-300 bg-white text-ink-700">Effect on the road unknown</Pill>}
                    </p>
                    <p>{f.description}</p>
                    <p className="text-xs text-ink-600">Source: {f.source}. {ageLine(f)}.</p>
                    {f.state === 'inactive' && <p className="text-xs font-semibold text-ink-700">Not counted as current. A resolved or expired record is not proof the road is clear; re-verify.</p>}
                    {f.duplicateOf && <p className="text-xs text-ink-600">Probable duplicate of another record; counted once.</p>}
                    {f.duplicateIds.length > 0 && <p className="text-xs text-ink-600">{f.duplicateIds.length} probable duplicate record(s) folded into this one.</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {blocking.length > 0 && (
            <section aria-label="Missing or stale data" className="rounded-xl border-2 border-warning-700 bg-warning-100 p-2.5">
              <h4 className="flex items-center gap-1.5 font-bold text-warning-700"><Icon name="alert" size={16} /> Missing, stale or incomplete data</h4>
              <ul className="ml-4 list-disc">{blocking.map((l) => <li key={l.code}>{l.message}</li>)}</ul>
            </section>
          )}
          <section aria-label="Other limitations">
            <h4 className="font-bold">Also unknown</h4>
            <ul className="ml-4 list-disc text-ink-700">{info.map((l) => <li key={l.code}>{l.message}</li>)}</ul>
          </section>

          {c.ai && (c.ai.uncertainties.length > 0 || c.ai.verifyBeforeApproval.length > 0) && (
            <section aria-label="AI suggestions" className="rounded-xl bg-ink-50 p-2.5">
              <p className="text-xs font-bold uppercase tracking-wide text-ink-600">AI suggestions - advisory only</p>
              {c.ai.uncertainties.length > 0 && <><h4 className="mt-1 font-bold">Uncertainties</h4><ul className="ml-4 list-disc">{c.ai.uncertainties.map((u) => <li key={u}>{u}</li>)}</ul></>}
              {c.ai.verifyBeforeApproval.length > 0 && <><h4 className="mt-1 font-bold">Verify before approving</h4><ul className="ml-4 list-disc">{c.ai.verifyBeforeApproval.map((u) => <li key={u}>{u}</li>)}</ul></>}
            </section>
          )}

          <section aria-label="Dispatcher decision" className="border-t border-sand-300 pt-3">
            <h4 className="font-bold">Dispatcher decision</h4>
            {recorded ? (
              <p className="rounded-xl bg-ink-50 p-2.5 font-semibold" role="status">
                <Icon name="check" size={15} className="mr-1 inline" /> {recorded.decision === 'approved' ? 'Approved' : 'Rejected'} by {recorded.by} at {new Date(recorded.at).toLocaleTimeString([], { timeStyle: 'short' })}. Recorded in the audit log.
              </p>
            ) : !user ? (
              <p>Sign in to record a decision.</p>
            ) : (
              <>
                <label className="block text-xs font-bold" htmlFor={`note-${c.id}`}>
                  {needsReason ? 'Reason (required to approve this route)' : 'Note (optional)'}
                </label>
                <textarea id={`note-${c.id}`} className="input mt-1 min-h-[60px] w-full" maxLength={600} value={note} onChange={(e) => setNote(e.target.value)} placeholder={needsReason ? 'What did you check, and with whom?' : ''} />
                {c.status === 'known_blockage' && (
                  <label className="mt-1.5 flex items-start gap-2 text-sm font-semibold">
                    <input type="checkbox" className="mt-1 h-[18px] w-[18px] accent-ink-900" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                    I have checked this blockage with an authoritative source and accept responsibility for approving the route.
                  </label>
                )}
                {!analysis.analysisId && <p className="mt-1.5 text-sm font-semibold text-critical-700" role="alert">This analysis could not be saved to the audit log, so approval is disabled. Refresh the analysis.</p>}
                {stale && <p className="mt-1.5 text-sm font-semibold text-warning-700" role="alert">This analysis is over {STALE_ANALYSIS_MIN} minutes old. Refresh before approving.</p>}
                <div className="mt-2 flex flex-wrap gap-2">
                  <button className="btn-primary btn-sm" disabled={busy || !analysis.analysisId || stale || (needsReason && note.trim().length < 10) || (c.status === 'known_blockage' && !ack)} onClick={() => decide('approved')}>
                    <Icon name="check" size={16} /> Approve for dispatch
                  </button>
                  <button className="btn-ghost btn-sm" disabled={busy || !analysis.analysisId} onClick={() => decide('rejected')}>
                    <Icon name="close" size={16} /> Reject
                  </button>
                </div>
                {error && <p className="field-error mt-1.5" role="alert"><Icon name="alert" size={16} className="mt-0.5 shrink-0" /> {error}</p>}
              </>
            )}
          </section>
        </div>
      )}
    </article>
  )
}

export default function RouteAnalysisPanel({
  user, origin, destination, setOrigin, setDestination, picking, setPicking, result, setResult, selectedId, setSelectedId, teams, reports, onClose, floodEvidence,
}: {
  user: SessionUser | null
  origin: LatLng | null; destination: LatLng | null
  setOrigin: (p: LatLng | null) => void; setDestination: (p: LatLng | null) => void
  picking: Pick; setPicking: (p: Pick) => void
  result: AnalysisResult | null; setResult: (r: AnalysisResult | null) => void
  selectedId: string | null; setSelectedId: (id: string | null) => void
  /** Optional flood-estimate evidence per route. Supplementary only: it never changes status, rank or recommendation. */
  floodEvidence?: RouteFloodResult | null
  teams: RescueTeam[]; reports: TriagedReport[]; onClose: () => void
}) {
  const [vehicle, setVehicle] = useState<VehicleType>('ambulance')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ message: string; code: string } | null>(null)
  const [online, setOnline] = useState(true)
  const [now, setNow] = useState(() => Date.now())
  const [recorded, setRecorded] = useState<Record<string, Recorded>>({})
  const allowed = user?.role === 'responder' || user?.role === 'admin'

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine)
    sync()
    window.addEventListener('online', sync)
    window.addEventListener('offline', sync)
    const t = setInterval(() => setNow(Date.now()), 30000)
    return () => {
      window.removeEventListener('online', sync)
      window.removeEventListener('offline', sync)
      clearInterval(t)
    }
  }, [])

  const openCases = useMemo(() => reports.filter((r) => r.status !== 'resolved' && r.status !== 'cancelled').slice(0, 40), [reports])

  const analyze = async () => {
    if (!origin || !destination) return
    setBusy(true)
    setError(null)
    setRecorded({})
    try {
      const res = await routeApi.analyze(origin, destination, vehicle)
      setResult(res)
      setSelectedId(res.candidates[0]?.id ?? null)
    } catch (err) {
      // Keep any previous result on screen? No: it may be stale and must not look current.
      setResult(null)
      setSelectedId(null)
      const e = err as RouteApiError
      setError({ message: e.message, code: e.code })
    } finally {
      setBusy(false)
    }
  }

  const ageMin = result ? Math.round((now - Date.parse(result.analyzedAt)) / 60000) : 0

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2">
        <h2 className="font-display text-xl font-semibold">Route analysis</h2>
        <button type="button" className="btn-ghost btn-sm ml-auto -mt-1" onClick={onClose} aria-label="Close route analysis"><Icon name="close" size={16} /></button>
      </div>
      <p className="rounded-xl bg-warning-100 p-2.5 text-sm font-semibold text-warning-700">
        <Icon name="alert" size={15} className="mr-1 inline" />
        If someone is in immediate danger, contact emergency services now. Do not wait for this analysis.
      </p>

      {!allowed ? (
        <p className="rounded-xl bg-sand-200 p-3 text-sm font-semibold">Route analysis is for signed-in responders and administrators, because it uses incident details.</p>
      ) : (
        <>
          <fieldset className="space-y-2">
            <legend className="sr-only">Route endpoints</legend>
            {(['origin', 'destination'] as const).map((which) => {
              const value = which === 'origin' ? origin : destination
              const set = which === 'origin' ? setOrigin : setDestination
              const label = which === 'origin' ? 'Start (A)' : 'Destination (B)'
              return (
                <div key={which} className="rounded-xl border border-sand-300 bg-white p-2">
                  <p className="text-xs font-bold text-ink-600">{label}</p>
                  <p className="text-sm font-semibold" data-testid={`${which}-value`}>{fmt(value)}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <button type="button" className={`btn-sm ${picking === which ? 'btn-primary' : 'btn-ghost'}`} aria-pressed={picking === which} onClick={() => setPicking(picking === which ? null : which)}>
                      <Icon name="pin" size={15} /> {picking === which ? 'Click the map...' : 'Pick on map'}
                    </button>
                    {value && <button type="button" className="btn-ghost btn-sm" onClick={() => set(null)}>Clear</button>}
                  </div>
                  <label className="mt-1.5 block text-xs font-bold" htmlFor={`quick-${which}`}>{which === 'origin' ? 'Or use a rescue team' : 'Or use an open case'}</label>
                  <select
                    id={`quick-${which}`}
                    className="input mt-0.5 w-full"
                    value=""
                    onChange={(e) => {
                      const v = e.target.value
                      if (!v) return
                      if (which === 'origin') {
                        const t = teams.find((x) => x.id === v)
                        if (t) set([t.current_location_lat, t.current_location_lng])
                      } else {
                        const r = openCases.find((x) => x.id === v)
                        if (r && r.location_lat != null && r.location_lng != null) set([r.location_lat, r.location_lng]) // landmark-only reports have no coordinates
                      }
                    }}
                  >
                    <option value="">Choose...</option>
                    {which === 'origin'
                      ? teams.map((t) => <option key={t.id} value={t.id}>{t.team_name} ({t.status})</option>)
                      : openCases.map((r) => <option key={r.id} value={r.id}>#{r.id.replace(/-/g, '').slice(-6).toUpperCase()} · {r.area} · {r.priority}</option>)}
                  </select>
                </div>
              )
            })}
            <div>
              <label className="text-xs font-bold" htmlFor="vehicle">Vehicle</label>
              <select id="vehicle" className="input mt-0.5 w-full" value={vehicle} onChange={(e) => setVehicle(e.target.value as VehicleType)}>
                {VEHICLE_TYPES.map((v) => <option key={v} value={v}>{VEHICLE_LABEL[v]}</option>)}
              </select>
              <p className="mt-0.5 text-xs text-ink-600">Boats and aircraft are not supported: this analysis covers road routes only. Vehicle-specific road limits are not evaluated.</p>
            </div>
          </fieldset>

          <button className="btn-primary w-full" disabled={!origin || !destination || busy || !online} onClick={analyze}>
            <Icon name={result ? 'refresh' : 'route'} size={18} /> {busy ? 'Analysing...' : result ? 'Refresh analysis' : 'Analyse routes'}
          </button>
          {!online && <p className="text-sm font-semibold text-critical-700" role="alert">You are offline. Route analysis needs a connection. Emergency reporting still works offline.</p>}

          {error && (
            <div className="rounded-xl border-2 border-critical-700 bg-critical-100 p-3 text-sm" role="alert">
              <p className="font-bold text-critical-700">{error.code === 'routing_unavailable' ? 'Route analysis is unavailable' : 'Could not analyse routes'}</p>
              <p>{error.message}</p>
              {error.code === 'routing_unavailable' && <p className="mt-1">No routes or travel times are shown because none could be calculated. Use your standard dispatch procedure.</p>}
            </div>
          )}

          {result && (
            <>
              <div className="space-y-1 rounded-xl bg-sand-100 p-2.5 text-xs text-ink-700" role="status">
                <p className="font-bold">
                  Analysed {ageMin < 1 ? 'just now' : `${ageMin} min ago`} · {result.dataFreshness.recordsConsidered} hazard records · newest {result.dataFreshness.newestRecordAt ? formatAge(Math.round((now - Date.parse(result.dataFreshness.newestRecordAt)) / 60000)) : 'time unknown'}
                </p>
                <ul>
                  {result.dataFreshness.sources.map((s) => (
                    <li key={s.table}>{s.ok ? '✓' : '✗'} {s.name}: {s.ok ? `${s.count} records` : 'UNAVAILABLE'}</li>
                  ))}
                </ul>
                {result.dataFreshness.skippedRecords > 0 && <p className="font-semibold">{result.dataFreshness.skippedRecords} record(s) have no usable location and were not checked.</p>}
                <p>AI explanations: {result.ai.state === 'ok' ? 'on (advisory only)' : result.ai.state === 'not_configured' ? 'not configured' : result.ai.state === 'skipped' ? 'off' : 'unavailable, results above are unaffected'}</p>
              </div>
              {result.notices.map((n) => <p key={n} className="rounded-xl bg-warning-100 p-2.5 text-sm font-semibold text-warning-700"><Icon name="info" size={15} className="mr-1 inline" />{n}</p>)}
              {result.recalculation.attempted && <p className="text-xs text-ink-600">{result.recalculation.note}</p>}

              {result.candidates.length === 0 ? (
                <p className="rounded-xl bg-sand-200 p-3 text-sm font-semibold">No route was found between these points.</p>
              ) : (
                <div className="space-y-2.5">
                  {result.candidates.map((c) => (
                    <div key={c.id} className="space-y-1">
                      <CandidateCard c={c} analysis={result} now={now} user={user} selected={c.id === selectedId} onSelect={() => setSelectedId(c.id)} recorded={recorded[c.id]} onRecorded={(r) => setRecorded((m) => ({ ...m, [c.id]: r }))} />
                      {floodEvidence && <FloodRouteNote ev={floodEvidence} routeId={c.id} />}
                    </div>
                  ))}
                </div>
              )}
              <p className="text-xs text-ink-600">{result.disclaimer}</p>
            </>
          )}
        </>
      )}
    </div>
  )
}


// What a saved flood ESTIMATE says about one route. Supplementary evidence only; it is not part of the route status or ranking.
function FloodRouteNote({ ev, routeId }: { ev: RouteFloodResult; routeId: string }) {
  const r = ev.routes.find((x) => x.routeId === routeId)
  if (!r) return null
  const text =
    r.intersectsEstimatedExtent === 'unknown'
      ? 'Flood estimate: this route is outside the area that scenario assessed, so nothing is known.'
      : r.intersectsEstimatedExtent === 'yes'
        ? `Flood estimate: about ${Math.round(r.floodedLengthM)} m of this route lies inside the estimated extent${r.maxDepthM != null ? `, up to ${r.maxDepthM} m (estimate)` : ''}.`
        : 'Flood estimate: no part of the assessed section of this route lies inside the estimated extent.'
  return (
    <p className="rounded-xl border border-dashed border-critical-700 bg-critical-100 p-2 text-xs text-critical-700">
      <strong>ESTIMATE, supplementary.</strong> {text} Scenario: {ev.scenarioName} ({ev.tier}). {r.note}
      {r.assessedLengthM < r.lengthM && <> Only {Math.round(r.assessedLengthM)} of {Math.round(r.lengthM)} m was assessed.</>} This does not change the route&apos;s status or rank.
    </p>
  )
}
