'use client'

// Compact banner for the dashboard, home page and map: highlights urgent active alerts for the person's saved places
// (or all urgent alerts when no place is saved), and always says whether it is showing live or saved data.
import Link from 'next/link'
import Icon from '@/components/ui/Icon'
import { severityRank } from '@/lib/alerts/types'
import { annotate, useAlerts, useSavedLocations } from '@/lib/alerts/useAlerts'
import { SeverityBadge } from './AlertBits'

export default function AlertBanner() {
  const { alerts, status, view } = useAlerts()
  const { locations } = useSavedLocations()
  if (status.mode === 'loading') return null
  const items = annotate(alerts.filter((a) => a.effective_status === 'active' && a.origin !== 'internal_estimate'), locations)
    .filter((i) => (locations.length ? i.best === 'yes' || i.best === 'possible' : true))
    .filter((i) => severityRank(i.alert.severity) >= severityRank('watch'))
    .sort((a, b) => severityRank(b.alert.severity) - severityRank(a.alert.severity))
  const urgent = items.filter((i) => severityRank(i.alert.severity) >= severityRank('warning'))
  const top = items.slice(0, 2)

  if (!items.length) {
    // Never reassure. Say what the situation actually is.
    const text = !status.isLive ? status.explanation : view?.monitoring.state === 'not_configured' ? 'Early-warning monitoring is not set up yet.' : null
    if (!text) return (
      <div className="container-x pt-3"><Link href="/alerts" className="text-sm font-semibold underline underline-offset-4">Early warnings: no active Watch, Warning or Emergency for your places in the sources VYRA checks. This is not a guarantee of safety.</Link></div>
    )
    return <div className="container-x pt-3"><p role="status" className="rounded-2xl bg-warning-100 px-4 py-2 text-sm font-semibold text-ink-900">{text} <Link href="/alerts" className="underline">Early warnings</Link></p></div>
  }
  return (
    <div className="container-x pt-3">
      <section role={urgent.length ? 'alert' : 'status'} aria-label="Early warnings" className={`rounded-2xl p-3 sm:p-4 ${urgent.length ? 'bg-critical-100' : 'bg-warning-100'}`}>
        <div className="flex flex-wrap items-center gap-2 text-sm font-bold"><Icon name="bell" size={18} /> {urgent.length ? `${urgent.length} urgent active alert${urgent.length > 1 ? 's' : ''}` : 'Active alerts'}{!status.isLive && <span className="pill bg-ink-100 text-ink-800">Saved copy, not live</span>}</div>
        <ul className="mt-2 space-y-1">{top.map((i) => (
          <li key={i.alert.id} className="flex flex-wrap items-center gap-2 text-sm"><SeverityBadge severity={i.alert.severity} /><Link href={`/alerts?id=${i.alert.id}`} className="font-semibold underline underline-offset-2">{i.alert.title}</Link><span className="text-ink-700">· {i.alert.source_name}</span></li>
        ))}</ul>
        <Link href="/alerts" className="mt-2 inline-block text-sm font-bold underline underline-offset-4">All alerts and details{items.length > top.length ? ` (${items.length})` : ''}</Link>
      </section>
    </div>
  )
}
