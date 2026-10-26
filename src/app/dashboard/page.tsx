'use client'

<<<<<<< HEAD
// Stage 6/7 - Dispatcher workspace: a ranked queue on the left, the selected incident's briefing on the right.
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import AlertBanner from '@/components/alerts/AlertBanner'
=======
import { useState, useEffect } from 'react'
import Link from 'next/link'
import AssignTeamModal from '@/components/AssignTeamModal'

interface Report {
  id: string
  location_address: string
  people_count: number
  immediate_danger: boolean
  injury_details: string | null
  medical_needs: string | null
  status: string
  priority_score: number
  created_at: string
}

interface ReportDispatch {
  id: string
  status: string
  assigned_at: string
  rescue_teams: { team_name: string } | null
}

export default function DashboardPage() {
  const [reports, setReports] = useState<Report[]>([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState('all')
  const [selectedReport, setSelectedReport] = useState<Report | null>(null)
  const [assigningReport, setAssigningReport] = useState<Report | null>(null)
  const [reportDispatches, setReportDispatches] = useState<ReportDispatch[]>([])

  useEffect(() => {
    if (!selectedReport) return setReportDispatches([])
    fetch(`/api/dispatches?report_id=${selectedReport.id}`)
      .then(res => (res.ok ? res.json() : []))
      .then(setReportDispatches)
      .catch(() => setReportDispatches([]))
  }, [selectedReport])

  useEffect(() => {
    fetchReports()
  }, [])

  const fetchReports = async () => {
    try {
      const response = await fetch('/api/reports')
      if (response.ok) {
        const data = await response.json()
        setReports(data)
      }
    } catch (error) {
      console.error('Failed to fetch reports:', error)
    } finally {
      setLoading(false)
    }
// Stage 6 - Responder triage dashboard: ranked queue + explanation + human override.
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
import SiteHeader from '@/components/common/SiteHeader'
import { DemoModeBanner, UpdatedDot } from '@/components/common/Badges'
import TriageQueue from '@/components/dashboard/TriageQueue'
import CaseDetail from '@/components/dashboard/CaseDetail'
<<<<<<< HEAD
import AssignTeamModal from '@/components/AssignTeamModal'
import { useSession } from '@/lib/session'
import Icon from '@/components/ui/Icon'
import { EmptyCrate } from '@/components/ui/Illustrations'
=======
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
import { AREAS, PRIORITIES, PRIORITY_LABELS, STATUSES, type Priority } from '@/lib/constants'
import { api, PRIORITY_STYLES, usePolledReports, type ReportDetail } from '@/lib/client'

function readActor() {
  try {
    return localStorage.getItem('vyra.actor') || ''
  } catch {
    return ''
  }
}

function Dashboard() {
  const router = useRouter()
  const selectedId = useSearchParams().get('id')
  const [area, setArea] = useState('')
  const [priority, setPriority] = useState<Priority | ''>('')
  const [status, setStatus] = useState('open')
  const [actor, setActor] = useState('')
<<<<<<< HEAD
  const { user } = useSession()
  const [selected, setSelected] = useState<ReportDetail | null>(null)
  const [assigning, setAssigning] = useState(false)
=======
  const [selected, setSelected] = useState<ReportDetail | null>(null)
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895

  const query = useMemo(() => ({ area, priority, status }), [area, priority, status])
  const { reports, summary, mode, error, loading, lastUpdated, reload } = usePolledReports(api.triageQueue, query)

<<<<<<< HEAD
  // A name typed here wins; otherwise act as the signed-in person.
  useEffect(() => setActor(readActor() || user?.full_name || ''), [user])
=======
  useEffect(() => setActor(readActor()), [])
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
  const saveActor = (v: string) => {
    setActor(v)
    try {
      localStorage.setItem('vyra.actor', v)
    } catch {
      /* storage unavailable - name just won't be remembered */
    }
  }

  // Load the selected case (with history); refresh it whenever the queue refreshes.
  const loadSelected = useCallback(() => {
    if (!selectedId) return setSelected(null)
    api
      .getReport(selectedId)
      .then((r) => setSelected(r.report))
      .catch(() => setSelected(null))
  }, [selectedId])
  useEffect(loadSelected, [loadSelected, lastUpdated])

  const select = (id: string | null) => router.push(id ? `/dashboard?id=${id}` : '/dashboard', { scroll: false })
<<<<<<< HEAD
  const total = summary?.total ?? 0

  return (
    <div className="page">
      <SiteHeader />
      <AlertBanner />
      <DemoModeBanner mode={mode} />
      <main id="main" className="container-x py-5">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div>
            <h1 className="text-3xl font-semibold sm:text-4xl">Dispatcher workspace</h1>
            <p className="text-ink-700">Cases are ranked by urgency, with the reasons shown. You make the final call.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <UpdatedDot at={lastUpdated} error={error} />
            <label className="flex items-center gap-2 text-sm font-bold" htmlFor="actor">
              Acting as
              <input id="actor" className="input !w-44 !py-2" value={actor} onChange={(e) => saveActor(e.target.value)} placeholder="Your name" autoComplete="name" />
=======

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/" className="text-gray-600 hover:text-gray-900">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
              </Link>
              <h1 className="text-2xl font-bold text-gray-900">Responder Dashboard</h1>
            </div>
            <div className="flex items-center gap-4">
              <Link href="/map" className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors">
                View Map
              </Link>
              <Link href="/dispatches" className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors">
                Dispatches
              </Link>
              <Link href="/resources" className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors">
                Resources
              </Link>
            </div>
    <div className="page">
      <SiteHeader />
      <DemoModeBanner mode={mode} />
      <main className="mx-auto max-w-7xl px-4 py-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Triage dashboard</h1>
            <p className="text-sm text-gray-600">Suggested priorities with the reasons behind them. You make the final call.</p>
          </div>
          <div className="flex items-center gap-3">
            <UpdatedDot at={lastUpdated} error={error} />
            <label className="text-sm text-gray-600">
              Acting as{' '}
              <input className="input inline-block w-40 py-1" value={actor} onChange={(e) => saveActor(e.target.value)} placeholder="Your name" />
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
            </label>
          </div>
        </div>

<<<<<<< HEAD
        {/* Filters: urgency doubles as the legend and shows how the queue is made up */}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="clay-inset flex flex-wrap gap-1 p-1" role="group" aria-label="Filter by urgency" style={{ borderRadius: 20 }}>
            <button type="button" aria-pressed={priority === ''} onClick={() => setPriority('')} className={`rounded-2xl px-3.5 py-2 text-sm font-bold ${priority === '' ? 'clay-sm' : 'text-ink-600'}`}>
              All <span className="tabular-nums text-ink-600">{total}</span>
            </button>
            {PRIORITIES.map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={priority === p}
                onClick={() => setPriority(priority === p ? '' : p)}
                className={`flex items-center gap-2 rounded-2xl px-3.5 py-2 text-sm font-bold ${priority === p ? 'clay-sm' : 'text-ink-600'}`}
              >
                <span className="h-3 w-3 rounded-full border border-ink-900/25" style={{ background: PRIORITY_STYLES[p].color }} aria-hidden="true" />
                {PRIORITY_LABELS[p]} <span className="tabular-nums">{summary?.byPriority[p] ?? 0}</span>
              </button>
            ))}
          </div>
          <select className="input !w-44" value={area} onChange={(e) => setArea(e.target.value)} aria-label="Area">
=======
        {summary && (
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-6">
            {PRIORITIES.map((p) => (
              <button
                key={p}
                onClick={() => setPriority(priority === p ? '' : p)}
                className={`card p-3 text-left ${priority === p ? 'ring-2 ring-gray-800' : ''}`}
                style={{ borderTop: `4px solid ${PRIORITY_STYLES[p].color}` }}
              >
                <p className="text-xs uppercase text-gray-500">{PRIORITY_LABELS[p]}</p>
                <p className="text-2xl font-bold">{summary.byPriority[p]}</p>
              </button>
            ))}
            <div className="card p-3">
              <p className="text-xs uppercase text-gray-500">Unverified</p>
              <p className="text-2xl font-bold text-amber-700">{summary.unverified}</p>
            </div>
            <div className="card p-3">
              <p className="text-xs uppercase text-gray-500">Overridden</p>
              <p className="text-2xl font-bold text-purple-700">{summary.overridden}</p>
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <select className="input w-44" value={area} onChange={(e) => setArea(e.target.value)} aria-label="Area">
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
            <option value="">All areas</option>
            {AREAS.map((a) => (
              <option key={a.name} value={a.name}>{a.name}</option>
            ))}
            <option value="Unassigned">Unassigned</option>
          </select>
<<<<<<< HEAD
          <select className="input !w-44" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
=======
          <select className="input w-44" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
            <option value="open">Open cases</option>
            <option value="">All statuses</option>
            {Object.entries(STATUSES).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
<<<<<<< HEAD
          {summary && (
            <p className="text-sm font-semibold text-ink-600">
              {summary.unverified} not verified, {summary.overridden} changed by a responder
            </p>
          )}
        </div>
        {error && <p className="field-error mt-3" role="alert"><Icon name="alert" size={16} className="mt-0.5 shrink-0" /> {error.message}</p>}

        {/* The desk: both panes scroll on their own so the queue never loses its place */}
        <div className="mt-4 grid gap-5 lg:h-[calc(100vh-17rem)] lg:min-h-[480px] lg:grid-cols-[minmax(340px,420px)_minmax(0,1fr)]">
          <section aria-label="Case queue" className={`min-h-0 overflow-y-auto pb-6 pr-1 ${selectedId ? 'hidden lg:block' : ''}`}>
            <TriageQueue reports={reports} selectedId={selectedId} onSelect={select} loading={loading} />
          </section>
          <section aria-label="Selected case" className="min-h-0 overflow-y-auto pb-6">
            {selected ? (
              <>
                <button className="btn-ghost btn-sm mb-3 lg:hidden" onClick={() => select(null)}>
                  <Icon name="arrow" size={16} className="rotate-180" /> Back to queue
                </button>
                <CaseDetail
                  report={selected}
                  actor={actor.trim() || 'responder'}
                  onAssign={() => setAssigning(true)}
=======
          <select className="input w-40" value={priority} onChange={(e) => setPriority(e.target.value as Priority | '')} aria-label="Priority">
            <option value="">All priorities</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
            ))}
          </select>
        </div>

        {/* Reports Table */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Priority
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Location
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    People
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Time
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredReports.map((report: Report) => (
                  <tr key={report.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium border ${getPriorityColor(report.priority_score)}`}>
                        {report.priority_score}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {report.location_address}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {report.people_count}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(report.status)}`}>
                        {report.status.charAt(0).toUpperCase() + report.status.slice(1)}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(report.created_at).toLocaleTimeString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <button
                        onClick={() => setSelectedReport(report)}
                        className="text-teal-600 hover:text-teal-900 font-medium"
                      >
                        View Details
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Report Detail Modal */}
      {selectedReport && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-2xl font-bold text-gray-900">Report Details</h2>
                <button
                  onClick={() => setSelectedReport(null)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium text-gray-500">Location</label>
                  <p className="text-gray-900">{selectedReport.location_address}</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-gray-500">People Affected</label>
                    <p className="text-gray-900">{selectedReport.people_count}</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-500">Priority Score</label>
                    <p className="text-gray-900">{selectedReport.priority_score}</p>
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-500">Immediate Danger</label>
                  <p className="text-gray-900">
                    {selectedReport.immediate_danger ? 'Yes' : 'No'}
                  </p>
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-500">Injury Details</label>
                  <p className="text-gray-900">{selectedReport.injury_details || 'None reported'}</p>
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-500">Medical Needs</label>
                  <p className="text-gray-900">{selectedReport.medical_needs || 'None reported'}</p>
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-500">Status</label>
                  <p className="text-gray-900">
                    {selectedReport.status.charAt(0).toUpperCase() + selectedReport.status.slice(1)}
                  </p>
                </div>

                <div className="pt-4 border-t">
                  <label className="text-sm font-medium text-gray-500 mb-2 block">Update Status</label>
                  <div className="flex gap-2">
                    {['pending', 'investigating', 'assigned', 'resolved'].map(status => (
                      <button
                        key={status}
                        onClick={() => updateReportStatus(selectedReport.id, status)}
                        className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                          selectedReport.status === status
                            ? 'bg-teal-600 text-white'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                      >
                        {status.charAt(0).toUpperCase() + status.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="pt-4 border-t">
                  <label className="text-sm font-medium text-gray-500 mb-2 block">Team Assignments</label>
                  {reportDispatches.length === 0 ? (
                    <p className="text-sm text-gray-500 mb-3">No team assigned yet.</p>
                  ) : (
                    <ul className="space-y-1 mb-3">
                      {reportDispatches.map(d => (
                        <li key={d.id} className="text-sm text-gray-800 flex justify-between">
                          <span>{d.rescue_teams?.team_name ?? 'Team'} · {new Date(d.assigned_at).toLocaleTimeString()}</span>
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                            {d.status.replace('_', ' ')}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={() => setAssigningReport(selectedReport)}
                      disabled={selectedReport.status === 'resolved'}
                      className="flex-1 bg-teal-600 text-white py-3 rounded-lg font-semibold hover:bg-teal-700 transition-colors disabled:opacity-50"
                    >
                      Assign Rescue Team
                    </button>
                    {reportDispatches.length > 0 && (
                      <Link
                        href="/dispatches"
                        className="px-4 py-3 bg-gray-100 text-gray-700 rounded-lg font-semibold hover:bg-gray-200 transition-colors"
                      >
                        Track
                      </Link>
                    )}
                  </div>
                </div>
        {error && <p className="mt-3 rounded bg-red-50 p-2 text-sm text-red-700">{error.message}</p>}

        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <section className={selectedId ? 'hidden lg:block' : ''}>
            <TriageQueue reports={reports} selectedId={selectedId} onSelect={select} loading={loading} />
          </section>
          <section>
            {selected ? (
              <>
                <button className="btn-ghost mb-3 lg:hidden" onClick={() => select(null)}>← Back to queue</button>
                <CaseDetail
                  report={selected}
                  actor={actor.trim() || 'responder'}
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
                  onChange={(updated) => {
                    setSelected(updated)
                    reload()
                  }}
                />
              </>
            ) : (
<<<<<<< HEAD
              <div className="clay hidden h-full flex-col items-center justify-center gap-4 p-10 text-center lg:flex">
                <EmptyCrate className="w-44" />
                <h2 className="text-2xl font-semibold">{selectedId ? 'Loading the case...' : 'Pick a case from the queue'}</h2>
                <p className="max-w-sm text-ink-700">The case opens here with the reasons for its ranking, quick actions and its full history.</p>
=======
              <div className="card hidden p-8 text-center text-sm text-gray-500 lg:block">
                {selectedId ? 'Loading case...' : 'Select a case to see why it was ranked and to take action.'}
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
              </div>
            )}
          </section>
        </div>
<<<<<<< HEAD
      </main>

      {assigning && selected && (
        <AssignTeamModal
          reportId={selected.id}
          reportLabel={`${selected.location_address || selected.area || 'Unknown location'} · ${selected.people_count ?? '?'} people · ${PRIORITY_LABELS[selected.priority]}`}
          onClose={() => setAssigning(false)}
          onAssigned={() => {
            setAssigning(false)
            loadSelected()
            reload()
          }}
        />
      )}
=======
      )}
      {assigningReport && (
        <AssignTeamModal
          reportId={assigningReport.id}
          reportLabel={`${assigningReport.location_address} · ${assigningReport.people_count} people · priority ${assigningReport.priority_score}`}
          onClose={() => setAssigningReport(null)}
          onAssigned={async () => {
            setAssigningReport(null)
            setSelectedReport(null)
            await fetchReports()
          }}
        />
      )}
      </main>
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
    </div>
  )
}

export default function DashboardPage() {
  return (
    <Suspense>
      <Dashboard />
    </Suspense>
  )
}
