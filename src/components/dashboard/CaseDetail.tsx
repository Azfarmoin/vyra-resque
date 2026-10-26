'use client'

<<<<<<< HEAD
import CasePhotos from './CasePhotos'
import SatelliteFindings from '../satellite/SatelliteFindings'
import CasePhotoAnalysis from './CasePhotoAnalysis'
=======
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
import { useState } from 'react'
import Link from 'next/link'
import TriageExplanation from './TriageExplanation'
import OverrideForm from './OverrideForm'
import { PriorityBadge, StatusBadge, VerifiedBadge } from '../common/Badges'
<<<<<<< HEAD
import Icon from '../ui/Icon'
import { SafetyLink } from '../safety/SafetyUi'
import { guidesForDangers } from '@/lib/safety'
=======
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
import { DANGERS, EVACUATION_ABILITY, INJURY_SEVERITIES, MEDICAL_NEEDS, STATUSES, VULNERABILITIES, type Status } from '@/lib/constants'
import { api, formatTime, formatWait, labelList, shortId, type ReportDetail } from '@/lib/client'

const NEXT_STATUS: Record<Status, Status[]> = {
  pending: ['investigating', 'assigned', 'cancelled'],
  investigating: ['assigned', 'resolved', 'cancelled'],
  assigned: ['resolved', 'investigating'],
  resolved: ['investigating'],
  cancelled: ['pending'],
}

const HISTORY_LABEL: Record<string, string> = {
  created: 'Report received',
  status: 'Status changed',
  verify: 'Verification changed',
  override: 'Priority overridden',
  override_cleared: 'Override removed',
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  if (children == null || children === '' || children === false) return null
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-2 py-1 text-sm">
<<<<<<< HEAD
      <dt className="font-semibold text-ink-600">{label}</dt>
=======
      <dt className="text-gray-500">{label}</dt>
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
      <dd>{children}</dd>
    </div>
  )
}

const Unknown = ({ children }: { children: React.ReactNode }) => <em className="text-amber-700">{children}</em>

<<<<<<< HEAD
export default function CaseDetail({ report: r, actor, onChange, onAssign }: { report: ReportDetail; actor: string; onChange: (r: ReportDetail) => void; onAssign?: () => void }) {
=======
export default function CaseDetail({ report: r, actor, onChange }: { report: ReportDetail; actor: string; onChange: (r: ReportDetail) => void }) {
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const act = async (fn: () => Promise<{ report: ReportDetail }>) => {
    setBusy(true)
    setError(null)
    try {
      onChange((await fn()).report)
      setNote('')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
<<<<<<< HEAD
  const closed = r.status === 'resolved' || r.status === 'cancelled'

  return (
    <div className="space-y-4">
      {/* Briefing header + quick actions stay in view while the details scroll */}
      <div className="clay sticky top-0 z-10 p-4 sm:p-5" style={{ borderRadius: 24 }}>
=======

  return (
    <div className="space-y-4">
      <div className="card p-4">
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
        <div className="flex flex-wrap items-center gap-2">
          <PriorityBadge priority={r.priority} />
          <StatusBadge status={r.status} />
          <VerifiedBadge verified={r.verified} />
<<<<<<< HEAD
          <span className="ml-auto text-sm font-bold text-ink-500">#{shortId(r.id)}</span>
        </div>
        <h2 className="mt-2 text-2xl font-semibold sm:text-3xl">
          {r.area} {r.location_address && <span className="text-base font-medium text-ink-600 sm:text-lg">{r.location_address}</span>}
        </h2>
        {r.ingest_channel && r.ingest_channel !== 'internet' && (
          <p className="mt-1 flex items-start gap-1.5 rounded-xl bg-warning-100 px-3 py-2 text-sm font-bold text-ink-900" role="note">
            <Icon name="radio" size={16} className="mt-0.5 shrink-0" />
            {r.partial
              ? `Short message only, received by ${r.ingest_channel}. Details and photos are still pending. Everything shown here is as sent and unverified.`
              : `First received by ${r.ingest_channel} as a short message; the full report arrived later.`}
          </p>
        )}
        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-semibold text-ink-600">
          <span>Received {formatTime(r.created_at)}</span>
          <span className="inline-flex items-center gap-1"><Icon name="clock" size={15} /> waiting {formatWait(r.triage.waitingMinutes)}</span>
          <Link className="inline-flex items-center gap-1 underline decoration-2 underline-offset-2" href="/map"><Icon name="map" size={15} /> View on map</Link>
          <Link className="inline-flex items-center gap-1 underline decoration-2 underline-offset-2" href={`/map?dest=${r.location_lat},${r.location_lng}`}><Icon name="route" size={15} /> Analyse routes here</Link>
          {r.location_lat != null && r.location_lng != null && (
            <Link className="inline-flex items-center gap-1 underline decoration-2 underline-offset-2" href={`/shelters?tab=find&incident=${r.id}&lat=${r.location_lat}&lng=${r.location_lng}${r.people_count != null ? `&people=${r.people_count}` : ''}`}><Icon name="home" size={15} /> Find a shelter</Link>
          )}
        </p>
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Quick actions">
          {onAssign && (
            <button className="btn-primary btn-sm" disabled={busy || closed} onClick={onAssign}>
              <Icon name="boat" size={17} /> Assign rescue team
            </button>
          )}
          {NEXT_STATUS[r.status].map((s) => (
            <button key={s} className="btn-ghost btn-sm" disabled={busy} onClick={() => act(() => api.updateStatus(r.id, { status: s, note, by: actor }))}>
              Mark {STATUSES[s].toLowerCase()}
            </button>
          ))}
          <button className="btn-ghost btn-sm" disabled={busy} onClick={() => act(() => api.setVerified(r.id, { verified: !r.verified, by: actor }))}>
            <Icon name="shield" size={16} /> {r.verified ? 'Mark unverified' : 'Mark verified'}
          </button>
        </div>
        {error && <p className="field-error" role="alert"><Icon name="alert" size={16} className="mt-0.5 shrink-0" /> {error}</p>}
      </div>

      <section className="clay p-5">
        <h3 className="mb-3 text-xl font-semibold">Why this priority?</h3>
        <TriageExplanation report={r} />
      </section>

      <section className="clay p-5">
        <h3 className="mb-2 text-xl font-semibold">Reported details</h3>
        <dl>
          <Row label="People">{r.people_count ?? <Unknown>unknown</Unknown>}</Row>
          <Row label="Dangers">{r.dangers.length ? labelList(r.dangers, DANGERS) : <Unknown>not reported</Unknown>}</Row>
          {guidesForDangers(r.dangers).length > 0 && (
            <Row label="Advice to relay"><span className="flex flex-wrap gap-2">{guidesForDangers(r.dangers).map((h) => <SafetyLink key={h} hazard={h} phase="waiting" label="Waiting-for-rescue advice" note={undefined} />)}</span></Row>
          )}
=======
          <span className="ml-auto text-xs text-gray-500">#{shortId(r.id)}</span>
        </div>
        <h2 className="mt-2 text-lg font-semibold">
          {r.area} {r.location_address && <span className="font-normal text-gray-600">· {r.location_address}</span>}
        </h2>
        <p className="text-sm text-gray-500">
          Received {formatTime(r.created_at)} · waiting {formatWait(r.triage.waitingMinutes)} ·{' '}
          <Link className="text-primary-700 underline" href="/map">view on map</Link>
        </p>
      </div>

      <div className="card p-4">
        <h3 className="mb-3 font-semibold">Why this priority?</h3>
        <TriageExplanation report={r} />
      </div>

      <div className="card p-4">
        <h3 className="mb-2 font-semibold">Reported details</h3>
        <dl>
          <Row label="People">{r.people_count ?? <Unknown>unknown</Unknown>}</Row>
          <Row label="Dangers">{r.dangers.length ? labelList(r.dangers, DANGERS) : <Unknown>not reported</Unknown>}</Row>
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
          <Row label="Description">{r.danger_details}</Row>
          <Row label="Injuries">
            {INJURY_SEVERITIES[r.injury_severity]}
            {r.injury_count ? ` · ${r.injury_count} injured` : ''}
            {r.injury_details ? ` · ${r.injury_details}` : ''}
          </Row>
          <Row label="Medical needs">{labelList(r.medical_need_types, MEDICAL_NEEDS)}</Row>
          <Row label="Medical details">{r.medical_needs}</Row>
          <Row label="Evacuation">{EVACUATION_ABILITY[r.can_evacuate]}</Row>
          <Row label="Vulnerable">{labelList(r.vulnerabilities, VULNERABILITIES)}</Row>
          <Row label="Location">
<<<<<<< HEAD
            {r.location_lat == null || r.location_lng == null ? (
              <span className="font-semibold text-warning-700">No coordinates. Typed description only (unverified): {r.location_address || r.area || 'none'}</span>
            ) : (
              <>
                {r.location_lat.toFixed(5)}, {r.location_lng.toFixed(5)} (
                {r.location_source === 'gps' ? `GPS${r.location_accuracy_m ? `, about ${r.location_accuracy_m} m` : ''}` : 'selected on map or typed'})
              </>
            )}
          </Row>
          <Row label="Contact">{r.contact_info || <span className="text-ink-500">none given</span>}</Row>
        </dl>
        <CasePhotos reportId={r.id} />
        <CasePhotoAnalysis reportId={r.id} priority={r.priority} />
      </section>

      <section className="clay space-y-3 p-5">
        <h3 className="text-xl font-semibold">Add a note or change the priority</h3>
        <div>
          <label className="label" htmlFor="case-note">Note for the history (optional)</label>
          <input id="case-note" className="input" placeholder="Saved with the next status or verification change" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        </div>
        <div className="border-t border-sand-200 pt-3">
          <p className="label">Change priority</p>
          <OverrideForm key={r.id + r.updated_at} report={r} actor={actor} onSaved={onChange} />
        </div>
      </section>

      <SatelliteFindings targetType="report" targetId={r.id} lat={r.location_lat} lng={r.location_lng} />

      <section className="clay p-5">
        <h3 className="mb-3 text-xl font-semibold">History</h3>
        <ol className="relative space-y-4 border-l-2 border-sand-300 pl-5">
          {[...r.history].reverse().map((h) => (
            <li key={h.id} className="relative text-[15px]">
              <span className="absolute -left-[27px] top-1.5 h-3 w-3 rounded-full border-2 border-sand-100 bg-ink-800" aria-hidden="true" />
              <p>
                <strong>{HISTORY_LABEL[h.action] || h.action}</strong>
                {h.from_value != null && h.to_value != null && <span className="text-ink-700"> · {h.from_value} to {h.to_value}</span>}
              </p>
              {h.note && <p className="text-ink-700">{h.note}</p>}
              <p className="text-sm text-ink-600">{formatTime(h.created_at)} · {h.actor}</p>
            </li>
          ))}
        </ol>
      </section>
=======
            {r.location_lat.toFixed(5)}, {r.location_lng.toFixed(5)} (
            {r.location_source === 'gps' ? `GPS${r.location_accuracy_m ? ` ±${r.location_accuracy_m} m` : ''}` : 'selected on map'})
          </Row>
          <Row label="Contact">{r.contact_info || <span className="text-gray-400">none given</span>}</Row>
        </dl>
      </div>

      <div className="card space-y-3 p-4">
        <h3 className="font-semibold">Responder actions</h3>
        <input className="input" placeholder="Note for the history (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        <div className="flex flex-wrap gap-2">
          {NEXT_STATUS[r.status].map((s) => (
            <button key={s} className="btn-ghost" disabled={busy} onClick={() => act(() => api.updateStatus(r.id, { status: s, note, by: actor }))}>
              Mark {STATUSES[s].toLowerCase()}
            </button>
          ))}
          <button className="btn-ghost" disabled={busy} onClick={() => act(() => api.setVerified(r.id, { verified: !r.verified, by: actor }))}>
            {r.verified ? 'Mark unverified' : 'Mark verified'}
          </button>
        </div>
        {error && <p className="text-sm text-red-700">{error}</p>}
        <div className="border-t pt-3">
          <p className="label">Change priority</p>
          <OverrideForm key={r.id + r.updated_at} report={r} actor={actor} onSaved={onChange} />
        </div>
      </div>

      <div className="card p-4">
        <h3 className="mb-2 font-semibold">History</h3>
        <ol className="space-y-2 border-l-2 border-gray-200 pl-4">
          {[...r.history].reverse().map((h) => (
            <li key={h.id} className="text-sm">
              <p>
                <strong>{HISTORY_LABEL[h.action] || h.action}</strong>
                {h.from_value != null && h.to_value != null && (
                  <span className="text-gray-600"> · {h.from_value} → {h.to_value}</span>
                )}
              </p>
              {h.note && <p className="text-gray-600">{h.note}</p>}
              <p className="text-xs text-gray-400">
                {formatTime(h.created_at)} · {h.actor}
              </p>
            </li>
          ))}
        </ol>
      </div>
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
    </div>
  )
}
