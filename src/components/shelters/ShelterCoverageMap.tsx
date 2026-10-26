'use client'

// Coverage-analysis map. Loaded with next/dynamic (ssr: false). Cells are coloured by shelter access, shelters and hypothetical
// sites are markers. Clicking the map proposes a hypothetical site. Colours are paired with a legend and each cell has a text
// tooltip, so the meaning never depends on colour alone.
import { useEffect } from 'react'
import L from 'leaflet'
import { CircleMarker, MapContainer, Rectangle, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import type { CoverageResult } from '@/lib/shelters/coverage'

const COLORS = { none: '#A8433B', limited: '#E9B94D', adequate: '#43866F' } as const
const LABELS = { none: 'No shelter in reach', limited: 'Limited access', adequate: 'Adequate access' } as const

function Fit({ bounds }: { bounds: [[number, number], [number, number]] | null }) {
  const map = useMap()
  useEffect(() => { if (bounds) map.fitBounds(L.latLngBounds(bounds), { maxZoom: 13 }) }, [bounds, map])
  return null
}
function Clicker({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onPick(Number(e.latlng.lat.toFixed(5)), Number(e.latlng.lng.toFixed(5))) })
  return null
}

export interface Site { id: string; name: string; lat: number; lng: number; capacity: number }

export default function ShelterCoverageMap({ coverage, sites, onPick }: { coverage: CoverageResult | null; sites: Site[]; onPick: (lat: number, lng: number) => void }) {
  const b = coverage && coverage.cells.length ? ([[coverage.bounds.south, coverage.bounds.west], [coverage.bounds.north, coverage.bounds.east]] as [[number, number], [number, number]]) : null
  const half = (coverage?.cellM ?? 1000) / 2
  const dLat = half / 111_195
  return (
    <div>
      <MapContainer center={[24.88, 67.05]} zoom={11} style={{ height: 420, width: '100%', borderRadius: 18 }} aria-label="Shelter coverage map. Click to propose a hypothetical shelter site.">
        <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <Fit bounds={b} />
        <Clicker onPick={onPick} />
        {coverage?.cells.map((c) => {
          const dLng = half / (111_195 * Math.cos((c.lat * Math.PI) / 180))
          return (
            <Rectangle key={`${c.row}:${c.col}`} bounds={[[c.lat - dLat, c.lng - dLng], [c.lat + dLat, c.lng + dLng]]} pathOptions={{ color: COLORS[c.cls], weight: c.inHazardZone ? 2 : 0.5, dashArray: c.inHazardZone ? '4' : undefined, fillColor: COLORS[c.cls], fillOpacity: 0.35 }}>
              <Tooltip>{LABELS[c.cls]}{c.nearestMin != null ? `, nearest about ${c.nearestMin} min (estimate)` : ''}; {c.sheltersInReach} shelter(s) in reach; {c.capacityInReach} free places; {c.demandPeople} people on open reports{c.inHazardZone ? '; inside a mapped hazard zone' : ''}</Tooltip>
            </Rectangle>
          )
        })}
        {coverage?.sheltersUsed.filter((s) => !s.hypothetical).map((s) => (
          <CircleMarker key={s.id} center={[s.lat, s.lng]} radius={7} pathOptions={{ color: '#182B3A', fillColor: '#ffffff', fillOpacity: 1, weight: 3 }}><Tooltip>{s.name}: {s.available} free places</Tooltip></CircleMarker>
        ))}
        {sites.map((s) => (
          <CircleMarker key={s.id} center={[s.lat, s.lng]} radius={9} pathOptions={{ color: '#6b3fa0', fillColor: '#b79ae0', fillOpacity: 0.9, weight: 3, dashArray: '3' }}><Tooltip permanent direction="top">Hypothetical: {s.name}</Tooltip></CircleMarker>
        ))}
      </MapContainer>
      <ul className="mt-2 flex flex-wrap gap-3 text-sm" aria-label="Map legend">
        {(Object.keys(COLORS) as (keyof typeof COLORS)[]).map((k) => (
          <li key={k} className="flex items-center gap-1.5"><span aria-hidden className="inline-block h-3.5 w-3.5 rounded" style={{ background: COLORS[k], opacity: 0.6 }} />{LABELS[k]}</li>
        ))}
        <li className="flex items-center gap-1.5"><span aria-hidden className="inline-block h-3.5 w-3.5 rounded-full border-[3px] border-ink-900 bg-white" />Counted shelter</li>
        <li className="flex items-center gap-1.5"><span aria-hidden className="inline-block h-3.5 w-3.5 rounded-full border-[3px] border-dashed" style={{ borderColor: '#6b3fa0', background: '#b79ae0' }} />Hypothetical site</li>
        <li className="flex items-center gap-1.5"><span aria-hidden className="inline-block h-3.5 w-3.5 rounded border-2 border-dashed border-ink-900" />Inside a mapped hazard zone</li>
      </ul>
    </div>
  )
}
