'use client'

// Early warnings: current alerts for your places, alert history, preferences and push settings.
import { Suspense, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import SiteHeader from '@/components/common/SiteHeader'
import AlertCard from '@/components/alerts/AlertCard'
import LocationManager from '@/components/alerts/LocationManager'
import PushSettings from '@/components/alerts/PushSettings'
import { SeverityBadge } from '@/components/alerts/AlertBits'
import Icon from '@/components/ui/Icon'
import { HAZARD_TYPES, SEVERITIES, SEVERITY_LABELS, SEVERITY_MEANING, severityRank, type HazardType, type Severity } from '@/lib/alerts/types'
import { annotate, useAlerts, useSavedLocations } from '@/lib/alerts/useAlerts'

function AlertsPage() {
  const focusId = useSearchParams().get('id')
  const [tab, setTab] = useState<'current' | 'history'>('current')
  const [hazard, setHazard] = useState<HazardType | ''>('')
  const [minSev, setMinSev] = useState<Severity>('information')
  const { alerts, status, view, reload } = useAlerts({ history: tab === 'history' })
  const { locations } = useSavedLocations()

  const items = useMemo(() => {
    const list = annotate(alerts, locations)
      .filter((i) => (tab === 'current' ? i.alert.effective_status === 'active' || i.alert.effective_status === 'cancelled' : i.alert.effective_status !== 'active'))
      .filter((i) => !hazard || i.alert.hazard_type === hazard)
      .filter((i) => severityRank(i.alert.severity) >= severityRank(minSev))
    const rank = (i: (typeof list)[number]) => (i.best === 'yes' ? 3 : i.best === 'possible' ? 2 : i.best === 'unknown' ? 1 : 0)
    return list.sort((a, b) => (focusId === b.alert.id ? 1 : 0) - (focusId === a.alert.id ? 1 : 0) || rank(b) - rank(a) || severityRank(b.alert.severity) - severityRank(a.alert.severity) || b.alert.last_updated_at.localeCompare(a.alert.last_updated_at))
  }, [alerts, locations, tab, hazard, minSev, focusId])

  const mine = items.filter((i) => i.best === 'yes' || i.best === 'possible')
  const rest = items.filter((i) => !(i.best === 'yes' || i.best === 'possible'))
  const showSplit = tab === 'current' && locations.length > 0

  return (
    <div className="page">
      <SiteHeader />
      <main id="main" className="container-x space-y-5 pb-16 pt-6">
        <header>
          <h1 className="font-display text-3xl font-semibold sm:text-4xl">Early warnings</h1>
          <p className="mt-1 max-w-3xl text-ink-700">Official warnings and forecasts for your places, with their source, time and limits. VYRA repeats what authorities publish. It does not predict disasters.</p>
        </header>

        {/* Honest status: live, saved copy, or not monitoring at all */}
        <div role="status" className={`rounded-2xl p-3 text-sm font-semibold ${status.isLive && view?.monitoring.state === 'ok' ? 'bg-success-100 text-success-800' : 'bg-warning-100 text-ink-900'}`}>
          <div className="flex flex-wrap items-center gap-2"><Icon name={status.isLive ? 'refresh' : 'alert'} size={16} /> {status.label}
            {status.isLive && <button type="button" className="underline" onClick={reload}>Check again</button>}</div>
          {status.explanation && <p className="mt-1 font-medium">{status.explanation}</p>}
          {view && <p className="mt-1 font-medium">{view.monitoring.message}</p>}
        </div>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Alert views">
              <button role="tab" aria-selected={tab === 'current'} className={tab === 'current' ? 'btn-dark btn-sm' : 'btn-ghost btn-sm'} onClick={() => setTab('current')}>Current</button>
              <button role="tab" aria-selected={tab === 'history'} className={tab === 'history' ? 'btn-dark btn-sm' : 'btn-ghost btn-sm'} onClick={() => setTab('history')}>History (30 days)</button>
              <label className="sr-only" htmlFor="hz">Hazard</label>
              <select id="hz" className="rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm" value={hazard} onChange={(e) => setHazard(e.target.value as HazardType | '')}>
                <option value="">All hazards</option>{(Object.keys(HAZARD_TYPES) as HazardType[]).map((h) => <option key={h} value={h}>{HAZARD_TYPES[h]}</option>)}
              </select>
              <label className="sr-only" htmlFor="sv">Minimum level</label>
              <select id="sv" className="rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm" value={minSev} onChange={(e) => setMinSev(e.target.value as Severity)}>
                {SEVERITIES.map((s) => <option key={s} value={s}>{SEVERITY_LABELS[s]} and above</option>)}
              </select>
            </div>

            {view && view.conflicts.length > 0 && tab === 'current' && (
              <section className="rounded-2xl border-2 border-warning bg-warning-100 p-3 text-sm" aria-label="Sources disagree">
                <h2 className="font-bold">Sources disagree</h2>
                <ul className="mt-1 list-disc pl-5">{view.conflicts.map((c) => <li key={c.alert_ids.join('-')}>{HAZARD_TYPES[c.hazard_type]}: {c.reason}</li>)}</ul>
              </section>
            )}

            {status.mode === 'loading' ? <p>Loading...</p> : !items.length ? (
              <div className="clay-sm p-5 text-sm" style={{ borderRadius: 22 }}>
                <p className="font-bold">{tab === 'current' ? 'No active alerts in the sources VYRA checks.' : 'No past alerts in the last 30 days.'}</p>
                <p className="mt-1 text-ink-700">This is not a statement that conditions are safe. Sources publish only what they publish and may be delayed. Check the weather service, radio, TV or your local authority.</p>
              </div>
            ) : showSplit ? (
              <>
                <section aria-label="Alerts that may affect your places" className="space-y-3">
                  <h2 className="font-display text-xl font-semibold">May affect your places ({mine.length})</h2>
                  {mine.length ? mine.map((i) => <AlertCard key={i.alert.id} item={i} live={status.isLive} defaultOpen={i.alert.id === focusId} />) : <p className="text-sm text-ink-700">None of the alerts below is matched to your places. Alerts without a published boundary cannot be matched and are listed separately.</p>}
                </section>
                {rest.length > 0 && (
                  <section aria-label="Other alerts" className="space-y-3">
                    <h2 className="font-display text-xl font-semibold">Other alerts ({rest.length})</h2>
                    {rest.map((i) => <AlertCard key={i.alert.id} item={i} live={status.isLive} defaultOpen={i.alert.id === focusId} />)}
                  </section>
                )}
              </>
            ) : (
              <section className="space-y-3" aria-label="Alerts">{items.map((i) => <AlertCard key={i.alert.id} item={i} live={status.isLive} defaultOpen={i.alert.id === focusId} />)}</section>
            )}
          </div>

          <aside className="space-y-4">
            <LocationManager />
            <PushSettings />
            <section className="clay-sm p-4 text-sm" style={{ borderRadius: 22 }} aria-labelledby="lv">
              <h2 id="lv" className="font-display text-xl font-semibold">What the levels mean</h2>
              <ul className="mt-2 space-y-2">{SEVERITIES.map((s) => <li key={s} className="flex flex-wrap items-center gap-2"><SeverityBadge severity={s} /> <span>{SEVERITY_MEANING[s]}</span></li>)}</ul>
              <p className="mt-2 text-xs text-ink-600">Levels come from the source wherever it gives one. VYRA estimates are labelled as estimates and never go above Watch.</p>
            </section>
            {view && (
              <section className="clay-sm p-4 text-sm" style={{ borderRadius: 22 }} aria-labelledby="src">
                <h2 id="src" className="font-display text-xl font-semibold">Data sources</h2>
                <ul className="mt-2 space-y-1">{view.providers.map((p) => (
                  <li key={p.id}><strong>{p.name}</strong> · {p.coverage} · {p.state === 'fresh' ? `checked ${p.lastSuccessAt ? new Date(p.lastSuccessAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : ''}` : p.state === 'unconfigured' ? 'not configured' : p.state === 'disabled' ? 'switched off' : p.state === 'error' ? 'last check failed' : 'not updated recently'}</li>
                ))}</ul>
              </section>
            )}
          </aside>
        </div>
      </main>
    </div>
  )
}

export default function Page() {
  return <Suspense fallback={null}><AlertsPage /></Suspense>
}
