import { PriorityBadge, StatusBadge } from '../common/Badges'
<<<<<<< HEAD
import Icon from '@/components/ui/Icon'
import { EmptyCrate } from '@/components/ui/Illustrations'
import { PRIORITY_STYLES, formatWait, shortId } from '@/lib/client'
import type { TriagedReport } from '@/lib/types'

// The ranked queue rail: one compact row per case, most urgent first.
=======
import { PRIORITY_STYLES, formatWait, shortId } from '@/lib/client'
import type { TriagedReport } from '@/lib/types'

>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
export default function TriageQueue({
  reports,
  selectedId,
  onSelect,
  loading = false,
}: {
  reports: TriagedReport[]
  selectedId: string | null
  onSelect: (id: string) => void
  loading?: boolean
}) {
<<<<<<< HEAD
  if (loading && !reports.length)
    return (
      <p className="clay-sm p-6 text-center text-sm font-semibold text-ink-600" role="status">
        Loading cases...
      </p>
    )
  if (!reports.length)
    return (
      <div className="clay-sm p-8 text-center">
        <EmptyCrate className="mx-auto h-24 w-auto" />
        <p className="mt-2 font-display text-lg font-semibold">No cases match these filters</p>
        <p className="mt-1 text-sm text-ink-600">Choose &ldquo;All&rdquo; or another status to see more cases.</p>
      </div>
    )

  return (
    <ol className="space-y-2.5" aria-label="Cases ranked by urgency, most urgent first">
      {reports.map((r, i) => {
        const on = selectedId === r.id
        const factors = r.triage.factors.slice(0, 3)
        return (
          <li key={r.id}>
            <button
              onClick={() => onSelect(r.id)}
              aria-current={on ? 'true' : undefined}
              className={`clay-sm relative w-full overflow-hidden border-2 py-3 pl-5 pr-3 text-left transition duration-200 hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${
                on ? 'border-ink-900' : 'border-transparent'
              }`}
            >
              <span aria-hidden="true" className="absolute inset-y-0 left-0 w-2" style={{ background: PRIORITY_STYLES[r.priority].color }} />
              <div className="flex items-start gap-3">
                <span className="w-5 pt-0.5 text-center font-display text-lg font-semibold leading-none text-ink-400" aria-label={`Rank ${i + 1}`}>
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <PriorityBadge priority={r.priority} small />
                    <StatusBadge status={r.status} />
                    {r.overridden && (
                      <span className="inline-flex items-center gap-1 text-xs font-bold text-ink-700">
                        <Icon name="edit" size={13} /> Changed by responder
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 truncate font-display text-lg font-semibold leading-tight">
                    {r.area} <span className="font-sans text-sm font-medium text-ink-500">#{shortId(r.id)}</span>
                  </p>
                  <p className="text-sm text-ink-700">
                    {r.people_count ? `${r.people_count} ${r.people_count === 1 ? 'person' : 'people'}` : 'People unknown'}, waiting {formatWait(r.triage.waitingMinutes)}
                    {!r.verified && <span className="ml-1.5 font-semibold text-warning-700">Not verified</span>}
                  </p>
                  <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Main reasons">
                    {factors.length ? (
                      factors.map((f) => (
                        <li key={f.key ?? f.category} className="rounded-md bg-sand-200 px-2 py-0.5 text-xs font-semibold text-ink-800">
                          {f.category}
                        </li>
                      ))
                    ) : (
                      <li className="text-xs text-ink-600">No risk factors reported</li>
                    )}
                  </ul>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <span className="text-right leading-none">
                    <span className="block font-display text-xl font-semibold">{r.triage.score}</span>
                    <span className="text-[11px] font-semibold text-ink-600">urgency</span>
                  </span>
                  {on && (
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ink-900 text-white" aria-hidden="true">
                      <Icon name="arrow" size={14} />
                    </span>
                  )}
                </div>
              </div>
              {on && <span className="sr-only">Selected</span>}
            </button>
          </li>
        )
      })}
=======
  if (loading && !reports.length) return <p className="card p-6 text-center text-sm text-gray-500">Loading cases...</p>
  if (!reports.length) return <p className="card p-6 text-center text-sm text-gray-500">No cases match these filters.</p>

  return (
    <ol className="space-y-2">
      {reports.map((r, i) => (
        <li key={r.id}>
          <button
            onClick={() => onSelect(r.id)}
            className={`w-full rounded-xl border bg-white p-3 text-left text-gray-900 shadow-sm transition hover:shadow ${
              selectedId === r.id ? `ring-2 ${PRIORITY_STYLES[r.priority].ring}` : 'border-gray-200'
            }`}
            style={{ borderLeft: `6px solid ${PRIORITY_STYLES[r.priority].color}` }}
          >
            <div className="flex items-center gap-2">
              <span className="w-6 text-xs font-semibold text-gray-400">{i + 1}</span>
              <PriorityBadge priority={r.priority} small />
              {r.overridden && <span className="text-[10px] font-semibold uppercase text-purple-700">override</span>}
              <StatusBadge status={r.status} />
              <span className="ml-auto font-mono text-xs text-gray-500">score {r.triage.score}</span>
            </div>
            <p className="mt-1.5 text-sm font-medium">
              {r.area} <span className="font-normal text-gray-500">#{shortId(r.id)}</span>
              {!r.verified && <span className="ml-1 text-xs font-normal text-amber-700">· unverified</span>}
            </p>
            <p className="text-xs text-gray-500">
              {r.people_count ? `${r.people_count} ${r.people_count === 1 ? 'person' : 'people'}` : 'people unknown'} · waiting {formatWait(r.triage.waitingMinutes)}
            </p>
            <p className="mt-1 line-clamp-2 text-xs text-gray-600">
              {r.triage.factors
                .slice(0, 3)
                .map((f) => `${f.category} (+${f.points})`)
                .join(' · ') || 'No risk factors reported'}
            </p>
          </button>
        </li>
      ))}
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
    </ol>
  )
}
