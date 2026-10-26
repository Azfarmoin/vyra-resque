'use client'

import { AREAS, PRIORITIES, PRIORITY_LABELS, STATUSES, type Priority } from '@/lib/constants'
import { PRIORITY_STYLES } from '@/lib/client'
import type { ReportSummary } from '@/lib/types'
import type { LayerToggles } from './DisasterMap'
<<<<<<< HEAD
import Icon from '../ui/Icon'

export type MapFilterState = { area: string; status: string; priority: Priority[]; verified: '' | 'true' }

const GLYPH: Record<Priority, string> = { critical: '!', high: 'H', medium: 'M', low: 'L' }

function Toggle({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="flex min-h-[40px] cursor-pointer items-center gap-2.5 rounded-xl px-1 py-1.5 text-sm font-semibold hover:bg-sand-200/60">
      <input type="checkbox" className="h-[18px] w-[18px] shrink-0 accent-ink-900" checked={checked} onChange={(e) => onChange(e.target.checked)} />
=======

export type MapFilterState = { area: string; status: string; priority: Priority[]; verified: '' | 'true' }

function Toggle({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 py-1 text-sm">
      <input type="checkbox" className="h-4 w-4 accent-teal-600" checked={checked} onChange={(e) => onChange(e.target.checked)} />
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
      {children}
    </label>
  )
}

<<<<<<< HEAD
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-1">
      <legend className="mb-1 font-display text-base font-semibold">{title}</legend>
      {children}
    </fieldset>
  )
}

function Legend() {
  const dot = (p: Priority, extra = '') => (
    <span
      className={`vyra-marker ${extra}`}
      style={{ width: PRIORITY_STYLES[p].size * 0.8, height: PRIORITY_STYLES[p].size * 0.8, background: PRIORITY_STYLES[p].color, color: p === 'low' ? '#fff' : '#182B3A', fontSize: 10 }}
    >
      {GLYPH[p]}
    </span>
  )
  return (
    <div className="clay-inset space-y-2 p-3 text-xs text-ink-700">
      <p className="font-display text-sm font-semibold text-ink-900">How to read the map</p>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {PRIORITIES.map((p) => (
          <span key={p} className="inline-flex items-center gap-1 font-semibold">
            {dot(p)} {PRIORITY_LABELS[p]}
          </span>
        ))}
      </p>
      <p>Bigger markers are more urgent. Critical markers pulse gently.</p>
      <p className="flex items-center gap-2">
        <span className="vyra-marker unverified" style={{ width: 18, height: 18, background: '#E9B94D' }} /> Dashed edge: not verified yet
      </p>
      <p><strong>*</strong> after the letter: urgency was set by a responder.</p>
      <p className="flex items-center gap-2">
        <span className="inline-block w-6 border-t-4 border-dashed border-ink-900" /> Blocked road
      </p>
    </div>
  )
}

=======
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
export default function MapFilters({
  filters,
  setFilters,
  show,
  setShow,
  summary,
  layerCounts,
}: {
  filters: MapFilterState
  setFilters: React.Dispatch<React.SetStateAction<MapFilterState>>
  show: LayerToggles
  setShow: React.Dispatch<React.SetStateAction<LayerToggles>>
  summary: ReportSummary | null
<<<<<<< HEAD
  layerCounts: { shelters: number; teams: number; roadBlocks: number; alerts?: number; alertsLive?: boolean }
=======
  layerCounts: { shelters: number; teams: number; roadBlocks: number }
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
}) {
  const update = (patch: Partial<MapFilterState>) => setFilters((f) => ({ ...f, ...patch }))
  const togglePriority = (p: Priority) =>
    update({ priority: filters.priority.includes(p) ? filters.priority.filter((x) => x !== p) : [...filters.priority, p] })
  const layer = (k: keyof LayerToggles) => (v: boolean) => setShow((s) => ({ ...s, [k]: v }))
<<<<<<< HEAD
  const count = (n: number | string | undefined) => <span className="ml-auto rounded-full bg-sand-200 px-2 text-xs font-bold tabular-nums text-ink-700">{n ?? ''}</span>

  return (
    <div className="space-y-5 text-sm">
      <div className="grid gap-3">
        <div>
          <label className="label" htmlFor="map-area">Area</label>
          <select id="map-area" className="input" value={filters.area} onChange={(e) => update({ area: e.target.value })}>
            <option value="">All areas</option>
            {AREAS.map((a) => (
              <option key={a.name} value={a.name}>{a.name}</option>
            ))}
            <option value="Unassigned">Unassigned</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="map-status">Status</label>
          <select id="map-status" className="input" value={filters.status} onChange={(e) => update({ status: e.target.value })}>
            <option value="open">Open cases (new, investigating, assigned)</option>
            <option value="">All statuses</option>
            {Object.entries(STATUSES).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
      </div>

      <Group title="Urgency">
        <div className="grid grid-cols-2 gap-2">
          {PRIORITIES.map((p) => (
            <label key={p} className="chip !min-h-[46px] !gap-2 !px-3 !py-2 text-sm">
              <input type="checkbox" checked={filters.priority.includes(p)} onChange={() => togglePriority(p)} />
              <span className="inline-block h-3 w-3 rounded-full border border-ink-900/30" style={{ background: PRIORITY_STYLES[p].color }} aria-hidden="true" />
              {PRIORITY_LABELS[p]}
              {count(summary?.byPriority[p])}
            </label>
          ))}
        </div>
        <Toggle checked={filters.verified === 'true'} onChange={(v) => update({ verified: v ? 'true' : '' })}>
          <Icon name="shield" size={16} /> Verified reports only
        </Toggle>
      </Group>

      <Group title="Layers">
        <Toggle checked={show.alerts !== false} onChange={layer('alerts')}>
          <Icon name="bell" size={16} /> Early warnings {count(layerCounts.alerts)}
        </Toggle>
        {layerCounts.alertsLive === false && <p className="px-1 text-xs font-semibold text-warning-700">Warnings shown are a saved copy, not live.</p>}
        <Toggle checked={show.reports} onChange={layer('reports')}>
          <Icon name="alert" size={16} /> Emergency reports
        </Toggle>
        <Toggle checked={show.shelters} onChange={layer('shelters')}>
          <Icon name="home" size={16} /> Shelters {count(layerCounts.shelters)}
        </Toggle>
        <Toggle checked={show.teams} onChange={layer('teams')}>
          <Icon name="boat" size={16} /> Rescue teams {count(layerCounts.teams)}
        </Toggle>
        <Toggle checked={show.roadBlocks} onChange={layer('roadBlocks')}>
          <Icon name="road" size={16} /> Blocked roads {count(layerCounts.roadBlocks)}
        </Toggle>
        <p className="px-1 text-xs text-ink-600">Only verified shelters, teams and road blocks are shown.</p>
      </Group>

      <Legend />
=======

  return (
    <div className="space-y-5 text-sm">
      <div>
        <label className="label" htmlFor="map-area">Area</label>
        <select id="map-area" className="input" value={filters.area} onChange={(e) => update({ area: e.target.value })}>
          <option value="">All areas</option>
          {AREAS.map((a) => (
            <option key={a.name} value={a.name}>{a.name}</option>
          ))}
          <option value="Unassigned">Unassigned</option>
        </select>
      </div>

      <div>
        <label className="label" htmlFor="map-status">Status</label>
        <select id="map-status" className="input" value={filters.status} onChange={(e) => update({ status: e.target.value })}>
          <option value="open">Open cases (new, investigating, assigned)</option>
          <option value="">All statuses</option>
          {Object.entries(STATUSES).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>

      <div>
        <p className="label">Urgency</p>
        {PRIORITIES.map((p) => (
          <Toggle key={p} checked={filters.priority.includes(p)} onChange={() => togglePriority(p)}>
            <span className="inline-block h-3 w-3 rounded-full" style={{ background: PRIORITY_STYLES[p].color }} />
            {PRIORITY_LABELS[p]}
            <span className="ml-auto text-xs text-gray-500">{summary?.byPriority[p] ?? ''}</span>
          </Toggle>
        ))}
        <Toggle checked={filters.verified === 'true'} onChange={(v) => update({ verified: v ? 'true' : '' })}>
          Verified reports only
        </Toggle>
      </div>

      <div>
        <p className="label">Layers</p>
        <Toggle checked={show.reports} onChange={layer('reports')}>Emergency reports</Toggle>
        <Toggle checked={show.shelters} onChange={layer('shelters')}>
          🏠 Shelters <span className="ml-auto text-xs text-gray-500">{layerCounts.shelters}</span>
        </Toggle>
        <Toggle checked={show.teams} onChange={layer('teams')}>
          🚤 Rescue teams <span className="ml-auto text-xs text-gray-500">{layerCounts.teams}</span>
        </Toggle>
        <Toggle checked={show.roadBlocks} onChange={layer('roadBlocks')}>
          <span className="inline-block w-5 border-t-4 border-dashed border-gray-900" /> Blocked roads
          <span className="ml-auto text-xs text-gray-500">{layerCounts.roadBlocks}</span>
        </Toggle>
        <p className="mt-1 text-xs text-gray-500">Only verified shelters, teams and road blocks are shown.</p>
      </div>

      <div className="rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
        <p className="mb-1 font-semibold text-gray-700">Legend</p>
        <p>Bigger, redder markers = more urgent. Pulsing <strong>!</strong> = critical.</p>
        <p>Dashed border = report not yet verified. <strong>*</strong> = priority set by a responder.</p>
      </div>
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
    </div>
  )
}
