'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { PriorityBadge } from '@/components/common/Badges'
import Icon from '@/components/ui/Icon'
import { EmptyCrate } from '@/components/ui/Illustrations'
import { api, formatWait, priorityRank, type ListResponse } from '@/lib/client'

// Restrained public preview of the real open-case feed.
// Shows only area, urgency, people count and waiting time: never addresses or contact details.
export default function IncidentPreview() {
  const [data, setData] = useState<ListResponse | null>(null)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    setLoading(true)
    setError(false)
    api
      .listReports({ status: 'open' })
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const top = (data?.reports || [])
    .slice()
    .sort((a, b) => priorityRank(b.priority) - priorityRank(a.priority) || b.triage.score - a.triage.score)
    .slice(0, 3)

  return (
    <div>
      <div className="clay p-4 sm:p-6" aria-busy={loading}>
        {loading && !data ? (
          <ul className="space-y-3" aria-label="Loading cases">
            {[0, 1, 2].map((i) => (
              <li key={i} className="clay-inset h-[84px] animate-pulse motion-reduce:animate-none" />
            ))}
          </ul>
        ) : error ? (
          <div className="flex flex-col items-start gap-3 py-4" role="alert">
            <p className="font-display text-xl font-semibold">The case feed did not load</p>
            <p className="hint">Check your connection and try again. Nothing was changed.</p>
            <button type="button" className="btn-ghost btn-sm" onClick={load}>
              <Icon name="refresh" size={16} /> Try again
            </button>
          </div>
        ) : !top.length ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <EmptyCrate className="h-28 w-auto" />
            <p className="font-display text-xl font-semibold">No open cases right now</p>
            <p className="hint max-w-xs">New reports appear here as soon as they are sent.</p>
          </div>
        ) : (
          <ol className="space-y-3">
            {top.map((r, i) => (
              <li key={r.id} className="clay-sm flex items-center gap-4 p-4" style={{ borderLeft: '8px solid transparent', borderImage: 'none' }}>
                <span className="font-display text-3xl font-semibold leading-none text-ink-300" aria-hidden="true">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display text-lg font-semibold leading-tight">{r.area || 'Area not set'}</p>
                  <p className="text-sm text-ink-600">
                    {r.people_count ? `${r.people_count} ${r.people_count === 1 ? 'person' : 'people'}` : 'Number of people unknown'}
                    {', waiting '}
                    {formatWait(r.triage.waitingMinutes) || 'just now'}
                  </p>
                </div>
                <PriorityBadge priority={r.priority} small />
              </li>
            ))}
          </ol>
        )}
      </div>
      <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-sm text-ink-600" role="status">
        <span className={`h-2.5 w-2.5 rounded-full ${error ? 'bg-critical' : data ? 'bg-success' : 'bg-ink-300'}`} aria-hidden="true" />
        {error
          ? 'Feed unavailable.'
          : !data
            ? 'Loading the case feed.'
            : data.mode === 'demo'
              ? 'Demo data: simulated cases, not real reports.'
              : 'Live data from the open case feed.'}
        <Link href="/dashboard" className="font-bold text-ink-900 underline decoration-primary-500 decoration-2 underline-offset-4">
          Open the dispatcher workspace
        </Link>
      </p>
    </div>
  )
}
