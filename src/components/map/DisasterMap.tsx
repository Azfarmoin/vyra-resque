'use client'

// Stage 5 - Live Disaster Map. Loaded with next/dynamic (ssr: false).
<<<<<<< HEAD
import { useEffect, useMemo, useState } from 'react'
import L from 'leaflet'
import { MapContainer, TileLayer, Marker, Popup, Polyline, Polygon, Circle, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import { reportIcon, shelterIcon, teamIcon } from './markers'
import ZoneLayer, { type MapZone } from './ZoneLayer'
import { clusterPoints } from '@/lib/zones/cluster'
import { PRIORITY_LABELS } from '@/lib/constants'
import { priorityRank, shortId } from '@/lib/client'
import type { BlockedRoad, RescueTeam, Shelter, TriagedReport } from '@/lib/types'
import type { PublicAlert } from '@/lib/alerts/monitor'
import { HAZARD_TYPES, ORIGIN_LABELS, SEVERITY_LABELS } from '@/lib/alerts/types'
import { SEV_COLOR } from '@/components/alerts/AlertBits'

export type MapFocus = { center?: [number, number]; zoom?: number; fit?: boolean; bounds?: [[number, number], [number, number]]; at: number } | null
export type MapView = { bbox: [number, number, number, number]; zoom: number }
export type LayerToggles = { reports: boolean; shelters: boolean; teams: boolean; roadBlocks: boolean; alerts?: boolean }

// Reports sent with only a typed landmark have no coordinates; they appear in the queue, not on the map.
const hasCoords = (r: TriagedReport): r is TriagedReport & { location_lat: number; location_lng: number } => r.location_lat != null && r.location_lng != null
=======
import { useEffect } from 'react'
import Link from 'next/link'
import L from 'leaflet'
import { MapContainer, TileLayer, Marker, Popup, Polyline, Tooltip, useMap } from 'react-leaflet'
import { reportIcon, shelterIcon, teamIcon } from './markers'
import { PriorityBadge, StatusBadge, VerifiedBadge } from '../common/Badges'
import { formatWait, priorityRank, shortId } from '@/lib/client'
import type { BlockedRoad, RescueTeam, Shelter, TriagedReport } from '@/lib/types'

export type MapFocus = { center?: [number, number]; zoom?: number; fit?: boolean; at: number } | null
export type LayerToggles = { reports: boolean; shelters: boolean; teams: boolean; roadBlocks: boolean }
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895

function FocusController({ focus, reports }: { focus: MapFocus; reports: TriagedReport[] }) {
  const map = useMap()
  useEffect(() => {
<<<<<<< HEAD
    if (focus?.bounds) map.flyToBounds(L.latLngBounds(focus.bounds).pad(0.15), { maxZoom: 16, duration: 0.7 })
    else if (focus?.center) map.flyTo(focus.center, focus.zoom || 13, { duration: 0.7 })
    else if (focus?.fit && reports.some(hasCoords)) {
      map.fitBounds(L.latLngBounds(reports.filter(hasCoords).map((r) => [r.location_lat, r.location_lng] as [number, number])).pad(0.2), { maxZoom: 15 })
=======
    if (focus?.center) map.flyTo(focus.center, focus.zoom || 13, { duration: 0.7 })
    else if (focus?.fit && reports.length) {
      map.fitBounds(L.latLngBounds(reports.map((r) => [r.location_lat, r.location_lng] as [number, number])).pad(0.2), { maxZoom: 15 })
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
    }
  }, [focus]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

<<<<<<< HEAD
// Clicking empty map clears the selected case, or (while picking route endpoints) reports the point.
function ClearOnMapClick({ onClear, onPick }: { onClear: () => void; onPick?: (p: [number, number]) => void }) {
  useMapEvents({ click: (e) => (onPick ? onPick([e.latlng.lat, e.latlng.lng]) : onClear()) })
  return null
}

// Reports the visible area so the page can ask the server only for zones in view.
function ViewReporter({ onView }: { onView?: (v: MapView) => void }) {
  const map = useMap()
  const report = () => {
    const b = map.getBounds()
    onView?.({ bbox: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], zoom: map.getZoom() })
  }
  useEffect(report, []) // eslint-disable-line react-hooks/exhaustive-deps
  useMapEvents({ moveend: report, zoomend: report })
  return null
}

// Many cases: nearby markers collapse into numbered clusters so the map stays readable and fast. Few cases: unchanged.
function clusterIcon(n: number) {
  const size = n < 10 ? 34 : n < 100 ? 40 : 46
  return L.divIcon({ className: '', html: `<div class="zone-cluster" style="width:${size}px;height:${size}px" aria-label="${n} cases">${n}</div>`, iconSize: [size, size], iconAnchor: [size / 2, size / 2] })
}
function ReportMarkers({ reports, selectedId, onSelect }: { reports: TriagedReport[]; selectedId: string | null; onSelect?: (r: TriagedReport | null) => void }) {
  const map = useMap()
  const [zoom, setZoom] = useState(map.getZoom())
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) })
  const ordered = useMemo(() => [...reports].filter(hasCoords).sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority)), [reports])
  const { singles, clusters } = useMemo(
    () => clusterPoints(ordered.map((r) => ({ id: r.id, lat: r.location_lat, lng: r.location_lng })), zoom),
    [ordered, zoom]
  )
  // The selected case is never hidden inside a cluster.
  const singleIds = new Set(singles.map((s) => s.id))
  const byId = new Map(ordered.map((r) => [r.id, r]))
  const shown = ordered.filter((r) => singleIds.has(r.id) || r.id === selectedId)
  return (
    <>
      {clusters.map((c) => (
        <Marker
          key={`c-${c.ids[0]}-${c.count}`}
          position={[c.lat, c.lng]}
          icon={clusterIcon(c.count)}
          title={`${c.count} cases close together. Press Enter to zoom in.`}
          eventHandlers={{ click: () => map.fitBounds(L.latLngBounds(c.ids.map((id) => [byId.get(id)!.location_lat, byId.get(id)!.location_lng] as [number, number])).pad(0.3), { maxZoom: 17 }) }}
        />
      ))}
      {shown.map((r) => (
        <Marker
          key={r.id}
          position={[r.location_lat, r.location_lng]}
          icon={reportIcon(r.priority, { verified: r.verified, overridden: r.overridden, selected: r.id === selectedId })}
          zIndexOffset={r.id === selectedId ? 10000 : priorityRank(r.priority) * 100}
          title={`${PRIORITY_LABELS[r.priority]} urgency case ${shortId(r.id)} in ${r.area}. Press Enter for details.`}
          eventHandlers={{ click: () => onSelect?.(r) }}
        />
      ))}
    </>
=======
function ReportPopup({ r }: { r: TriagedReport }) {
  return (
    <div className="w-64 space-y-2 text-sm text-gray-900">
      <div className="flex flex-wrap items-center gap-1.5">
        <PriorityBadge priority={r.priority} small />
        <StatusBadge status={r.status} />
        <VerifiedBadge verified={r.verified} />
      </div>
      <p className="font-semibold">
        #{shortId(r.id)} · {r.area}
        {r.overridden && <span className="ml-1 text-xs font-normal text-purple-700">(responder override)</span>}
      </p>
      {r.location_address && <p className="text-gray-600">{r.location_address}</p>}
      <p className="text-gray-600">
        {r.people_count ? `${r.people_count} ${r.people_count === 1 ? 'person' : 'people'}` : 'People: unknown'} · waiting {formatWait(r.triage.waitingMinutes)}
      </p>
      <ul className="space-y-0.5 border-t pt-2">
        {r.triage.factors.slice(0, 3).map((f) => (
          <li key={f.key} className="flex justify-between gap-2">
            <span>{f.category}</span>
            <span className="font-mono text-gray-500">+{f.points}</span>
          </li>
        ))}
      </ul>
      <Link href={`/dashboard?id=${r.id}`} className="block rounded-md bg-primary-600 px-2 py-1.5 text-center text-xs font-semibold !text-white">
        Open case & full explanation
      </Link>
    </div>
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
  )
}

export default function DisasterMap({
  center,
  reports,
  layers,
  show,
  focus,
<<<<<<< HEAD
  selectedId = null,
  onSelect,
  onPick,
  children,
  alerts = [],
  zones = [],
  selectedZoneId = null,
  onSelectZone,
  onView,
  shelterNotes,
=======
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
}: {
  center: [number, number]
  reports: TriagedReport[]
  layers: { shelters: Shelter[]; teams: RescueTeam[]; roadBlocks: BlockedRoad[] }
  show: LayerToggles
  focus: MapFocus
<<<<<<< HEAD
  selectedId?: string | null
  onSelect?: (report: TriagedReport | null) => void
  /** When set, a map click picks a point (route origin/destination) instead of clearing the selection. */
  onPick?: (point: [number, number]) => void
  /** Extra map layers, e.g. the route-analysis overlay. */
  children?: React.ReactNode
  alerts?: PublicAlert[]
  zones?: MapZone[]
  selectedZoneId?: string | null
  onSelectZone?: (zone: MapZone | null) => void
  onView?: (v: MapView) => void
  /** Optional per-shelter note (id -> text), e.g. what a flood estimate says. Supplementary: never changes the shelter. */
  shelterNotes?: Record<string, string>
}) {

  return (
    <MapContainer center={center} zoom={11} className="h-full w-full" zoomControl={true}>
      <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <FocusController focus={focus} reports={reports} />
      <ClearOnMapClick onClear={() => { onSelect?.(null); onSelectZone?.(null) }} onPick={onPick} />
      <ViewReporter onView={onView} />
      <ZoneLayer zones={zones} selectedId={selectedZoneId} onSelect={(z) => onSelectZone?.(z)} />


      {show.alerts !== false &&
        alerts.map((a) => {
          const color = SEV_COLOR[a.severity]
          // Estimates are drawn dashed and faint so they can never be mistaken for official boundaries.
          const style = { color, weight: a.origin === 'internal_estimate' ? 1.5 : 3, fillOpacity: a.origin === 'internal_estimate' ? 0.06 : 0.16, dashArray: a.origin === 'internal_estimate' ? '4 6' : undefined }
          const popup = (
            <Popup>
              <div className="space-y-1 text-sm text-ink-900">
                <p className="font-semibold">{SEVERITY_LABELS[a.severity]}: {a.title}</p>
                <p>{HAZARD_TYPES[a.hazard_type]} · {a.affected_area || 'area not stated'}</p>
                <p className="text-xs">{ORIGIN_LABELS[a.origin]} · {a.source_name}</p>
                <p className="text-xs">Last updated {new Date(a.last_updated_at).toLocaleString()}{a.freshness.state === 'stale' ? ' · source not updating, may be out of date' : ''}</p>
                <a className="text-xs font-semibold underline" href={`/alerts?id=${a.id}`}>Details</a>
              </div>
            </Popup>
          )
          return a.areas.flatMap((ar, i) => ar.geometry.map((g, j) => {
            const key = `${a.id}-${i}-${j}`
            if (g.type === 'polygon') return <Polygon key={key} positions={g.rings} pathOptions={style}>{popup}</Polygon>
            if (g.type === 'circle') return <Circle key={key} center={g.center} radius={g.radiusKm * 1000} pathOptions={style}>{popup}</Circle>
            if (g.type === 'point') return <Circle key={key} center={g.center} radius={g.displayRadiusKm * 1000} pathOptions={{ ...style, dashArray: '2 6' }}>{popup}</Circle>
            return null
          }))
        })}

      {show.roadBlocks &&
        layers.roadBlocks.map((b) => (
          <Polyline key={b.id} positions={b.path} pathOptions={{ color: '#182B3A', weight: 7, dashArray: '8 8', opacity: 0.85 }}>
=======
}) {
  // Draw low priority first so urgent markers sit on top.
  const ordered = [...reports].sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority))

  return (
    <MapContainer center={center} zoom={11} className="h-full w-full">
      <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <FocusController focus={focus} reports={reports} />

      {show.roadBlocks &&
        layers.roadBlocks.map((b) => (
          <Polyline key={b.id} positions={b.path} pathOptions={{ color: '#111827', weight: 7, dashArray: '8 8', opacity: 0.85 }}>
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
            <Tooltip sticky>
              <strong>Blocked road</strong> - {b.description} ({b.reason})
            </Tooltip>
          </Polyline>
        ))}

      {show.shelters &&
        layers.shelters.map((s) => (
          <Marker key={s.id} position={[s.location_lat, s.location_lng]} icon={shelterIcon(s.status)}>
            <Popup>
<<<<<<< HEAD
              <div className="space-y-1 text-sm text-ink-900">
=======
              <div className="space-y-1 text-sm text-gray-900">
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
                <p className="font-semibold">{s.name}</p>
                <p>Status: <strong>{s.status}</strong></p>
                {!!s.capacity && <p>Occupancy: {s.current_occupancy ?? 0} / {s.capacity}</p>}
                {!!s.services?.length && <p>Services: {s.services.join(', ')}</p>}
<<<<<<< HEAD
                {shelterNotes?.[s.id] && <p className="rounded bg-warning-100 p-1.5 text-xs font-semibold text-warning-700">{shelterNotes[s.id]}</p>}
                <p className="text-xs font-semibold text-success-700">Verified shelter</p>
                <p className="text-xs text-ink-600">A shelter marker does not mean the area around it is safe.</p>
=======
                <p className="text-xs text-green-700">Verified shelter</p>
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
              </div>
            </Popup>
          </Marker>
        ))}

      {show.teams &&
        layers.teams.map((t) => (
          <Marker key={t.id} position={[t.current_location_lat, t.current_location_lng]} icon={teamIcon(t.team_type, t.status)}>
            <Popup>
<<<<<<< HEAD
              <div className="space-y-1 text-sm text-ink-900">
=======
              <div className="space-y-1 text-sm text-gray-900">
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
                <p className="font-semibold">{t.team_name}</p>
                {t.team_type && <p>Type: {t.team_type.replace('_', ' ')}</p>}
                {!!t.capabilities?.length && <p>Capabilities: {t.capabilities.join(', ')}</p>}
                <p>Status: <strong>{t.status}</strong></p>
              </div>
            </Popup>
          </Marker>
        ))}

<<<<<<< HEAD
      {show.reports && <ReportMarkers reports={reports} selectedId={selectedId} onSelect={onSelect} />}

      {children}
=======
      {show.reports &&
        ordered.map((r) => (
          <Marker
            key={r.id}
            position={[r.location_lat, r.location_lng]}
            icon={reportIcon(r.priority, { verified: r.verified, overridden: r.overridden })}
            zIndexOffset={priorityRank(r.priority) * 100}
          >
            <Popup>
              <ReportPopup r={r} />
            </Popup>
          </Marker>
        ))}
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
    </MapContainer>
  )
}
