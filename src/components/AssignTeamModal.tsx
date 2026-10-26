'use client'

<<<<<<< HEAD
import { useEffect, useRef, useState } from 'react'
import { authHeaders } from '@/lib/routingClient'
import { TeamMatch, CaseNeeds, capabilityLabel, resourceTypeLabel } from '@/lib/matching'
import Icon from '@/components/ui/Icon'
import { useDialog } from '@/components/ui/useDialog'
=======
import { useEffect, useState } from 'react'
import { TeamMatch, CaseNeeds, capabilityLabel, resourceTypeLabel } from '@/lib/matching'
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895

interface Resource {
  id: string
  resource_type: string
  name: string | null
  quantity: number
  team_id: string | null
  status: string
  rescue_teams?: { team_name: string } | null
}

interface Props {
  reportId: string
  reportLabel: string
  onClose: () => void
  onAssigned: () => void
}

<<<<<<< HEAD
// Fit is shown as a word and a number, with colour only as reinforcement.
const fit = (score: number) =>
  score >= 75
    ? { label: 'Strong fit', cls: 'bg-success-100 text-success-800' }
    : score >= 50
      ? { label: 'Possible fit', cls: 'bg-warning-100 text-warning-700' }
      : { label: 'Weak fit', cls: 'bg-critical-100 text-critical-700' }
=======
const scoreColor = (score: number) =>
  score >= 75 ? 'bg-green-100 text-green-800' : score >= 50 ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895

export default function AssignTeamModal({ reportId, reportLabel, onClose, onAssigned }: Props) {
  const [needs, setNeeds] = useState<CaseNeeds | null>(null)
  const [matches, setMatches] = useState<TeamMatch[]>([])
  const [resources, setResources] = useState<Resource[]>([])
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null)
  const [selectedResources, setSelectedResources] = useState<string[]>([])
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
<<<<<<< HEAD
  const dialogRef = useRef<HTMLDivElement>(null)
  useDialog(dialogRef, onClose)
=======
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const [matchRes, resourceRes] = await Promise.all([
          fetch(`/api/reports/${reportId}/matches`),
          fetch('/api/resources')
        ])
        const matchData = await matchRes.json()
        if (!matchRes.ok) throw new Error(matchData.error || 'Failed to load team suggestions')
        setNeeds(matchData.needs)
        setMatches(matchData.matches)
        if (resourceRes.ok) setResources(await resourceRes.json())
        const best = (matchData.matches as TeamMatch[]).find(m => m.eligible)
        if (best) {
          setSelectedTeam(best.team_id)
          setSelectedResources(best.suggested_resource_ids)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load team suggestions')
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [reportId])

  const selectTeam = (match: TeamMatch) => {
    if (!match.eligible) return
    setSelectedTeam(match.team_id)
    setSelectedResources(match.suggested_resource_ids)
  }

  const assign = async () => {
<<<<<<< HEAD
    if (!selectedTeam) {
      setError('Choose a team before assigning.')
      return
    }
=======
    if (!selectedTeam) return
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
    setSaving(true)
    setError('')
    try {
      const response = await fetch('/api/dispatches', {
        method: 'POST',
<<<<<<< HEAD
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
=======
        headers: { 'Content-Type': 'application/json' },
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
        body: JSON.stringify({ report_id: reportId, team_id: selectedTeam, resource_ids: selectedResources, notes })
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to assign team')
      onAssigned()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to assign team')
    } finally {
      setSaving(false)
    }
  }

  const availableResources = resources.filter(r => r.status === 'available')
  const visibleResources = availableResources.filter(r => !r.team_id || r.team_id === selectedTeam)
<<<<<<< HEAD
  const hasEligible = matches.some(m => m.eligible)

  return (
    <div
      className="fixed inset-0 z-[1300] flex items-end justify-center bg-ink-900/55 p-0 sm:items-center sm:p-4"
      onMouseDown={e => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="assign-title"
        aria-describedby="assign-case"
        tabIndex={-1}
        className="clay rise max-h-[94vh] w-full max-w-3xl overflow-y-auto rounded-b-none p-5 sm:rounded-b-[28px] sm:p-7"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="assign-title" className="text-3xl font-semibold">Assign a rescue team</h2>
            <p id="assign-case" className="mt-1 text-ink-600">{reportLabel}</p>
          </div>
          <button type="button" onClick={onClose} className="btn-ghost btn-sm shrink-0" aria-label="Close dialog">
            <Icon name="close" size={18} />
          </button>
        </div>

        <div aria-live="assertive" role="alert">
          {error && (
            <p className="field-error mt-4 rounded-2xl bg-critical-100 p-3.5">
              <Icon name="alert" size={18} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </p>
          )}
        </div>

        {loading ? (
          <p className="py-14 text-center text-ink-600" role="status">Finding the best teams…</p>
        ) : (
          <>
            {needs && (
              <section className="clay-inset mt-5 p-4 text-sm" aria-labelledby="needs-title">
                <h3 id="needs-title" className="text-lg font-semibold">What this case needs</h3>
                <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Required capabilities and supplies">
                  {needs.capabilities.map(c => (
                    <li key={c} className="pill bg-primary-100 text-primary-800">{capabilityLabel(c)}</li>
                  ))}
                  {needs.resourceTypes.map(r => (
                    <li key={r} className="pill bg-sand-200 text-ink-700">{resourceTypeLabel(r)}</li>
                  ))}
                </ul>
                <ul className="mt-3 list-disc space-y-0.5 pl-5 text-ink-700">
                  {needs.reasons.map(r => <li key={r}>{r}</li>)}
                </ul>
              </section>
            )}

            <h3 id="teams-title" className="mb-1 mt-6 text-xl font-semibold">Suggested teams</h3>
            <p className="hint mb-3">Best match first. Each score is out of 100 and the bars show why.</p>
            {matches.length === 0 ? (
              <p className="clay-inset mb-4 p-4 text-ink-700">No teams are registered yet. Add a team on the Supplies page, then come back.</p>
            ) : (
              <div role="radiogroup" aria-labelledby="teams-title" className="mb-4 space-y-3">
                {!hasEligible && (
                  <p className="rounded-2xl bg-warning-100 p-3.5 text-sm font-semibold text-ink-900">
                    No team is available right now. Teams that are busy or offline cannot be assigned.
                  </p>
                )}
                {matches.map((m, index) => {
                  const selected = selectedTeam === m.team_id
                  const f = fit(m.score)
                  return (
                    <button
                      key={m.team_id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      aria-disabled={!m.eligible}
                      onClick={() => selectTeam(m)}
                      className={`lift relative w-full rounded-[22px] border-2 p-4 text-left ${
                        selected ? 'border-ink-900 bg-primary-50' : 'border-transparent bg-white'
                      } ${m.eligible ? '' : 'cursor-not-allowed opacity-60'}`}
                      style={{ boxShadow: selected ? undefined : '0 1px 2px rgb(24 43 58 / .08), 0 8px 16px -8px rgb(24 43 58 / .2)' }}
                    >
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                        <span
                          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${selected ? 'border-ink-900 bg-ink-900 text-white' : 'border-ink-400'}`}
                          aria-hidden="true"
                        >
                          {selected && <Icon name="check" size={14} strokeWidth={3} />}
                        </span>
                        <span className="font-display text-lg font-semibold">{m.team_name}</span>
                        {index === 0 && m.eligible && (
                          <span className="pill bg-success-700 text-white"><Icon name="check" size={12} /> Recommended</span>
                        )}
                        {!m.eligible && <span className="pill bg-sand-200 text-ink-700">Unavailable: {m.team_status}</span>}
                        <span className="ml-auto flex flex-wrap items-center gap-2 text-sm">
                          {m.distance_km !== null && <span className="font-semibold text-ink-700">{m.distance_km} km away</span>}
                          <span className={`pill ${f.cls}`}>{f.label}, {m.score}/100</span>
                        </span>
                      </div>

                      <p className={`mt-2 flex items-center gap-1.5 text-sm font-semibold ${m.route.safe ? 'text-success-800' : 'text-critical-700'}`}>
                        <Icon name={m.route.safe ? 'route' : 'alert'} size={16} />
                        {m.route.safe ? 'Route is clear' : 'Route has a reported hazard'}
                      </p>

                      <ul className="mt-3 grid gap-x-5 gap-y-2.5 sm:grid-cols-2" aria-label={`Why ${m.team_name} scored ${m.score}`}>
                        {m.breakdown.map(b => (
                          <li key={b.factor} title={b.detail}>
                            <div className="flex items-baseline justify-between gap-2 text-sm">
                              <span className="font-bold">{b.factor}</span>
                              <span className="text-xs font-semibold text-ink-600">{b.points}/{b.max}</span>
                            </div>
                            <div className="mt-1 h-2 overflow-hidden rounded-full bg-sand-200" aria-hidden="true">
                              <div className="status-fill h-full rounded-full bg-ink-700" style={{ width: `${b.max ? Math.min(100, (b.points / b.max) * 100) : 0}%` }} />
                            </div>
                            <p className="mt-1 text-xs text-ink-600">{b.detail}</p>
                          </li>
                        ))}
                      </ul>

                      {m.warnings.length > 0 && (
                        <p className="mt-3 flex items-start gap-1.5 rounded-xl bg-warning-100 p-2.5 text-sm font-semibold text-ink-900">
                          <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
                          <span>{m.warnings.join(' · ')}</span>
                        </p>
                      )}
                    </button>
                  )
                })}
=======

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[60]">
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-2xl font-bold text-gray-900">Assign Rescue Team</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <p className="text-gray-600 mb-4">{reportLabel}</p>

        {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-600 text-sm">{error}</div>}

        {loading ? (
          <div className="py-12 text-center text-gray-500">Finding the best teams…</div>
        ) : (
          <>
            {needs && (
              <div className="mb-4 p-4 bg-teal-50 border border-teal-100 rounded-lg text-sm">
                <div className="font-medium text-teal-900 mb-1">What this case needs</div>
                <div className="flex flex-wrap gap-1 mb-2">
                  {needs.capabilities.map(c => (
                    <span key={c} className="px-2 py-0.5 bg-white border border-teal-200 rounded text-xs text-teal-800">
                      {capabilityLabel(c)}
                    </span>
                  ))}
                  {needs.resourceTypes.map(r => (
                    <span key={r} className="px-2 py-0.5 bg-white border border-gray-200 rounded text-xs text-gray-700">
                      {resourceTypeLabel(r)}
                    </span>
                  ))}
                </div>
                <ul className="list-disc list-inside text-teal-800 text-xs space-y-0.5">
                  {needs.reasons.map(r => <li key={r}>{r}</li>)}
                </ul>
              </div>
            )}

            <h3 className="text-sm font-semibold text-gray-700 mb-2">Suggested teams (best match first)</h3>
            {matches.length === 0 ? (
              <p className="text-gray-500 text-sm mb-4">No teams registered. Add teams on the Resources page.</p>
            ) : (
              <div className="space-y-2 mb-4">
                {matches.map((m, index) => (
                  <button
                    key={m.team_id}
                    type="button"
                    onClick={() => selectTeam(m)}
                    disabled={!m.eligible}
                    className={`w-full text-left border rounded-lg p-3 transition-colors ${
                      selectedTeam === m.team_id
                        ? 'border-teal-600 ring-2 ring-teal-200 bg-teal-50'
                        : m.eligible
                          ? 'border-gray-200 hover:border-teal-300'
                          : 'border-gray-200 bg-gray-50 opacity-60 cursor-not-allowed'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium text-gray-900">
                        {index === 0 && m.eligible && <span className="text-xs text-teal-700 mr-2">★ Recommended</span>}
                        {m.team_name}
                        {!m.eligible && <span className="ml-2 text-xs text-gray-500">({m.team_status})</span>}
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        {m.distance_km !== null && <span className="text-gray-600">{m.distance_km} km</span>}
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${m.route.safe ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                          {m.route.safe ? 'Route clear' : 'Route hazard'}
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${scoreColor(m.score)}`}>{m.score}/100</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
                      {m.breakdown.map(b => (
                        <div key={b.factor} className="text-xs text-gray-600" title={b.detail}>
                          <span className="font-medium text-gray-800">{b.factor}</span> {b.points}/{b.max}
                          <div className="text-gray-500 truncate">{b.detail}</div>
                        </div>
                      ))}
                    </div>
                    {m.warnings.length > 0 && (
                      <div className="mt-2 text-xs text-orange-700">⚠ {m.warnings.join(' · ')}</div>
                    )}
                  </button>
                ))}
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
              </div>
            )}

            {selectedTeam && (
              <>
<<<<<<< HEAD
                <h3 id="res-title" className="mb-2 text-xl font-semibold">Supplies to send</h3>
                {visibleResources.length === 0 ? (
                  <p className="clay-inset mb-4 p-4 text-sm text-ink-700">No available supplies for this team.</p>
                ) : (
                  <fieldset className="mb-4 grid gap-2 sm:grid-cols-2" aria-labelledby="res-title">
                    {visibleResources.map(r => (
                      <label key={r.id} className="chip !min-h-[48px] text-sm">
=======
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Resources to send</h3>
                {visibleResources.length === 0 ? (
                  <p className="text-gray-500 text-sm mb-4">No available resources for this team.</p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-4">
                    {visibleResources.map(r => (
                      <label key={r.id} className="flex items-center gap-2 text-sm border rounded-md p-2">
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
                        <input
                          type="checkbox"
                          checked={selectedResources.includes(r.id)}
                          onChange={e =>
                            setSelectedResources(prev =>
                              e.target.checked ? [...prev, r.id] : prev.filter(id => id !== r.id)
                            )
                          }
                        />
                        <span>
                          {resourceTypeLabel(r.resource_type)}
<<<<<<< HEAD
                          {r.name ? `, ${r.name}` : ''} ×{r.quantity}
                          <span className="block text-xs font-normal text-ink-600">{r.team_id ? 'Belongs to this team' : 'Shared pool'}</span>
                        </span>
                      </label>
                    ))}
                  </fieldset>
                )}
                <label htmlFor="assign-notes" className="label">Notes for the team (optional)</label>
                <textarea
                  id="assign-notes"
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={2}
                  placeholder="Route, access, who to call on arrival"
                  className="input mb-5"
=======
                          {r.name ? ` – ${r.name}` : ''} ×{r.quantity}
                          <span className="text-xs text-gray-500"> ({r.team_id ? 'team-owned' : 'shared pool'})</span>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={2}
                  placeholder="Notes for the team (route, access, contact…)"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mb-4 outline-none focus:ring-2 focus:ring-teal-500"
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
                />
              </>
            )}

<<<<<<< HEAD
            <div className="sticky bottom-0 -mx-5 flex flex-col-reverse gap-3 border-t border-sand-200 bg-sand-50/95 px-5 py-4 backdrop-blur sm:static sm:mx-0 sm:flex-row sm:border-0 sm:bg-transparent sm:p-0">
              <button type="button" onClick={onClose} className="btn-ghost flex-1">Cancel</button>
              <button type="button" onClick={assign} disabled={!selectedTeam || saving} className="btn-primary flex-[1.4]">
                <Icon name="check" size={18} />
                {saving ? 'Assigning…' : 'Assign team'}
              </button>
            </div>
            {!selectedTeam && matches.length > 0 && (
              <p className="hint mt-2 text-center sm:text-left">Choose an available team to continue.</p>
            )}
=======
            <div className="flex gap-3">
              <button onClick={onClose} className="flex-1 bg-gray-100 text-gray-700 py-3 rounded-lg font-semibold hover:bg-gray-200">
                Cancel
              </button>
              <button
                onClick={assign}
                disabled={!selectedTeam || saving}
                className="flex-1 bg-teal-600 text-white py-3 rounded-lg font-semibold hover:bg-teal-700 disabled:opacity-50"
              >
                {saving ? 'Assigning…' : 'Confirm Assignment'}
              </button>
            </div>
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
          </>
        )}
      </div>
    </div>
  )
}
