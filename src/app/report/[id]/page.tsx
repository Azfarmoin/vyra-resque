'use client'

import { useEffect, useState } from 'react'
<<<<<<< HEAD
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import SiteHeader from '@/components/common/SiteHeader'
import { PriorityBadge, StatusBadge, VerifiedBadge } from '@/components/common/Badges'
import StatusTrack from '@/components/incident/StatusTrack'
import TriageExplanation from '@/components/dashboard/TriageExplanation'
import Icon from '@/components/ui/Icon'
import { EmptyCrate } from '@/components/ui/Illustrations'
import { api, ApiError, formatTime, formatWait, shortId, type PublicReport, type ReportDetail } from '@/lib/client'

const MiniMap = dynamic(() => import('@/components/map/MiniMap'), {
  ssr: false,
  loading: () => <div className="clay-inset h-full animate-pulse" />,
})

const HISTORY_LABEL: Record<string, string> = {
  created: 'Report received',
  status: 'Status changed',
  verify: 'Verification changed',
  override: 'Priority changed by a responder',
  override_cleared: 'Priority change removed',
}

type Dispatch = { id: string; status: string; assigned_at: string; rescue_teams: { team_name: string } | null }

function Missing({ notFound }: { notFound: boolean }) {
  return (
    <div className="clay mx-auto flex max-w-lg flex-col items-center gap-3 p-10 text-center">
      <EmptyCrate className="w-40" />
      <h1 className="text-3xl font-semibold">{notFound ? 'We could not find that report' : 'This page could not load'}</h1>
      <p className="text-ink-700">
        {notFound ? 'Check the reference number or link. If you sent it a moment ago, wait a few seconds and refresh.' : 'Check your connection and refresh. If it keeps happening, try again in a minute.'}
      </p>
      <Link href="/report" className="btn-primary mt-2">Send a report</Link>
    </div>
  )
}

// Reporter view: reference number, status and what to do next. Only what the public status API exposes.
function ReporterView({ report, justSent }: { report: PublicReport; justSent: boolean }) {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {justSent && (
        <div className="rise flex items-start gap-3 rounded-3xl bg-success-100 p-5 text-success-800" role="status">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-success-700 text-white"><Icon name="check" size={22} /></span>
          <div>
            <h1 className="text-2xl font-semibold text-ink-900">The VYRA server has your report</h1>
            <p className="mt-0.5 font-semibold">Save the reference number below. Responders work through reports most urgent first; a status of New means no responder has acted on it yet.</p>
          </div>
        </div>
      )}

      <section className="rise rise-1 clay overflow-hidden" aria-labelledby="ticket-title">
        <div className="grid sm:grid-cols-[1fr_auto]">
          <div className="p-6 sm:p-8">
            {!justSent && <h1 id="ticket-title" className="text-2xl font-semibold">Report status</h1>}
            {justSent && <h2 id="ticket-title" className="sr-only">Report details</h2>}
            <p className="mt-1 font-bold text-ink-600">Reference number</p>
            <p className="font-display text-5xl font-semibold tracking-[0.12em] tabular-nums sm:text-6xl">{shortId(report.id)}</p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <StatusBadge status={report.status} />
              {report.area && <span className="inline-flex items-center gap-1.5 text-[15px] font-semibold text-ink-700"><Icon name="pin" size={16} /> {report.area}</span>}
            </div>
            <p className="mt-2 text-sm text-ink-600">Sent {formatTime(report.created_at)}. Updated {formatTime(report.updated_at)}.</p>
          </div>
          <div className="border-t-2 border-dashed border-sand-300 bg-sand-200/50 p-6 text-sm text-ink-700 sm:w-64 sm:border-l-2 sm:border-t-0">
            <p className="font-bold text-ink-900">Bookmark this page</p>
            <p className="mt-1">It refreshes by itself every 30 seconds, so you can come back to check your status.</p>
          </div>
        </div>
      </section>

      <section className="rise rise-2 clay p-6 sm:p-8" aria-labelledby="journey-title">
        <h2 id="journey-title" className="mb-5 text-2xl font-semibold">Where your report is</h2>
        <StatusTrack status={report.status} />
      </section>

      <section className="rise rise-3 clay p-6 sm:p-8">
        <h2 className="text-2xl font-semibold">While you wait</h2>
        <ul className="mt-3 space-y-3 text-[16px]">
          <li className="flex gap-3"><Icon name="home" size={20} className="mt-1 shrink-0" /> Stay somewhere as safe and high as you can.</li>
          <li className="flex gap-3"><Icon name="phone" size={20} className="mt-1 shrink-0" /> Keep your phone charged and nearby in case responders call back.</li>
          <li className="flex gap-3"><Icon name="refresh" size={20} className="mt-1 shrink-0" /> If your situation gets worse, send a new report with the new details.</li>
        </ul>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Link href="/report" className="btn-ghost">Send another report</Link>
          <Link href={`?view=responder`} className="text-sm font-bold underline decoration-2 underline-offset-4">Responder view</Link>
        </div>
              <p className="mt-4 flex flex-wrap gap-2"><Link href="/safety/now" className="btn-primary btn-sm"><Icon name="alert" size={16} /> What should I do right now?</Link><Link href="/safety" className="btn-ghost btn-sm"><Icon name="shield" size={16} /> Safety guides (work offline)</Link></p>
      </section>
    </div>
  )
}

// Responder view: the full case file from the responder API.
function ResponderView({ id }: { id: string }) {
  const [r, setR] = useState<ReportDetail | null>(null)
  const [err, setErr] = useState<ApiError | Error | null>(null)
  const [dispatches, setDispatches] = useState<Dispatch[] | null>(null)

  useEffect(() => {
    const load = () =>
      api
        .getReport(id)
        .then((x) => {
          setR(x.report)
          setErr(null)
        })
        .catch((e) => setErr(e))
    load()
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [id])

  useEffect(() => {
    fetch(`/api/dispatches?report_id=${id}`)
      .then((res) => (res.ok ? res.json() : []))
      .then(setDispatches)
      .catch(() => setDispatches([]))
  }, [id, r?.updated_at])

  if (!r) {
    if (err) return <Missing notFound={err instanceof ApiError && err.status === 404} />
    return <p className="py-20 text-center font-semibold text-ink-600" role="status">Loading the case file...</p>
  }

  return (
    <div className="space-y-5">
      <header className="rise clay p-5 sm:p-7">
        <div className="flex flex-wrap items-center gap-2">
          <PriorityBadge priority={r.priority} />
          <StatusBadge status={r.status} />
          <VerifiedBadge verified={r.verified} />
          <span className="ml-auto text-sm font-bold text-ink-500">Case #{shortId(r.id)}</span>
        </div>
        <h1 className="mt-3 text-3xl font-semibold sm:text-4xl">
          {r.area} {r.location_address && <span className="text-xl font-medium text-ink-600 sm:text-2xl">{r.location_address}</span>}
        </h1>
        <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[15px] font-semibold text-ink-700">
          <span>Received {formatTime(r.created_at)}</span>
          <span>Updated {formatTime(r.updated_at)}</span>
          <span className="inline-flex items-center gap-1"><Icon name="clock" size={16} /> waiting {formatWait(r.triage.waitingMinutes)}</span>
          <span className="inline-flex items-center gap-1"><Icon name="users" size={16} /> {r.people_count ?? 'unknown number of'} {r.people_count === 1 ? 'person' : 'people'}</span>
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-5">
          <section className="rise rise-1 clay p-1.5" style={{ borderRadius: 32 }} aria-label="Incident location">
            {r.location_lat != null && r.location_lng != null ? (
              <>
                <div className="h-72 overflow-hidden sm:h-80" style={{ borderRadius: 26 }}>
                  <MiniMap lat={r.location_lat} lng={r.location_lng} priority={r.priority} verified={r.verified} overridden={r.overridden} />
                </div>
                <p className="px-4 py-2.5 text-sm font-semibold text-ink-700">
                  {r.location_lat.toFixed(5)}, {r.location_lng.toFixed(5)} · {r.location_source === 'gps' ? `from GPS${r.location_accuracy_m ? `, about ${r.location_accuracy_m} m` : ''}` : 'selected on the map or typed'}
                </p>
              </>
            ) : (
              <p className="px-4 py-6 text-sm font-semibold text-warning-700">
                No coordinates were sent. The reporter described the location in words only (unverified): {r.location_address || r.area || 'none'}.
              </p>
            )}
          </section>

          <section className="rise rise-2 clay p-5 sm:p-7" aria-labelledby="why-title">
            <h2 id="why-title" className="mb-3 text-2xl font-semibold">Why this urgency</h2>
            <TriageExplanation report={r} />
          </section>
        </div>

        <div className="space-y-5 lg:sticky lg:top-24 lg:self-start">
          <section className="rise rise-2 clay p-5 sm:p-6" aria-labelledby="assign-title">
            <h2 id="assign-title" className="text-2xl font-semibold">Rescue assignment</h2>
            {dispatches === null ? (
              <p className="mt-3 text-ink-600" role="status">Checking assignments...</p>
            ) : dispatches.length === 0 ? (
              <p className="mt-3 text-ink-700">No team has been assigned yet.</p>
            ) : (
              <ul className="mt-3 divide-y divide-sand-200">
                {dispatches.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-3 py-3">
                    <span>
                      <span className="block font-bold">{d.rescue_teams?.team_name ?? 'Team'}</span>
                      <span className="text-sm text-ink-600">Assigned {formatTime(d.assigned_at)}</span>
                    </span>
                    <span className="pill bg-primary-100 text-primary-800">{d.status.replace(/_/g, ' ')}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href={`/dashboard?id=${r.id}`} className="btn-primary btn-sm">Open in dispatcher <Icon name="arrow" size={16} /></Link>
              <Link href="/dispatches" className="btn-ghost btn-sm">All missions</Link>
            </div>
          </section>

          <section className="rise rise-3 clay p-5 sm:p-6" aria-labelledby="updates-title">
            <h2 id="updates-title" className="mb-4 text-2xl font-semibold">Updates</h2>
            <ol className="relative space-y-4 border-l-2 border-sand-300 pl-5">
              {[...r.history].reverse().map((h) => (
                <li key={h.id} className="relative text-[15px]">
                  <span className="absolute -left-[27px] top-1.5 h-3 w-3 rounded-full border-2 border-sand-100 bg-ink-800" aria-hidden="true" />
                  <p>
                    <strong>{HISTORY_LABEL[h.action] || h.action}</strong>
                    {h.from_value != null && h.to_value != null && <span className="text-ink-700"> · {h.from_value} to {h.to_value}</span>}
                  </p>
                  {h.note && <p className="text-ink-700">{h.note}</p>}
                  <p className="text-sm text-ink-600">{formatTime(h.created_at)} · {h.actor}</p>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
      <p><Link href="?" className="text-sm font-bold underline decoration-2 underline-offset-4">Back to the reporter view</Link></p>
    </div>
  )
}

export default function ReportStatusPage({ params }: { params: { id: string } }) {
  const search = useSearchParams()
  const justSent = search.get('sent') === '1'
  const responder = search.get('view') === 'responder'
  const [report, setReport] = useState<PublicReport | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (responder) return
    const load = () =>
      api
        .publicStatus(params.id)
        .then((r) => {
          setReport(r.report)
          setFailed(false)
        })
        .catch((e) => (e instanceof ApiError && e.status === 404 ? setNotFound(true) : setFailed(true)))
    load()
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [params.id, responder])
=======
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import SiteHeader from '@/components/common/SiteHeader'
import { StatusBadge } from '@/components/common/Badges'
import { api, formatTime, shortId, type PublicReport } from '@/lib/client'

// What a reporter sees after sending: reference number and current status only.
export default function ReportStatusPage({ params }: { params: { id: string } }) {
  const justSent = useSearchParams().get('sent') === '1'
  const [report, setReport] = useState<PublicReport | null>(null)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    const load = () =>
      api
        .publicStatus(params.id)
        .then((r) => setReport(r.report))
        .catch(() => setNotFound(true))
    load()
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [params.id])
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895

  return (
    <div className="page">
      <SiteHeader />
<<<<<<< HEAD
      <main id="main" className="container-x py-8 sm:py-12">
        {responder ? (
          <ResponderView id={params.id} />
        ) : report ? (
          <ReporterView report={report} justSent={justSent} />
        ) : notFound || failed ? (
          <Missing notFound={notFound} />
        ) : (
          <p className="py-20 text-center font-semibold text-ink-600" role="status">Loading your report...</p>
=======
      <main className="mx-auto max-w-lg px-4 py-10">
        {!report ? (
          <p className="text-center text-gray-500">{notFound ? 'Report not found.' : 'Loading...'}</p>
        ) : (
          <div className="card p-6 text-center">
            {justSent && <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-2xl text-green-700">✓</div>}
            <h1 className="text-xl font-bold">{justSent ? 'Your report was received' : 'Report status'}</h1>
            <p className="mt-2 text-sm text-gray-600">Reference number</p>
            <p className="font-mono text-2xl font-bold tracking-widest">{shortId(report.id)}</p>
            <div className="mt-4 flex items-center justify-center gap-2">
              <StatusBadge status={report.status} />
              {report.area && <span className="text-sm text-gray-500">{report.area}</span>}
            </div>
            <p className="mt-2 text-xs text-gray-500">
              Sent {formatTime(report.created_at)} · updated {formatTime(report.updated_at)}
            </p>
            <div className="mt-6 space-y-2 text-left text-sm text-gray-700">
              <p>
                <strong>What happens next:</strong> responders review every report and send help to the most urgent cases first.
              </p>
              <p>Stay somewhere as safe and high as possible. Keep your phone charged and nearby in case responders call back.</p>
              <p>If your situation gets worse, send a new report with the new details.</p>
            </div>
            <Link href="/report" className="btn-ghost mt-6">Send another report</Link>
            <p className="mt-4 text-xs text-gray-400">Bookmark this page to check your status later.</p>
          </div>
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
        )}
      </main>
    </div>
  )
}
