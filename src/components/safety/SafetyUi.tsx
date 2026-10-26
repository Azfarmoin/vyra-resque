'use client'

// Visual, mobile-first safety center components. Every instruction carries a text label (DO / DON'T / REMEMBER) and a
// symbol as well as color, and the steps are numbered. Only the active phase is rendered, which keeps pages light.
import { useId, useMemo, useState } from 'react'
import Link from 'next/link'
import Icon from '../ui/Icon'
import Scene from './Scene'
import { EMERGENCY_LABEL, EMERGENCY_NUMBER, LIVE_INFO_NOTE, SAFETY_DISCLAIMER } from '@/lib/safety/config'
import { guideFromLabel, GROUP_LABELS, PHASE_INFO, PHASES, WAITING_SAFETY_FIRST, getGuide, type HazardGuide, type HazardId, type Phase, type Step } from '@/lib/safety'
import { isStale } from '@/lib/safety/lint'
import { buildChecklist, DEFAULT_ANSWERS, type NowAnswers } from '@/lib/safety/rules'
import { saveGuidesOffline, useOnline } from '@/lib/safety/client'

const fmtDate = (iso: string) => new Date(iso + (iso.length === 10 ? 'T00:00:00' : '')).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })

// ---- small pieces -------------------------------------------------------------------------------------------------
export function EmergencyCall({ className = '' }: { className?: string }) {
  if (!EMERGENCY_NUMBER) return <p className={`text-sm font-bold ${className}`}>Call your local emergency service if you can.</p>
  return (
    <a href={`tel:${EMERGENCY_NUMBER}`} className={`btn-primary ${className}`} aria-label={`Call ${EMERGENCY_LABEL}`}>
      <Icon name="phone" size={20} /> Call {EMERGENCY_LABEL}
    </a>
  )
}

export function ReviewStatus({ guide, compact = false }: { guide: HazardGuide; compact?: boolean }) {
  const old = isStale(guide)
  return (
    <div className={`rounded-xl p-2.5 text-xs ${old ? 'bg-warning-100 text-ink-900' : 'bg-sand-200 text-ink-800'}`}>
      <p className="font-bold">
        {guide.expert_reviewed ? `Reviewed by ${guide.expert_reviewed.by} on ${fmtDate(guide.expert_reviewed.on)}.` : `Checked against public guidance on ${fmtDate(guide.content_checked_on)}. Not yet reviewed by a local emergency-management professional.`}
        {old && ' This guide is more than a year old: check current official advice.'}
      </p>
      {!compact && <p className="mt-1">General precautions only. Location-specific official instructions always come first.</p>}
    </div>
  )
}

export function OfflineNote() {
  const online = useOnline()
  return (
    <p role="status" className={`rounded-xl p-2.5 text-xs font-bold ${online ? 'bg-sand-200 text-ink-800' : 'bg-critical-100 text-critical-700'}`}>
      <Icon name="info" size={14} className="mr-1 inline" />
      {online ? `This guide is saved on your device after you open it, so it works without internet. ${LIVE_INFO_NOTE}` : `You are offline. You are reading the saved guide. ${LIVE_INFO_NOTE}`}
    </p>
  )
}

// ---- one step ------------------------------------------------------------------------------------------------------
export function StepCard({ step, n, total, done, onToggle }: { step: Step; n: number; total: number; done?: boolean; onToggle?: () => void }) {
  return (
    <article className="clay overflow-hidden" style={{ borderRadius: 24 }} aria-labelledby={`s-${step.id}`}>
      <div className="grid gap-0 sm:grid-cols-[minmax(0,230px)_1fr]">
        <div className="bg-sand-100 p-3"><Scene id={step.scene} className="mx-auto h-auto w-full max-w-[260px]" /></div>
        <div className="space-y-3 p-4">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ink-900 text-lg font-extrabold text-white" aria-hidden="true">{n}</span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold uppercase tracking-wide text-ink-600">Step {n} of {total}</p>
              <h3 id={`s-${step.id}`} className="font-display text-xl font-semibold leading-snug">{step.title}</h3>
            </div>
            {onToggle && (
              <button type="button" onClick={onToggle} aria-pressed={!!done} className={`btn-sm shrink-0 ${done ? 'btn-primary' : 'btn-ghost'}`}>
                <Icon name="check" size={16} /> <span>{done ? 'Done' : 'Mark done'}</span>
              </button>
            )}
          </div>
          {step.do.length > 0 && (
            <div className="rounded-xl border-2 border-success-700 bg-success-100/60 p-3">
              <p className="flex items-center gap-1.5 text-sm font-extrabold text-success-800"><span aria-hidden="true">✓</span> DO</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-[15px] leading-snug">{step.do.map((t) => <li key={t}>{t}</li>)}</ul>
            </div>
          )}
          {step.dont.length > 0 && (
            <div className="rounded-xl border-2 border-dashed border-critical-700 bg-critical-100/60 p-3">
              <p className="flex items-center gap-1.5 text-sm font-extrabold text-critical-700"><span aria-hidden="true">✕</span> DON&apos;T</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-[15px] leading-snug">{step.dont.map((t) => <li key={t}>{t}</li>)}</ul>
            </div>
          )}
          {step.remember && <p className="rounded-xl bg-warning-100 p-3 text-[15px] font-semibold leading-snug"><span className="font-extrabold">REMEMBER: </span>{step.remember}</p>}
          {step.detail && (
            <details className="rounded-xl bg-sand-200 p-3 text-sm"><summary className="cursor-pointer font-bold">More detail</summary><p className="mt-2">{step.detail}</p></details>
          )}
        </div>
      </div>
    </article>
  )
}

// ---- guide page ----------------------------------------------------------------------------------------------------
export function GuideView({ guide, initialPhase }: { guide: HazardGuide; initialPhase?: Phase }) {
  const [phase, setPhase] = useState<Phase>(initialPhase ?? 'during')
  const [scenario, setScenario] = useState(guide.waiting[0]?.id)
  const [done, setDone] = useState<Record<string, boolean>>({})
  const tabsId = useId()
  const steps: Step[] = useMemo(() => {
    if (phase === 'waiting') return guide.waiting.find((w) => w.id === scenario)?.steps ?? guide.waiting[0].steps
    return guide[phase]
  }, [guide, phase, scenario])
  const doneCount = steps.filter((s) => done[`${phase}:${scenario}:${s.id}`]).length
  const info = PHASE_INFO[phase]
  const go = (p: Phase) => { setPhase(p); history.replaceState(null, '', `#${p}`) }
  const onKey = (e: React.KeyboardEvent) => {
    const i = PHASES.indexOf(phase)
    if (e.key === 'ArrowRight') go(PHASES[(i + 1) % 4])
    else if (e.key === 'ArrowLeft') go(PHASES[(i + 3) % 4])
    else return
    e.preventDefault()
  }
  const pct = steps.length ? Math.round((doneCount / steps.length) * 100) : 0
  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Guide sections" onKeyDown={onKey} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {PHASES.map((p) => (
          <button key={p} id={`${tabsId}-${p}`} role="tab" aria-selected={p === phase} aria-controls={`${tabsId}-panel`} tabIndex={p === phase ? 0 : -1} onClick={() => go(p)}
            className={`min-h-[56px] rounded-2xl px-3 py-2 text-left font-bold transition ${p === phase ? 'bg-ink-900 text-white shadow-lg' : 'clay-sm hover:bg-sand-200/70'} ${p === 'waiting' ? 'ring-2 ring-primary-500' : ''}`}>
            <span className="flex items-center gap-2"><span className={`grid h-7 w-7 place-items-center rounded-full text-sm ${p === phase ? 'bg-white text-ink-900' : 'bg-ink-900 text-white'}`} aria-hidden="true">{PHASE_INFO[p].glyph}</span><span className="text-sm leading-tight">{PHASE_INFO[p].label}</span></span>
          </button>
        ))}
      </div>

      <section id={`${tabsId}-panel`} role="tabpanel" aria-labelledby={`${tabsId}-${phase}`} tabIndex={0} className="space-y-4">
        <header>
          <h2 className="font-display text-2xl font-semibold">{phase === 'waiting' ? `${guide.title.split(' and ')[0]}: What to Do While Waiting for Rescue` : `${info.label}: ${info.sub}`}</h2>
          {phase === 'during' && <p className="mt-1 text-sm font-semibold text-ink-700">The most urgent life-safety action is first. If you are in danger now, start at step 1.</p>}
        </header>

        {phase === 'waiting' && (
          <>
            <p className="rounded-2xl border-2 border-primary-500 bg-primary-100/60 p-3 font-bold" role="note">{WAITING_SAFETY_FIRST}</p>
            {guide.waiting.length > 1 && (
              <div role="group" aria-label="Where are you waiting?" className="flex flex-wrap gap-2">
                {guide.waiting.map((w) => (
                  <button key={w.id} type="button" aria-pressed={w.id === scenario} onClick={() => setScenario(w.id)} className={`btn-sm ${w.id === scenario ? 'btn-primary' : 'btn-ghost'}`} title={w.when}>{w.label}</button>
                ))}
              </div>
            )}
            <p className="text-sm text-ink-700">{guide.waiting.find((w) => w.id === scenario)?.when}</p>
          </>
        )}

        <div className="flex items-center gap-3" aria-live="polite">
          <div className="h-3 flex-1 overflow-hidden rounded-full bg-sand-300" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={doneCount} aria-label="Steps marked done"><div className="h-full bg-success-700 transition-all" style={{ width: `${pct}%` }} /></div>
          <span className="text-sm font-bold">{doneCount} of {steps.length} done</span>
        </div>

        <ol className="space-y-4">
          {steps.map((s, i) => (
            <li key={`${phase}-${scenario}-${s.id}`}>
              <StepCard step={s} n={i + 1} total={steps.length} done={!!done[`${phase}:${scenario}:${s.id}`]} onToggle={() => setDone((d) => ({ ...d, [`${phase}:${scenario}:${s.id}`]: !d[`${phase}:${scenario}:${s.id}`] }))} />
            </li>
          ))}
        </ol>

        <nav className="flex justify-between gap-2" aria-label="Previous and next section">
          <button type="button" className="btn-ghost" disabled={phase === 'before'} onClick={() => go(PHASES[PHASES.indexOf(phase) - 1])}>← Previous</button>
          <button type="button" className="btn-primary" disabled={phase === 'after'} onClick={() => go(PHASES[PHASES.indexOf(phase) + 1])}>Next →</button>
        </nav>
      </section>

      {guide.related.length > 0 && (
        <section className="clay-inset p-3 text-sm" aria-label="Related guides">
          <p className="font-bold">Other hazards can happen at the same time. Check them too:</p>
          <ul className="mt-1 flex flex-wrap gap-2">{guide.related.map((r) => <li key={r}><Link className="btn-ghost btn-sm" href={`/safety/${r}`}>{getGuide(r)?.title}</Link></li>)}</ul>
          <p className="mt-2 text-xs text-ink-700">If two guides seem to disagree, follow official instructions, then the guide for the immediate threat (for example fire or building collapse before flood clean-up).</p>
        </section>
      )}

      <section aria-label="Sources and review" className="space-y-2">
        <ReviewStatus guide={guide} />
        <details className="rounded-xl bg-sand-200 p-3 text-sm">
          <summary className="cursor-pointer font-bold">Sources ({guide.sources.length})</summary>
          <ul className="mt-2 space-y-1.5">{guide.sources.map((s) => (
            <li key={s.url}><strong>{s.org}</strong>: {s.title}. <a className="font-bold underline" href={s.url} target="_blank" rel="noopener noreferrer">{s.url}<span className="sr-only"> (opens in a new tab)</span></a> <span className="text-xs">({s.checked ? 'page read when this guide was written' : 'address not re-checked: confirm before relying on it'})</span></li>
          ))}</ul>
          <p className="mt-2 text-xs">Where sources differ, use guidance for your own location and follow your national and local authorities.</p>
        </details>
        <OfflineNote />
        <p className="text-xs font-semibold text-ink-700">{SAFETY_DISCLAIMER}</p>
      </section>
    </div>
  )
}

// ---- "What should I do right now?" -----------------------------------------------------------------------------------
function Toggle({ label, value, onChange, hint }: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-sand-100 p-2.5">
      <div><p className="font-bold">{label}</p>{hint && <p className="text-xs text-ink-600">{hint}</p>}</div>
      <div role="group" aria-label={label} className="flex shrink-0 gap-1">
        {[true, false].map((v) => (
          <button key={String(v)} type="button" aria-pressed={value === v} onClick={() => onChange(v)} className={`btn-sm min-w-[56px] ${value === v ? 'btn-primary' : 'btn-ghost'}`}>{v ? 'Yes' : 'No'}</button>
        ))}
      </div>
    </div>
  )
}

export function NowWizard({ guides, initialHazard = null }: { guides: HazardGuide[]; initialHazard?: HazardId | null }) {
  const online = useOnline()
  const [a, setA] = useState<NowAnswers>({ ...DEFAULT_ANSWERS, hazard: initialHazard })
  const result = useMemo(() => buildChecklist({ ...a, online }), [a, online])
  const set = (p: Partial<NowAnswers>) => setA((x) => ({ ...x, ...p }))
  const situation = a.situation
  return (
    <div className="space-y-4">
      <button type="button" onClick={() => set({ danger: true })} aria-pressed={a.danger} className={`w-full rounded-2xl border-4 p-4 text-left text-lg font-extrabold ${a.danger ? 'border-critical-700 bg-critical-100 text-critical-700' : 'border-ink-900 bg-white'}`}>
        <span aria-hidden="true">⚠ </span>I am in immediate danger now{a.danger ? ' (selected)' : ''}
      </button>
      <fieldset className="space-y-2">
        <legend className="mb-1 font-display text-lg font-semibold">What is happening?</legend>
        <div className="flex flex-wrap gap-2">
          {guides.map((g) => <button key={g.id} type="button" aria-pressed={a.hazard === g.id} onClick={() => set({ hazard: a.hazard === g.id ? null : g.id })} className={`btn-sm ${a.hazard === g.id ? 'btn-primary' : 'btn-ghost'}`}><Icon name={g.icon} size={16} /> {g.title.split(' and ')[0].replace('Cyclones, severe storms', 'Storm and wind')}</button>)}
        </div>
      </fieldset>
      <div className="space-y-2">
        <Toggle label="Am I in immediate danger?" value={a.danger} onChange={(v) => set({ danger: v })} />
        <fieldset>
          <legend className="sr-only">Am I trapped or injured?</legend>
          <p className="mb-1 font-bold">Am I trapped or injured?</p>
          <div className="flex flex-wrap gap-2">
            {([['none', 'Neither'], ['trapped', 'Trapped'], ['injured', 'Injured'], ['both', 'Both']] as const).map(([v, l]) => <button key={v} type="button" aria-pressed={situation === v} onClick={() => set({ situation: v })} className={`btn-sm ${situation === v ? 'btn-primary' : 'btn-ghost'}`}>{l}</button>)}
          </div>
        </fieldset>
        <Toggle label="Have I reported and am I waiting for rescue?" value={a.waiting} onChange={(v) => set({ waiting: v })} />
        <p className="text-xs font-semibold text-ink-700" role="status">{online ? 'You have an internet connection.' : 'You are offline. This checklist still works.'}</p>
      </div>

      <section aria-live="polite" aria-label="Your checklist" className={`rounded-2xl border-4 p-4 ${result.urgent ? 'border-critical-700 bg-critical-100/40' : 'border-ink-900 bg-white'}`}>
        <h2 className="font-display text-xl font-semibold">{result.urgent ? 'Do this now, in this order' : 'Your checklist'}</h2>
        {result.urgent && <div className="mt-2"><EmergencyCall className="w-full" /></div>}
        <ol className="mt-3 space-y-2">
          {result.items.map((it, i) => (
            <li key={it.id} className={`flex gap-3 rounded-xl p-2.5 ${it.tone === 'urgent' ? 'bg-critical-100 font-bold' : it.tone === 'info' ? 'bg-sand-200' : 'bg-sand-100'}`}>
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-ink-900 text-sm font-extrabold text-white" aria-hidden="true">{i + 1}</span>
              <span className="min-w-0 text-[15px] leading-snug">{it.tone === 'urgent' && <span className="font-extrabold">URGENT: </span>}{it.text} {it.link && <Link href={it.link.href} className="font-bold underline">{it.link.label}</Link>}</span>
            </li>
          ))}
        </ol>
        {a.hazard && <p className="mt-3 flex flex-wrap gap-2"><Link className="btn-primary btn-sm" href={`/safety/${a.hazard}#during`}>Full guide</Link><Link className="btn-ghost btn-sm" href={`/safety/${a.hazard}#waiting`}>While waiting for rescue</Link></p>}
        {result.also.length > 0 && <p className="mt-3 text-sm"><strong>Could another hazard be involved?</strong> {result.also.map((x) => <Link key={x.id} href={x.href} className="mr-2 underline">{x.title}</Link>)}</p>}
        <ul className="mt-3 space-y-1 text-xs text-ink-700">{result.notes.map((n) => <li key={n}>{n}</li>)}</ul>
        <p className="mt-2 text-xs font-semibold">{SAFETY_DISCLAIMER}</p>
      </section>
    </div>
  )
}

// ---- landing -------------------------------------------------------------------------------------------------------
export function HazardCard({ g }: { g: HazardGuide }) {
  return (
    <Link href={`/safety/${g.id}`} className="clay group flex h-full flex-col overflow-hidden transition hover:-translate-y-0.5" style={{ borderRadius: 24 }}>
      <div className="bg-sand-100 p-2"><Scene id={g.during[0].scene} decorative className="h-auto w-full" /></div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="flex items-start gap-2 font-display text-lg font-semibold leading-snug"><Icon name={g.icon} size={22} className="mt-0.5 shrink-0" />{g.title}</h3>
        <p className="text-sm text-ink-700">{g.short}</p>
        <p className="mt-auto flex flex-wrap gap-1 pt-1" aria-label="Sections in this guide">{PHASES.map((p) => <span key={p} className="pill bg-sand-200 text-ink-800">{PHASE_INFO[p].label === 'WHILE WAITING FOR RESCUE' ? 'WAITING' : PHASE_INFO[p].label}</span>)}</p>
        <span className="text-sm font-bold underline decoration-2 underline-offset-4 group-hover:text-primary-600">Open guide<span className="sr-only">: {g.title}</span></span>
      </div>
    </Link>
  )
}

export function SaveOffline({ ids }: { ids: string[] }) {
  const online = useOnline()
  const [state, setState] = useState<{ busy: boolean; done?: number; total?: number; msg?: string }>({ busy: false })
  return (
    <div className="space-y-1">
      <button type="button" className="btn-ghost w-full" disabled={!online || state.busy} onClick={async () => {
        setState({ busy: true })
        const r = await saveGuidesOffline(ids, (done, total) => setState({ busy: true, done, total }))
        setState({ busy: false, msg: r.failed ? `${r.ok} pages saved, ${r.failed} could not be saved. Try again with a better connection.` : 'All guides are saved on this device. They open without internet.' })
      }}>
        <Icon name="save" size={18} /> {state.busy ? `Saving ${state.done ?? 0} of ${state.total ?? ids.length + 2}...` : 'Save all guides for offline use'}
      </button>
      {!online && <p className="text-xs font-semibold text-critical-700">You are offline: new guides cannot be saved now. Guides you already opened still work.</p>}
      {state.msg && <p className="text-xs font-semibold" role="status">{state.msg}</p>}
    </div>
  )
}

export function SafetyHome({ guides }: { guides: HazardGuide[] }) {
  const [q, setQ] = useState('')
  const [group, setGroup] = useState<string>('all')
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return guides.filter((g) => (group === 'all' || g.group === group) && (!needle || [g.title, g.short, ...g.keywords].some((s) => s.toLowerCase().includes(needle))))
  }, [guides, q, group])
  return (
    <div className="space-y-6">
      <section className="clay p-5 sm:p-6" style={{ borderRadius: 28 }} aria-labelledby="help-now">
        <h2 id="help-now" className="font-display text-2xl font-semibold">What should I do right now?</h2>
        <p className="mt-1 text-ink-700">Tap once to get a short, prioritized checklist. It works without internet.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href="/safety/now" className="btn-primary"><Icon name="alert" size={18} /> Get my checklist</Link>
          <EmergencyCall />
          <Link href="/report" className="btn-ghost"><Icon name="pin" size={18} /> Report an emergency</Link>
        </div>
        <p className="mt-3 text-xs font-semibold text-ink-700">{SAFETY_DISCLAIMER}</p>
      </section>

      <section aria-label="Find a guide" className="space-y-3">
        <div>
          <label htmlFor="safety-search" className="label">Search guides</label>
          <input id="safety-search" type="search" className="input" placeholder="e.g. flood, earthquake, smoke, wire" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div role="group" aria-label="Filter by category" className="flex flex-wrap gap-2">
          {['all', ...Object.keys(GROUP_LABELS)].map((k) => <button key={k} type="button" aria-pressed={group === k} onClick={() => setGroup(k)} className={`btn-sm ${group === k ? 'btn-primary' : 'btn-ghost'}`}>{k === 'all' ? 'All hazards' : GROUP_LABELS[k as keyof typeof GROUP_LABELS]}</button>)}
          {(q || group !== 'all') && <button type="button" className="btn-ghost btn-sm" onClick={() => { setQ(''); setGroup('all') }}>Reset</button>}
        </div>
        <p className="text-sm font-semibold" role="status">{shown.length} of {guides.length} guides shown</p>
      </section>

      {shown.length ? (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{shown.map((g) => <li key={g.id}><HazardCard g={g} /></li>)}</ul>
      ) : <p className="clay-inset p-4">No guide matches. Try another word, or reset the filters.</p>}

      <section className="clay-inset space-y-3 p-4" aria-label="Offline use">
        <h2 className="font-display text-lg font-semibold">Use these guides without internet</h2>
        <p className="text-sm">Guides you open are saved on this device. You can also save them all now, while you have a connection. {LIVE_INFO_NOTE}</p>
        <SaveOffline ids={guides.map((g) => g.id)} />
        <OfflineNote />
      </section>
    </div>
  )
}

// ---- links used by other VYRA screens ----------------------------------------------------------------------------------
/** A link from a report, a map zone or a photo analysis to the matching reviewed guide. */
export function SafetyLink({ hazard, label, phase, className = 'btn-ghost btn-sm', note }: { hazard: HazardId; label?: string; phase?: Phase; className?: string; note?: string }) {
  const g = getGuide(hazard)
  if (!g) return null
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <Link href={`/safety/${hazard}${phase ? `#${phase}` : ''}`} className={className}><Icon name="shield" size={16} /> {label ?? `Safety guide: ${g.title}`}</Link>
      {note && <span className="text-xs text-ink-600">{note}</span>}
    </span>
  )
}

/**
 * Drop-in for AI photo analysis (or any automatic classifier). It shows a guide pointer for a detected label and says the
 * detection is NOT verified. It never changes a report's verified state.
 */
export function PossibleHazardLink({ label }: { label: string }) {
  const id = guideFromLabel(label)
  if (!id) return null
  return (
    <div className="clay-inset space-y-1.5 p-3" role="note">
      <p className="text-sm font-bold">The photo analysis suggests: {label}. This is an automatic suggestion and has NOT been verified.</p>
      <SafetyLink hazard={id} label="Open the matching safety guide" />
    </div>
  )
}
