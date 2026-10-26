'use client'

<<<<<<< HEAD
import { useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import ChoiceGroup from './ChoiceGroup'
import type { PickedLocation } from './LocationPicker'
import PhotoAttachments from '@/components/offline/PhotoAttachments'
import PhotoAnalysisPanel from '@/components/photo/PhotoAnalysisPanel'
import type { Applied } from '@/lib/photoAnalysis/client'
import { SafetyLink } from '@/components/safety/SafetyUi'
import { guidesForDangers } from '@/lib/safety'
import { AREAS, DANGERS, EVACUATION_ABILITY, INJURY_SEVERITIES, MEDICAL_NEEDS, REPORTER_URGENCY, VULNERABILITIES } from '@/lib/constants'
import { labelList } from '@/lib/client'
import { PRIORITY_LABELS } from '@/lib/constants'
import { hasLifeThreat, triageReport } from '@/lib/triage'
import Icon from '@/components/ui/Icon'
import { getIdentity } from '@/lib/offline/identity'
import { beginEdit, deleteLocalReport, generateId, listAttachments, loadActiveDraft, queueReport, saveDraft, getReport } from '@/lib/offline/store'
import { deliverReport } from '@/lib/delivery/orchestrator'
import { LocalSaveError, ANON, type LocalReport } from '@/lib/offline/types'

const LocationPicker = dynamic(() => import('./LocationPicker'), {
  ssr: false,
  loading: () => <div className="clay-inset h-64 animate-pulse" />,
})

=======
import { useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import ChoiceGroup from './ChoiceGroup'
import type { PickedLocation } from './LocationPicker'
import { AREAS, DANGERS, EVACUATION_ABILITY, INJURY_SEVERITIES, MEDICAL_NEEDS, VULNERABILITIES } from '@/lib/constants'
import { api, ApiError, type PublicReport } from '@/lib/client'

const LocationPicker = dynamic(() => import('./LocationPicker'), {
  ssr: false,
  loading: () => <div className="h-64 animate-pulse rounded-lg bg-gray-100" />,
})

const newClientId = () =>
  globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`

>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
const EMPTY = {
  location: null as PickedLocation | null,
  locationAddress: '',
  area: '',
  peopleCount: '',
  dangers: [] as string[],
  dangerDetails: '',
<<<<<<< HEAD
  incidentTime: '', // datetime-local string in the reporter's own clock; empty = "now" when sent
  urgency: '', // reporter's own view: low | medium | high | critical (unverified)
=======
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
  injurySeverity: '',
  injuryCount: '',
  injuryDetails: '',
  medicalNeedTypes: [] as string[],
  medicalNeeds: '',
  canEvacuate: '',
  vulnerabilities: [] as string[],
  contactName: '',
  contactPhone: '',
}
type FormState = typeof EMPTY

<<<<<<< HEAD
// Local time as "YYYY-MM-DDTHH:mm" for <input type="datetime-local">.
const localInputValue = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
const toIsoOrNull = (local: string) => {
  const t = local ? new Date(local) : null
  return t && !Number.isNaN(t.getTime()) ? t.toISOString() : null
}

=======
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
// Unanswered questions are sent as "unknown" (never "no"), so the triage engine
// does not mistake missing information for low risk.
export function toPayload(f: FormState, clientId: string, reporterId: string | null) {
  const num = (v: string) => (v.trim() === '' ? null : Number(v))
  return {
    client_id: clientId,
    reporter_id: reporterId,
<<<<<<< HEAD
    // Coordinates are only sent when they really exist. A typed landmark alone is a valid report.
    location_lat: f.location?.lat ?? null,
    location_lng: f.location?.lng ?? null,
    location_source: f.location?.source ?? 'manual',
    location_accuracy_m: f.location?.accuracyM ?? null,
    location_captured_at: f.location?.capturedAt ?? null,
    location_address: f.locationAddress,
    area: f.area || null,
    incident_time: toIsoOrNull(f.incidentTime) ?? new Date().toISOString(),
    reporter_urgency: f.urgency || null,
=======
    location_lat: f.location!.lat,
    location_lng: f.location!.lng,
    location_source: f.location!.source,
    location_accuracy_m: f.location!.accuracyM ?? null,
    location_address: f.locationAddress,
    area: f.area || null,
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
    people_count: num(f.peopleCount),
    dangers: f.dangers,
    danger_details: f.dangerDetails,
    injury_severity: f.injurySeverity || 'unknown',
    injury_count: num(f.injuryCount),
    injury_details: f.injuryDetails,
    medical_need_types: f.medicalNeedTypes,
    medical_needs: f.medicalNeeds,
    can_evacuate: f.canEvacuate || 'unknown',
    vulnerabilities: f.vulnerabilities,
    contact_name: f.contactName,
    contact_phone: f.contactPhone,
  }
}

<<<<<<< HEAD
export const hasLocation = (f: Pick<FormState, 'location' | 'locationAddress' | 'area'>) => !!f.location || !!f.locationAddress.trim() || !!f.area

const STEPS = [
  { key: 'location', short: 'Location', title: 'Where is help needed?' },
  { key: 'situation', short: 'Situation', title: 'What is happening?' },
  { key: 'people', short: 'People', title: 'Who needs help?' },
  { key: 'medical', short: 'Medical', title: 'Any medical needs?' },
  { key: 'review', short: 'Review', title: 'Check and send' },
] as const

// Older versions kept the draft in localStorage. Move it into IndexedDB once, then delete it.
const LEGACY_DRAFT_KEY = 'vyra.reportDraft.v1'
function takeLegacyDraft(): { form: Partial<FormState>; step: number } | null {
  try {
    const raw = localStorage.getItem(LEGACY_DRAFT_KEY)
    if (!raw) return null
    localStorage.removeItem(LEGACY_DRAFT_KEY)
    const d = JSON.parse(raw) as { form?: Partial<FormState>; step?: number }
    return d?.form ? { form: d.form, step: d.step ?? 0 } : null
  } catch {
    return null
  }
}

// "Blank" ignores the pre-filled incident time so an untouched form never counts as a draft.
const isBlank = (f: FormState) => JSON.stringify({ ...f, incidentTime: '' }) === JSON.stringify(EMPTY)

function AiMark({ children, onConfirm }: { children: React.ReactNode; onConfirm: () => void }) {
  return (
    <p className="-mt-3 flex flex-wrap items-center gap-2 text-sm text-ink-700" role="note">
      <span className="rounded-full bg-sand-200 px-2 py-0.5 text-xs font-bold text-ink-700">AI suggestion</span>
      <span>{children}</span>
      <button type="button" className="btn-ghost btn-sm" onClick={onConfirm}>Confirm</button>
    </p>
  )
}

function PhotoCount({ clientId }: { clientId: string }) {
  const [n, setN] = useState(0)
  useEffect(() => {
    void listAttachments(clientId).then((a) => setN(a.length)).catch(() => undefined)
  }, [clientId])
  return n ? <p>{n} photo{n > 1 ? 's' : ''} attached (saved on this device, uploaded when sent)</p> : null
}

function Review({ title, onEdit, children }: { title: string; onEdit: () => void; children: React.ReactNode }) {
  return (
    <section className="clay-inset p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-display text-lg font-semibold">{title}</h3>
        <button type="button" onClick={onEdit} className="btn-ghost btn-sm">
          <Icon name="edit" size={15} /> Edit<span className="sr-only"> {title}</span>
        </button>
      </div>
      <div className="mt-2 space-y-1 text-[15px]">{children}</div>
    </section>
  )
}
const Unknown = ({ children = 'Not answered (counts as unknown, not safe)' }: { children?: React.ReactNode }) => <span className="font-semibold text-warning-700">{children}</span>

export default function ReportForm({ onQueued, onReceived }: { onQueued: (r: LocalReport) => void; onReceived: (serverId: string) => void }) {
  const [form, setForm] = useState<FormState>(EMPTY)
  const [step, setStep] = useState(0)
  const [reached, setReached] = useState(0) // furthest step opened, so the rail never lets people skip ahead
  const [clientId, setClientId] = useState(generateId) // same id on every retry -> no duplicate reports
  const [owner, setOwner] = useState(ANON)
  const [online, setOnline] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [locationError, setLocationError] = useState('')
  const [error, setError] = useState<{ message: string; details?: { path: string; message: string }[] } | null>(null)
  const [storageProblem, setStorageProblem] = useState('')
  const [hydrated, setHydrated] = useState(false)
  const [restored, setRestored] = useState(false)
  const [aiConsent, setAiConsent] = useState(false) // asked every time; never remembered
  const [aiMarks, setAiMarks] = useState<Applied['marks']>({ dangers: [], dangerDetails: false, urgency: false })
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const firstRender = useRef(true)
=======
function Section({ step, title, hint, children }: { step: number; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="card p-4 sm:p-5">
      <h2 className="flex items-baseline gap-2 text-base font-semibold">
        <span className="text-primary-600">{step}.</span> {title}
      </h2>
      {hint && <p className="mb-3 mt-0.5 text-sm text-gray-500">{hint}</p>}
      <div className={hint ? '' : 'mt-3'}>{children}</div>
    </section>
  )
}

async function currentUserId(): Promise<string | null> {
  try {
    const { supabase } = await import('@/lib/supabase')
    const { data } = await supabase.auth.getUser()
    return data.user?.id ?? null
  } catch {
    return null // anonymous reports are allowed
  }
}

export default function ReportForm({ onSubmitted }: { onSubmitted: (r: PublicReport) => void }) {
  const [form, setForm] = useState<FormState>(EMPTY)
  const [clientId] = useState(newClientId) // same id on every retry -> no duplicate reports
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<{ message: string; details?: { path: string; message: string }[] } | null>(null)
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895

  const set = <K extends keyof FormState>(field: K) => (value: FormState[K]) => setForm((f) => ({ ...f, [field]: value }))
  const setText = (field: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }))
  const injured = form.injurySeverity && !['none', 'unknown'].includes(form.injurySeverity)
<<<<<<< HEAD
  const last = STEPS.length - 1

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine)
    sync()
    window.addEventListener('online', sync)
    window.addEventListener('offline', sync)
    return () => {
      window.removeEventListener('online', sync)
      window.removeEventListener('offline', sync)
    }
  }, [])

  // Restore an unsent draft (or open a saved report for editing with ?edit=<id>) from IndexedDB.
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const id = await getIdentity()
        if (!alive) return
        setOwner(id.owner)
        const editId = new URLSearchParams(window.location.search).get('edit')
        let rec: LocalReport | null = null
        if (editId) {
          const r = await getReport(editId)
          if (r && r.owner === id.owner) rec = await beginEdit(editId) // pauses syncing while it is edited
        }
        if (!rec) rec = await loadActiveDraft(id.owner)
        if (!alive) return
        if (rec) {
          setForm({ ...EMPTY, ...(rec.form as Partial<FormState>) })
          const st = Math.min(Math.max(rec.step ?? 0, 0), last)
          setStep(st)
          setReached(editId ? last : st)
          setClientId(rec.client_id)
          setSavedAt(Date.parse(rec.updated_at))
          setRestored(true)
        } else {
          const legacy = takeLegacyDraft()
          if (legacy) {
            setForm({ ...EMPTY, ...legacy.form })
            setStep(Math.min(legacy.step, last))
            setRestored(true)
          } else setForm((f) => ({ ...f, incidentTime: localInputValue() }))
        }
      } catch {
        setStorageProblem('This browser cannot keep reports on the device (private browsing or blocked site data). You can still send while online, but an offline report could be lost.')
        setForm((f) => ({ ...f, incidentTime: localInputValue() }))
      }
      if (alive) setHydrated(true)
    })()
    return () => {
      alive = false
    }
  }, [last])

  // Keep the draft in IndexedDB as people type, and flush it when the page is hidden or closed.
  const latest = useRef({ form, step, clientId, owner })
  latest.current = { form, step, clientId, owner }
  const flush = async () => {
    const cur = latest.current
    if (isBlank(cur.form)) return
    try {
      await saveDraft({ client_id: cur.clientId, owner: cur.owner, form: cur.form as unknown as Record<string, unknown>, step: cur.step })
      setSavedAt(Date.now())
      setStorageProblem('')
    } catch (e) {
      setStorageProblem(e instanceof LocalSaveError ? e.message : 'Your draft could not be saved on this device.')
    }
  }
  useEffect(() => {
    if (!hydrated || isBlank(form)) return
    const t = setTimeout(() => void flush(), 500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, step, clientId, hydrated])
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flush()
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onHide)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Move focus to the new step's heading so keyboard and screen-reader users land in the right place.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    headingRef.current?.focus()
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [step])
=======
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895

  const unanswered = useMemo(() => {
    const list: string[] = []
    if (!form.dangers.length) list.push('danger')
    if (!form.injurySeverity) list.push('injuries')
    if (!form.peopleCount) list.push('number of people')
    if (!form.canEvacuate) list.push('evacuation')
    return list
  }, [form])

<<<<<<< HEAD
  // Rough on-device estimate using the same public rules as the server. Clearly labelled preliminary.
  const preliminary = useMemo(() => {
    try {
      const p = toPayload(form, 'preview', null)
      return triageReport({ ...p, immediate_danger: hasLifeThreat(form.dangers), created_at: new Date().toISOString() } as never).suggestedPriority
    } catch {
      return null
    }
  }, [form])

  const goTo = (n: number) => {
    setStep(n)
    setReached((r) => Math.max(r, n))
  }
  const next = () => {
    if (step === 0 && !hasLocation(form)) {
      setLocationError('Say where you are: use GPS, tap the map, type coordinates, or describe the place (landmark, address or area) below.')
      return
    }
    setLocationError('')
    goTo(Math.min(step + 1, last))
  }
  const startOver = async () => {
    try {
      await deleteLocalReport(clientId) // also removes its photos
    } catch {
      /* nothing stored yet */
    }
    setForm({ ...EMPTY, incidentTime: localInputValue() })
    setClientId(generateId())
    setStep(0)
    setReached(0)
    setRestored(false)
    setSavedAt(null)
    setError(null)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (step < last) return next()
    if (!hasLocation(form)) {
      setError({ message: 'Say where help is needed before sending. Go back to step 1.' })
      goTo(0)
=======
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.location) {
      setError({ message: 'Please share your location or tap the map to mark where help is needed.' })
      window.scrollTo({ top: 0, behavior: 'smooth' })
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
      return
    }
    setSubmitting(true)
    setError(null)
    try {
<<<<<<< HEAD
      const id = await getIdentity()
      // 1. Save on the device FIRST. Nothing below depends on the network.
      const rec = await queueReport({
        client_id: clientId,
        owner: id.owner,
        form: form as unknown as Record<string, unknown>,
        payload: toPayload(form, clientId, id.userId),
      })
      // 2. Start every available channel at once (radio, SMS hand-off, Bluetooth, internet). Wi-Fi is never required and
      //    navigator.onLine is not consulted: a channel that cannot work reports so immediately. A bounded wait lets a fast
      //    link finish before we move on; slower channels carry on in the background and are shown on the next screen.
      await Promise.race([deliverReport(clientId, { force: true }).catch(() => null), new Promise((r) => setTimeout(r, 10000))])
      const after = await getReport(clientId)
      if (after?.status === 'synced' && after.server_id) return onReceived(after.server_id)
      onQueued(after ?? rec)
    } catch (err) {
      setError({
        message:
          err instanceof LocalSaveError
            ? `${err.message} Your report was NOT saved. Do not rely on it.`
            : 'Your report could not be saved on this device, so it was NOT saved. Check storage permissions and try again.',
      })
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } finally {
              {guidesForDangers(form.dangers).length > 0 && (
                <div className="clay-inset space-y-2 p-3" aria-label="Safety guides for what you selected">
                  <p className="text-sm font-bold">While you fill this in: what to do for what you selected. These guides work without internet.</p>
                  <div className="flex flex-wrap gap-2">{guidesForDangers(form.dangers).map((h) => <SafetyLink key={h} hazard={h} />)}</div>
                </div>
              )}
=======
      const { report } = await api.createReport(toPayload(form, clientId, await currentUserId()))
      onSubmitted(report)
    } catch (err) {
      setError(
        err instanceof ApiError
          ? { message: err.message, details: err.details }
          : { message: 'Could not send the report. Check your connection and press Send again - your answers are kept.' }
      )
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } finally {
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
      setSubmitting(false)
    }
  }

<<<<<<< HEAD
  const current = STEPS[step]

  return (
    <form onSubmit={submit} noValidate className="grid gap-6 lg:grid-cols-[250px_minmax(0,1fr)] lg:gap-10">
      {/* Step rail (desktop) with the safety note */}
      <aside className="hidden lg:block">
        <div className="sticky top-28 space-y-5">
          <nav aria-label="Report steps">
            <ol className="space-y-1">
              {STEPS.map((s, i) => {
                const done = i < step || (i <= reached && i !== step && i < step)
                const canOpen = i <= reached
                return (
                  <li key={s.key}>
                    <button
                      type="button"
                      disabled={!canOpen}
                      onClick={() => goTo(i)}
                      aria-current={i === step ? 'step' : undefined}
                      className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left font-bold transition ${
                        i === step ? 'clay-sm' : canOpen ? 'hover:bg-sand-200/70' : 'opacity-60'
                      }`}
                    >
                      <span
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-extrabold ${
                          done ? 'bg-success-700 text-white' : i === step ? 'bg-ink-900 text-white' : 'bg-sand-200 text-ink-700'
                        }`}
                      >
                        {done ? <Icon name="check" size={16} /> : i + 1}
                      </span>
                      <span>
                        {s.short}
                        {done && <span className="sr-only"> (done)</span>}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ol>
          </nav>
          <div className="clay-inset space-y-3 p-4 text-sm text-ink-800">
            <p className="flex items-start gap-2 font-bold"><Icon name="phone" size={18} className="mt-0.5 shrink-0" /> If a life is in danger and phones work, also call Rescue 1122.</p>
            <p>Responders review reports in order of urgency. You will get a reference number to check your status.</p>
          </div>
        </div>
      </aside>

      <div className="min-w-0">
        {/* Progress (mobile) */}
        <div className="mb-4 lg:hidden">
          <p className="flex items-center justify-between text-sm font-bold">
            <span>Step {step + 1} of {STEPS.length}</span>
            <span className="text-ink-600">{current.short}</span>
          </p>
          <div className="clay-inset mt-2 h-3 overflow-hidden" style={{ borderRadius: 999 }} role="progressbar" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={step + 1} aria-label="Report progress">
            <div className="status-fill h-full rounded-full bg-primary-500" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
          </div>
        </div>

        {restored && (
          <div className="clay-sm mb-4 flex flex-wrap items-center justify-between gap-3 p-4" role="status">
            <p className="flex items-center gap-2 text-[15px] font-semibold"><Icon name="save" size={18} /> We restored a draft saved on this device.</p>
            <button type="button" onClick={() => void startOver()} className="btn-ghost btn-sm">Discard draft</button>
          </div>
        )}

        {!online && (
          <div className="clay-sm mb-4 flex items-start gap-2 p-4 text-[15px] font-semibold" role="status">
            <Icon name="offline" size={18} className="mt-0.5 shrink-0" /> No internet right now. You can still send this report: it is saved on this device first, then VYRA tries radio, SMS, Bluetooth and any other connection that works. It is not confirmed delivered until a gateway acknowledges it.
          </div>
        )}
        {storageProblem && (
          <div className="mb-4 rounded-2xl border-2 border-critical-700 bg-critical-100 p-4 font-bold text-ink-900" role="alert">
            <Icon name="alert" size={18} className="mr-2 inline" /> {storageProblem}
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-2xl border-2 border-critical-700 bg-critical-100 p-4 text-ink-900" role="alert">
            <p className="flex items-start gap-2 font-bold"><Icon name="alert" size={18} className="mt-0.5 shrink-0" /> {error.message}</p>
            {!!error.details?.length && (
              <ul className="mt-1 list-disc pl-9 text-sm">
                {error.details.map((d) => (
                  <li key={d.path + d.message}>{d.path}: {d.message}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="clay p-5 sm:p-8">
          <h2 ref={headingRef} tabIndex={-1} className="text-3xl font-semibold outline-none sm:text-4xl">{current.title}</h2>

          {step === 0 && (
            <div className="mt-2 space-y-5">
              <p className="hint">The location is the only required answer. Use GPS, mark the map, type coordinates, or just describe the place in words. Nothing here needs an internet connection.</p>
              <div aria-describedby={locationError ? 'location-error' : undefined}>
                <LocationPicker value={form.location} onChange={(v) => { set('location')(v); setLocationError('') }} />
              </div>
              {locationError && (
                <p id="location-error" className="field-error" role="alert"><Icon name="alert" size={16} className="mt-0.5 shrink-0" /> {locationError}</p>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="locationAddress">Landmark, address or nearby area{form.location ? ' (optional)' : ''}</label>
                  <input id="locationAddress" className="input" maxLength={300} value={form.locationAddress} onChange={setText('locationAddress')} placeholder="e.g. behind the market, blue gate" />
                  {!form.location && <p className="hint mt-1">Without coordinates responders rely on this description, so be specific.</p>}
                </div>
                <div>
                  <label className="label" htmlFor="area">Area (optional)</label>
                  <select id="area" className="input" value={form.area} onChange={setText('area')}>
                    <option value="">Detect from location</option>
                    {AREAS.map((a) => (
                      <option key={a.name} value={a.name}>{a.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="mt-4 space-y-5">
              <ChoiceGroup multiple legend="What kind of danger is there?" hint="Choose everything that applies." options={DANGERS} value={form.dangers} onChange={set('dangers')} exclusive={['none']} />
              {aiMarks.dangers.some((d) => form.dangers.includes(d)) && (
                <AiMark onConfirm={() => setAiMarks((m) => ({ ...m, dangers: [] }))}>
                  AI suggested: {aiMarks.dangers.filter((d) => form.dangers.includes(d)).map((d) => DANGERS[d as keyof typeof DANGERS] ?? d).join(', ')}. Untick any that are wrong.
                </AiMark>
              )}
              <div>
                <label className="label" htmlFor="dangerDetails">Describe the situation (optional)</label>
                <textarea id="dangerDetails" rows={3} maxLength={1000} className="input" value={form.dangerDetails} onChange={(e) => { setText('dangerDetails')(e); setAiMarks((m) => (m.dangerDetails ? { ...m, dangerDetails: false } : m)) }} placeholder="e.g. water is rising, family is on the roof" />
                {aiMarks.dangerDetails && <AiMark onConfirm={() => setAiMarks((m) => ({ ...m, dangerDetails: false }))}>Contains AI-suggested text from your photo. Edit anything that is wrong, or confirm it.</AiMark>}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="incidentTime">When did it happen?</label>
                  <input id="incidentTime" type="datetime-local" className="input" max={localInputValue()} value={form.incidentTime} onChange={setText('incidentTime')} />
                  <p className="hint mt-1">From your device clock. Responders treat it as your report, not a verified time.</p>
                </div>
              </div>
              <ChoiceGroup legend="How urgent do you think this is? (optional)" hint="Your own view. It is shown as unverified and never sends anyone by itself." options={REPORTER_URGENCY} value={form.urgency} onChange={(v) => { set('urgency')(v); setAiMarks((m) => (m.urgency ? { ...m, urgency: false } : m)) }} />
              {aiMarks.urgency && form.urgency && <AiMark onConfirm={() => setAiMarks((m) => ({ ...m, urgency: false }))}>AI suggested this urgency from your photo. It needs review. Change it if you disagree.</AiMark>}
              <PhotoAttachments reportId={clientId} owner={owner} ensureDraft={flush} consent={aiConsent} onConsent={setAiConsent} />
              <PhotoAnalysisPanel
                reportId={clientId}
                consent={aiConsent}
                fields={{ dangers: form.dangers, dangerDetails: form.dangerDetails, urgency: form.urgency }}
                onApply={(a) => {
                  setForm((f) => ({ ...f, dangers: a.fields.dangers, dangerDetails: a.fields.dangerDetails, urgency: a.fields.urgency }))
                  setAiMarks((m) => ({ dangers: [...new Set([...m.dangers, ...a.marks.dangers])], dangerDetails: m.dangerDetails || a.marks.dangerDetails, urgency: m.urgency || a.marks.urgency }))
                }}
              />
            </div>
          )}

          {step === 2 && (
            <div className="mt-4 space-y-7">
              <div>
                <label className="label" htmlFor="peopleCount">How many people need help?</label>
                <div className="flex flex-wrap items-center gap-3">
                  <input id="peopleCount" type="number" min={1} max={10000} inputMode="numeric" className="input w-36" value={form.peopleCount} onChange={setText('peopleCount')} placeholder="Number" />
                  <span className="hint">Leave empty if you are not sure.</span>
                </div>
              </div>
              <ChoiceGroup legend="Are there injuries?" options={INJURY_SEVERITIES} value={form.injurySeverity} onChange={set('injurySeverity')} />
              {injured && (
                <div className="grid gap-4 sm:grid-cols-[9rem_1fr]">
                  <div>
                    <label className="label" htmlFor="injuryCount">How many injured?</label>
                    <input id="injuryCount" type="number" min={1} inputMode="numeric" className="input" value={form.injuryCount} onChange={setText('injuryCount')} />
                  </div>
                  <div>
                    <label className="label" htmlFor="injuryDetails">Injury details</label>
                    <input id="injuryDetails" className="input" maxLength={1000} value={form.injuryDetails} onChange={setText('injuryDetails')} placeholder="e.g. broken leg, heavy bleeding" />
                  </div>
                </div>
              )}
              <ChoiceGroup columns={3} legend="Can everyone leave safely on their own?" options={EVACUATION_ABILITY} value={form.canEvacuate} onChange={set('canEvacuate')} />
              <ChoiceGroup multiple legend="Is anyone there who may need extra help?" options={VULNERABILITIES} value={form.vulnerabilities} onChange={set('vulnerabilities')} />
            </div>
          )}

          {step === 3 && (
            <div className="mt-4 space-y-5">
              <ChoiceGroup multiple legend="Essential medication, equipment or conditions" hint="Responders can plan for these. Skip this step if there are none." options={MEDICAL_NEEDS} value={form.medicalNeedTypes} onChange={set('medicalNeedTypes')} />
              <div>
                <label className="label" htmlFor="medicalNeeds">Details (optional)</label>
                <input id="medicalNeeds" className="input" maxLength={1000} value={form.medicalNeeds} onChange={setText('medicalNeeds')} placeholder="e.g. insulin runs out tonight" />
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="mt-4 space-y-6">
              <fieldset>
                <legend className="label">Contact details (optional)</legend>
                <p className="hint mb-3">Only responders see these, so they can call you back.</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="label" htmlFor="contactName">Name</label>
                    <input id="contactName" className="input" maxLength={120} autoComplete="name" value={form.contactName} onChange={setText('contactName')} />
                  </div>
                  <div>
                    <label className="label" htmlFor="contactPhone">Phone</label>
                    <input id="contactPhone" type="tel" className="input" maxLength={40} autoComplete="tel" value={form.contactPhone} onChange={setText('contactPhone')} placeholder="+92 ..." />
                  </div>
                </div>
              </fieldset>

              <div className="space-y-3">
                <h3 className="font-display text-xl font-semibold">Your answers</h3>
                <Review title="Location" onEdit={() => goTo(0)}>
                  {form.location ? (
                    <p>{form.location.source === 'gps' ? 'From GPS' : 'Selected on the map or typed'} (not verified): {form.location.lat.toFixed(5)}, {form.location.lng.toFixed(5)}</p>
                  ) : form.locationAddress.trim() || form.area ? (
                    <p className="font-semibold text-warning-700">No coordinates. Responders will rely on the description below (unverified).</p>
                  ) : (
                    <p className="font-semibold text-critical-700">Missing. Add a location before sending.</p>
                  )}
                  {form.locationAddress && <p>{form.locationAddress}</p>}
                  {form.area && <p>Area: {form.area}</p>}
                </Review>
                <Review title="Situation" onEdit={() => goTo(1)}>
                  <p>{form.dangers.length ? labelList(form.dangers, DANGERS) : <Unknown />}</p>
                  {form.dangerDetails && <p>{form.dangerDetails}</p>}
                  {form.incidentTime && <p>Happened: {new Date(form.incidentTime).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} (your entry)</p>}
                  {form.urgency && <p>Your urgency rating: {REPORTER_URGENCY[form.urgency as keyof typeof REPORTER_URGENCY]} (unverified)</p>}
                  <PhotoCount clientId={clientId} />
                </Review>
                <Review title="People" onEdit={() => goTo(2)}>
                  <p>People needing help: {form.peopleCount || <Unknown>Not sure</Unknown>}</p>
                  <p>Injuries: {form.injurySeverity ? INJURY_SEVERITIES[form.injurySeverity as keyof typeof INJURY_SEVERITIES] ?? form.injurySeverity : <Unknown />}</p>
                  <p>Can leave on their own: {form.canEvacuate ? EVACUATION_ABILITY[form.canEvacuate as keyof typeof EVACUATION_ABILITY] ?? form.canEvacuate : <Unknown />}</p>
                  {!!form.vulnerabilities.length && <p>Extra help: {labelList(form.vulnerabilities, VULNERABILITIES)}</p>}
                </Review>
                <Review title="Medical needs" onEdit={() => goTo(3)}>
                  <p>{form.medicalNeedTypes.length ? labelList(form.medicalNeedTypes, MEDICAL_NEEDS) : 'None listed'}</p>
                  {form.medicalNeeds && <p>{form.medicalNeeds}</p>}
                </Review>
              </div>

              {preliminary && (
                <p className="flex items-start gap-2 rounded-2xl bg-sand-200 p-3.5 text-sm font-semibold text-ink-900" role="note">
                  <Icon name="info" size={18} className="mt-0.5 shrink-0" />
                  Preliminary estimate on this device: {PRIORITY_LABELS[preliminary]} urgency. It is unverified, no AI is used, and nothing is dispatched automatically. Responders make the real assessment.
                </p>
              )}

              {unanswered.length > 0 && hasLocation(form) && (
                <p className="flex items-start gap-2 rounded-2xl bg-warning-100 p-3.5 text-sm font-semibold text-ink-900" role="note">
                  <Icon name="info" size={18} className="mt-0.5 shrink-0" />
                  Not answered: {unanswered.join(', ')}. You can still send. Responders will treat these as unknown, not as safe.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Actions: sticky on phones so the next step is always in reach */}
        <div className="sticky bottom-0 z-10 -mx-4 mt-5 bg-gradient-to-t from-sand-100 via-sand-100/95 to-transparent px-4 pb-4 pt-6 sm:static sm:mx-0 sm:bg-none sm:p-0">
          <div className="flex items-center gap-3">
            {step > 0 && (
              <button type="button" className="btn-ghost" onClick={() => goTo(step - 1)}>
                <Icon name="arrow" size={18} className="rotate-180" /> Back
              </button>
            )}
            {step < last ? (
              <button type="submit" className="btn-primary ml-auto px-7">
                {step === 3 && !form.medicalNeedTypes.length && !form.medicalNeeds ? 'Skip' : 'Next'} <Icon name="arrow" size={18} />
              </button>
            ) : (
              <button type="submit" className="btn-primary cta-ring ml-auto flex-1 px-7 py-4 text-lg sm:flex-none" disabled={submitting}>
                <Icon name="alert" size={20} />
                {submitting ? 'Sending...' : 'Send emergency report'}
              </button>
            )}
          </div>
          <p className="mt-3 flex items-center gap-1.5 text-sm text-ink-600" aria-live="polite">
            <Icon name="save" size={15} />
            {savedAt
              ? `Draft saved on this device at ${new Date(savedAt).toLocaleTimeString([], { timeStyle: 'short' })}. Nothing is sent until you press the button. Then the report is saved on this device first and sent over every channel that is available, without waiting for Wi-Fi.`
              : 'Your answers are kept on this device as you type. Nothing is sent until you press the button.'}
          </p>
        </div>
=======
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800" role="alert">
          <p className="font-medium">{error.message}</p>
          {!!error.details?.length && (
            <ul className="mt-1 list-disc pl-5">
              {error.details.map((d) => (
                <li key={d.path + d.message}>
                  {d.path}: {d.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Section step={1} title="Where is help needed?" hint="Required. GPS is most accurate; you can also mark the spot on the map.">
        <LocationPicker value={form.location} onChange={set('location')} />
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="locationAddress">Landmark or address (optional)</label>
            <input id="locationAddress" className="input" maxLength={300} value={form.locationAddress} onChange={setText('locationAddress')} placeholder="e.g. behind the market, blue gate" />
          </div>
          <div>
            <label className="label" htmlFor="area">Area (optional)</label>
            <select id="area" className="input" value={form.area} onChange={setText('area')}>
              <option value="">Detect from location</option>
              {AREAS.map((a) => (
                <option key={a.name} value={a.name}>{a.name}</option>
              ))}
            </select>
          </div>
        </div>
      </Section>

      <Section step={2} title="Is anyone in immediate danger?" hint="Select everything that applies.">
        <ChoiceGroup multiple options={DANGERS} value={form.dangers} onChange={set('dangers')} exclusive={['none']} />
        <label className="label mt-3" htmlFor="dangerDetails">Describe the situation (optional)</label>
        <textarea id="dangerDetails" rows={2} maxLength={1000} className="input" value={form.dangerDetails} onChange={setText('dangerDetails')} placeholder="e.g. water rising, family on the roof" />
      </Section>

      <Section step={3} title="How many people need help?">
        <div className="flex flex-wrap items-center gap-3">
          <input type="number" min={1} max={10000} inputMode="numeric" className="input w-32" value={form.peopleCount} onChange={setText('peopleCount')} placeholder="Number" aria-label="Number of people" />
          <span className="text-sm text-gray-500">Leave empty if you are not sure.</span>
        </div>
      </Section>

      <Section step={4} title="Are there injuries?">
        <ChoiceGroup options={INJURY_SEVERITIES} value={form.injurySeverity} onChange={set('injurySeverity')} />
        {injured && (
          <div className="mt-3 grid gap-3 sm:grid-cols-[8rem_1fr]">
            <div>
              <label className="label" htmlFor="injuryCount">How many?</label>
              <input id="injuryCount" type="number" min={1} inputMode="numeric" className="input" value={form.injuryCount} onChange={setText('injuryCount')} />
            </div>
            <div>
              <label className="label" htmlFor="injuryDetails">Injury details</label>
              <input id="injuryDetails" className="input" maxLength={1000} value={form.injuryDetails} onChange={setText('injuryDetails')} placeholder="e.g. broken leg, heavy bleeding" />
            </div>
          </div>
        )}
      </Section>

      <Section step={5} title="Medical needs" hint="Essential medication, equipment or conditions responders should know about.">
        <ChoiceGroup multiple options={MEDICAL_NEEDS} value={form.medicalNeedTypes} onChange={set('medicalNeedTypes')} />
        <label className="label mt-3" htmlFor="medicalNeeds">Details (optional)</label>
        <input id="medicalNeeds" className="input" maxLength={1000} value={form.medicalNeeds} onChange={setText('medicalNeeds')} placeholder="e.g. insulin runs out tonight" />
      </Section>

      <Section step={6} title="Can everyone leave safely on their own?">
        <ChoiceGroup columns={3} options={EVACUATION_ABILITY} value={form.canEvacuate} onChange={set('canEvacuate')} />
        <p className="label mt-4">Is anyone here who may need extra help?</p>
        <ChoiceGroup multiple options={VULNERABILITIES} value={form.vulnerabilities} onChange={set('vulnerabilities')} />
      </Section>

      <Section step={7} title="Contact (optional)" hint="Only for responders, so they can call back.">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="contactName">Name</label>
            <input id="contactName" className="input" maxLength={120} autoComplete="name" value={form.contactName} onChange={setText('contactName')} />
          </div>
          <div>
            <label className="label" htmlFor="contactPhone">Phone</label>
            <input id="contactPhone" type="tel" className="input" maxLength={40} autoComplete="tel" value={form.contactPhone} onChange={setText('contactPhone')} placeholder="+92 ..." />
          </div>
        </div>
      </Section>

      <div className="sticky bottom-0 -mx-4 border-t border-gray-200 bg-white/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
        {unanswered.length > 0 && form.location && (
          <p className="mb-2 text-xs text-gray-500">
            Not answered: {unanswered.join(', ')}. You can still send - responders will treat it as unknown, not as safe.
          </p>
        )}
        <button type="submit" className="btn-danger w-full py-3 text-base" disabled={submitting}>
          {submitting ? 'Sending...' : 'Send emergency report'}
        </button>
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
      </div>
    </form>
  )
}
