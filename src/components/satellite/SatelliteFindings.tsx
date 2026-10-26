'use client'
// Read-only list of satellite findings linked to one incident report, hazard or zone, shown to responders and administrators.
// Shows the review state so nobody mistakes an unreviewed finding for confirmation. It never edits the record it sits in.
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { formatTime } from '@/lib/client'
import { satApi } from '@/lib/satellite/client'
import { REVIEW_LABELS, type AnalysisView, type LinkTarget } from '@/lib/satellite/types'
import { useSession } from '@/lib/session'
import { StateBadge } from './AnalysisDetail'

export default function SatelliteFindings({ targetType, targetId, lat, lng }: { targetType: LinkTarget; targetId: string; lat?: number | null; lng?: number | null }) {
  const { user } = useSession()
  const isStaff = user?.role === 'admin' || user?.role === 'responder'
  const [items, setItems] = useState<AnalysisView[] | null>(null)
  useEffect(() => { if (!isStaff) return; let alive = true; setItems(null); satApi.list({ targetType, targetId }).then((r) => alive && setItems(r.analyses)).catch(() => alive && setItems([])); return () => { alive = false } }, [isStaff, targetType, targetId])
  if (!isStaff) return null
  const q = new URLSearchParams({ linkType: targetType, linkId: targetId, ...(lat != null && lng != null ? { lat: String(lat), lng: String(lng) } : {}) })
  return (
    <section className="clay p-5" aria-label="Satellite findings">
      <h3 className="mb-1 text-xl font-semibold">Satellite findings (advisory)</h3>
      <p className="mb-2 text-xs text-ink-600">Possible surface change seen from space. Not proof of an emergency, and it has not changed this record&apos;s status, priority or verification.</p>
      {items === null ? <p className="text-sm">Checking...</p> : items.length === 0 ? <p className="text-sm font-semibold">No satellite analysis is linked here.</p> : (
        <ul className="space-y-1.5 text-sm">
          {items.map((a) => <li key={a.id} className="rounded-lg bg-sand-100 p-2"><StateBadge state={a.reviewState} /> <Link className="font-bold underline" href={`/satellite?id=${a.id}`}>{a.beforeRange.start || a.before?.acquiredAt.slice(0, 10)} → {a.afterRange.start || a.after?.acquiredAt.slice(0, 10)}</Link>{a.synthetic && <b className="ml-1 text-critical-700">DEMO</b>} · {formatTime(a.createdAt)}<span className="block text-xs text-ink-600">{a.reviewState === 'needs_review' ? 'Waiting for a reviewer.' : REVIEW_LABELS[a.reviewState]}</span></li>)}
        </ul>
      )}
      <Link href={`/satellite?${q}`} className="btn-ghost btn-sm mt-3">Compare satellite imagery here</Link>
    </section>
  )
}
