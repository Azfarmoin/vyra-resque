'use client'

import { useState } from 'react'
import Icon from '@/components/ui/Icon'
import { GUIDANCE, GUIDANCE_DISCLAIMER } from '@/lib/alerts/guidance'
import type { AlertWithMatches } from '@/lib/alerts/useAlerts'
import { HAZARD_TYPES } from '@/lib/alerts/types'
import { fmt, OriginBadge, SeverityBadge } from './AlertBits'

interface Summary { text: string; method: 'template' | 'llm'; model?: string; language: string }

export default function AlertCard({ item, live, defaultOpen = false }: { item: AlertWithMatches; live: boolean; defaultOpen?: boolean }) {
  const { alert: a, matches } = item
  const [open, setOpen] = useState(defaultOpen)
  const [summary, setSummary] = useState<Summary | null>(a.ai_summary ? { ...a.ai_summary } : null)
  const inactive = a.effective_status !== 'active'
  const g = GUIDANCE[a.hazard_type]
  const stale = a.freshness.state === 'stale'

  async function toggle() {
    const next = !open
    setOpen(next)
    if (next && !summary && live) {
      try {
        const r = await fetch(`/api/alerts/${a.id}`, { cache: 'no-store' })
        if (r.ok) setSummary((await r.json()).alert.ai_summary)
      } catch { /* the original text below is always shown anyway */ }
    }
  }

  return (
    <article className={`clay-sm p-4 sm:p-5 ${inactive ? 'opacity-80' : ''}`} style={{ borderRadius: 22 }} aria-labelledby={`t-${a.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge severity={a.severity} />
        <OriginBadge origin={a.origin} />
        {inactive && <span className="pill bg-ink-100 text-ink-800">{a.effective_status === 'expired' ? 'Expired' : a.effective_status === 'cancelled' ? 'Cancelled by the source' : 'Replaced by a newer message'}</span>}
        {stale && !inactive && <span className="pill bg-warning-100 text-warning-700">Source not updating - may be out of date</span>}
      </div>
      <h3 id={`t-${a.id}`} className="mt-2 font-display text-xl font-semibold">{a.title}</h3>
      <p className="text-sm font-semibold text-ink-700">{HAZARD_TYPES[a.hazard_type]} · {a.affected_area || 'Area not stated'}</p>

      {matches.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm" aria-label="How this relates to your places">
          {matches.map(({ location, match }) => (
            <li key={location.id} className="flex gap-2">
              <Icon name="pin" size={16} />
              <span><strong>{location.label}:</strong>{' '}
                {match.result === 'yes' ? 'inside the area' : match.result === 'possible' ? 'may be affected' : match.result === 'no' ? 'outside the published area' : 'cannot tell'}. <span className="text-ink-600">{match.note}</span></span>
            </li>
          ))}
        </ul>
      )}

      <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <div><dt className="inline font-bold">Issued: </dt><dd className="inline">{fmt(a.issued_at)}</dd></div>
        <div><dt className="inline font-bold">Last updated: </dt><dd className="inline">{fmt(a.last_updated_at)}{a.revision > 1 ? ` (revision ${a.revision})` : ''}</dd></div>
        <div><dt className="inline font-bold">Expected period: </dt><dd className="inline">{a.starts_at ? fmt(a.starts_at) : 'start not stated'} to {a.expires_at ? fmt(a.expires_at) : 'end not stated'}</dd></div>
        <div><dt className="inline font-bold">Source: </dt><dd className="inline">{a.source_name}{a.source_url && <> · <a className="underline underline-offset-2" href={a.source_url} target="_blank" rel="noopener noreferrer">original</a></>}</dd></div>
      </dl>

      <button type="button" className="btn-ghost btn-sm mt-3" aria-expanded={open} onClick={toggle}>
        <Icon name="chevron" size={16} /> {open ? 'Hide details' : 'Details, precautions and limits'}
      </button>

      {open && (
        <div className="mt-3 space-y-4 text-sm">
          {summary && (
            <section aria-label="Plain-language summary" className="rounded-xl bg-sand-100 p-3">
              <p className="mb-1 text-xs font-bold uppercase tracking-wide text-ink-600">{summary.method === 'llm' ? `AI-written summary${summary.model ? ` (${summary.model})` : ''} - check it against the original below` : 'Automatic summary of the original text (no AI)'}</p>
              <p>{summary.text}</p>
            </section>
          )}
          <section aria-label="Original text from the source">
            <h4 className="font-bold">Original text ({a.source_name})</h4>
            {a.description && <p className="mt-1 whitespace-pre-line">{a.description}</p>}
            {a.instruction && <p className="mt-2 whitespace-pre-line"><strong>Instructions from the source:</strong> {a.instruction}</p>}
            {!a.description && !a.instruction && <p className="text-ink-600">The source gave no further text.</p>}
          </section>
          <section aria-label="Limitations">
            <h4 className="font-bold">What to keep in mind</h4>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-ink-700">
              {a.origin === 'internal_estimate' && <li>This is a VYRA estimate from forecast data. It is not an official warning and may be wrong.</li>}
              {a.origin === 'observation' && <li>This records something that has already happened. It is not a prediction.</li>}
              {a.limitations.map((l) => <li key={l}>{l}</li>)}
              {!a.expires_at && <li>No expiry was given, so check whether it still applies.</li>}
              <li>The absence of an alert for a place never means that place is safe.</li>
            </ul>
          </section>
          <section aria-label="Preparedness">
            <h4 className="font-bold">Preparedness checklist</h4>
            <ul className="mt-1 list-disc space-y-1 pl-5">{g.steps.map((s) => <li key={s}>{s}</li>)}</ul>
            <p className="mt-2 text-xs text-ink-600">{GUIDANCE_DISCLAIMER}{g.reviewedAt ? ` Reviewed ${g.reviewedAt}.` : ' Review date: not yet reviewed.'}</p>
            {g.sources.length > 0 && <p className="text-xs text-ink-600">Sources: {g.sources.map((s, i) => <span key={s.url}>{i > 0 && ', '}<a className="underline" href={s.url} target="_blank" rel="noopener noreferrer">{s.title} ({s.organisation})</a></span>)}</p>}
          </section>
        </div>
      )}
    </article>
  )
}
