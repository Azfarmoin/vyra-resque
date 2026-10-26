'use client'

// Expandable incident sheet for the live map: summary first, explainable factors on demand.
// Never shows contact details.
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { PriorityBadge, StatusBadge, VerifiedBadge } from '../common/Badges'
import Icon from '../ui/Icon'
import { formatWait, shortId } from '@/lib/client'
import type { TriagedReport } from '@/lib/types'

export default function IncidentSheet({ report: r, onClose }: { report: TriagedReport; onClose: () => void }) {
  const [open, setOpen] = useState(false)

  // A different case starts collapsed.
  useEffect(() => setOpen(false), [r.id])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const people = r.people_count ? `${r.people_count} ${r.people_count === 1 ? 'person' : 'people'}` : 'People: unknown'
  const reasons = r.triage.factors.map((f) => f.category).join(', ') || 'No risk factors reported'
  const maxPoints = Math.max(1, ...r.triage.factors.map((f) => f.points))

  return (
    <section
      role="region"
      aria-label={`Selected case ${shortId(r.id)}`}
      className="clay rise absolute inset-x-2 bottom-2 z-[1000] flex max-h-[70%] flex-col overflow-hidden md:inset-x-auto md:bottom-4 md:right-4 md:w-[390px] md:max-h-[calc(100%-2rem)]"
      style={{ borderRadius: 24 }}
    >
      <div className="overflow-y-auto p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <PriorityBadge priority={r.priority} small />
            <StatusBadge status={r.status} />
            {r.overridden && <span className="pill bg-sand-200 text-ink-800">Changed by a responder</span>}
          </div>
          <button type="button" onClick={onClose} className="btn-ghost btn-sm -mr-1 -mt-1 shrink-0 !px-2.5" aria-label="Close case details">
            <Icon name="close" size={18} />
          </button>
        </div>

        <h2 className="mt-2.5 font-display text-2xl font-semibold leading-tight">
          {r.area} <span className="text-base font-medium text-ink-500">#{shortId(r.id)}</span>
        </h2>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm font-semibold text-ink-700">
          <span className="inline-flex items-center gap-1"><Icon name="users" size={16} /> {people}</span>
          <span className="inline-flex items-center gap-1"><Icon name="clock" size={16} /> waiting {formatWait(r.triage.waitingMinutes)}</span>
        </p>
        {!open && <p className="mt-2 line-clamp-1 text-sm text-ink-600">{reasons}</p>}

        {open && (
          <div className="mt-3 space-y-3">
            {r.location_address && (
              <p className="flex items-start gap-1.5 text-sm text-ink-700"><Icon name="pin" size={16} className="mt-0.5 shrink-0" /> {r.location_address}</p>
            )}
            <p className="clay-inset p-3 text-sm text-ink-800">{r.triage.summary}</p>
            <div>
              <h3 className="font-display text-base font-semibold">Why this urgency</h3>
              <ul className="mt-2 space-y-2.5">
                {r.triage.factors.map((f) => (
                  <li key={f.key}>
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="font-bold">{f.category}</span>
                      <span className="font-bold tabular-nums">+{f.points}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-sand-200" aria-hidden="true">
                      <div className="status-fill h-full rounded-full bg-ink-800" style={{ width: `${(f.points / maxPoints) * 100}%` }} />
                    </div>
                    <p className="mt-1 text-xs text-ink-600">{f.detail}</p>
                  </li>
                ))}
                {!r.triage.factors.length && <li className="text-sm text-ink-600">No risk factors were reported.</li>}
              </ul>
              <p className="mt-2 text-sm font-bold">Urgency score {r.triage.score}</p>
            </div>
            {!!r.triage.unknowns.length && (
              <p className="text-sm text-ink-700">
                <span className="font-bold">Not answered:</span> {r.triage.unknowns.join(', ')}. Treated as unknown, not as safe.
              </p>
            )}
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-bold">Verification</span> <VerifiedBadge verified={r.verified} />
            </p>
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className="btn-ghost btn-sm" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            <Icon name="chevron" size={16} className={open ? 'rotate-180' : ''} />
            {open ? 'Hide explanation' : 'Show explanation'}
          </button>
          <Link href={`/dashboard?id=${r.id}`} className="btn-primary btn-sm">
            Open in dispatcher
            <Icon name="arrow" size={16} />
          </Link>
        </div>
      </div>
    </section>
  )
}
