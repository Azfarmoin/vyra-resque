'use client'

// Satellite imagery comparison and change detection. Responders and administrators only.
// Everything on this page is ADVISORY: it never confirms an incident, closes a road, dispatches a team or changes triage.
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import SiteHeader from '@/components/common/SiteHeader'
import Icon from '@/components/ui/Icon'
import AnalysisDetail, { StateBadge } from '@/components/satellite/AnalysisDetail'
import Workbench from '@/components/satellite/Workbench'
import { formatTime } from '@/lib/client'
import { satApi, SatApiError } from '@/lib/satellite/client'
import { ADVISORY, COLLECTION_LABELS, LINK_TARGETS, type AnalysisView, type Bbox, type LinkTarget } from '@/lib/satellite/types'
import { useSession } from '@/lib/session'

export default function SatellitePage() {
  const { user, ready } = useSession()
  const isStaff = user?.role === 'admin' || user?.role === 'responder'
  const [tab, setTab] = useState<'new' | 'history'>('new')
  const [items, setItems] = useState<AnalysisView[]>([])
  const [current, setCurrent] = useState<AnalysisView | null>(null)
  const [error, setError] = useState('')
  const [start, setStart] = useState<{ bbox: Bbox | null; link: { type: LinkTarget; id: string } | null; open: string | null }>({ bbox: null, link: null, open: null })

  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const lat = Number(q.get('lat')), lng = Number(q.get('lng')), lt = q.get('linkType') as LinkTarget | null, lid = q.get('linkId')
    setStart({ bbox: Number.isFinite(lat) && Number.isFinite(lng) && q.has('lat') ? [+(lng - 0.03).toFixed(5), +(lat - 0.03).toFixed(5), +(lng + 0.03).toFixed(5), +(lat + 0.03).toFixed(5)] : null, link: lt && lid && (LINK_TARGETS as readonly string[]).includes(lt) ? { type: lt, id: lid } : null, open: q.get('id') })
  }, [])

  const reload = useCallback(() => satApi.list({ limit: 100 }).then((r) => { setItems(r.analyses); setError(''); return r.analyses }).catch((e) => { setError(e instanceof SatApiError ? e.message : 'Could not load the history.'); return [] as AnalysisView[] }), [])
  useEffect(() => { if (isStaff) reload().then((all) => { if (start.open) { const hit = all.find((a) => a.id === start.open); if (hit) { setCurrent(hit); setTab('history') } } }) }, [isStaff, reload, start.open])

  const changed = (a: AnalysisView) => { setCurrent(a); setItems((prev) => [a, ...prev.filter((x) => x.id !== a.id)]) }

  return (
    <div className="page min-h-screen">
      <SiteHeader />
      <main id="main" className="mx-auto max-w-6xl space-y-4 p-3 sm:p-5">
        <div className="clay p-5 sm:p-6">
          <h1 className="text-3xl font-semibold">Satellite imagery comparison</h1>
          <p className="mt-1 text-ink-700">Compare satellite images from two dates and see where water, vegetation and the surface may have changed.</p>
          <p className="mt-3 rounded-xl border-2 border-amber-300 bg-amber-50 p-3 text-sm font-semibold" role="note">{ADVISORY}</p>
        </div>

        {!ready ? <p className="font-semibold">Loading...</p> : !isStaff ? (
          <div className="clay p-6" role="alert"><p className="text-lg font-semibold">This tool is for responders and administrators.</p>
            <p className="mt-1">{user ? 'Your account does not have access.' : 'Please sign in with a responder or administrator account.'}</p>
            {!user && <Link href="/auth/login" className="btn-primary mt-3">Sign in</Link>}</div>
        ) : (
          <>
            <div className="flex gap-2" role="tablist" aria-label="Satellite analysis">
              <button role="tab" aria-selected={tab === 'new'} className={tab === 'new' ? 'btn-dark btn-sm' : 'btn-ghost btn-sm'} onClick={() => setTab('new')}><Icon name="plus" size={16} /> New analysis</button>
              <button role="tab" aria-selected={tab === 'history'} className={tab === 'history' ? 'btn-dark btn-sm' : 'btn-ghost btn-sm'} onClick={() => { setTab('history'); reload() }}><Icon name="clock" size={16} /> History ({items.length})</button>
            </div>
            {error && <p role="alert" className="rounded-xl bg-critical-100 p-3 font-semibold text-critical-700">{error}</p>}

            {tab === 'new' && !current && <div className="clay p-5"><Workbench initialBbox={start.bbox} onDone={(a) => { changed(a); setTab('history') }} /></div>}
            {tab === 'new' && current && <div className="clay p-5"><button className="btn-ghost btn-sm mb-3" onClick={() => setCurrent(null)}>Start another analysis</button><AnalysisDetail analysis={current} onChanged={changed} presetLink={start.link} /></div>}

            {tab === 'history' && (
              <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
                <div className="clay max-h-[75vh] space-y-2 overflow-y-auto p-3" aria-label="Saved analyses">
                  {items.length === 0 && <p className="p-2 text-sm font-semibold">No analyses yet.</p>}
                  {items.map((a) => (
                    <button key={a.id} type="button" onClick={() => setCurrent(a)} className={`block w-full rounded-xl p-3 text-left text-sm ${current?.id === a.id ? 'bg-primary-50 ring-2 ring-ink-900' : 'bg-sand-100 hover:bg-sand-200'}`}>
                      <span className="flex flex-wrap items-center gap-1.5"><StateBadge state={a.reviewState} />{a.status === 'failed' && <span className="rounded-full bg-critical-100 px-2 py-0.5 text-xs font-bold text-critical-700">Failed</span>}{a.synthetic && <span className="rounded-full bg-critical-100 px-2 py-0.5 text-xs font-bold text-critical-700">Demo</span>}</span>
                      <span className="mt-1 block font-bold">{COLLECTION_LABELS[a.collection]}</span>
                      <span className="block text-ink-700">{a.beforeRange.start || a.before?.acquiredAt.slice(0, 10)} → {a.afterRange.start || a.after?.acquiredAt.slice(0, 10)} · {a.aoi.areaKm2.toFixed(1)} km²</span>
                      <span className="block text-xs text-ink-600">{formatTime(a.createdAt)} · {a.createdByName}{a.links.length > 0 && ` · ${a.links.length} link${a.links.length > 1 ? 's' : ''}`}</span>
                    </button>
                  ))}
                </div>
                <div className="clay p-5">{current ? <AnalysisDetail analysis={current} onChanged={changed} presetLink={start.link} /> : <p className="font-semibold">Choose an analysis from the list.</p>}</div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
