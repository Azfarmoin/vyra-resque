'use client'

// Map used by the zone editor: click to add boundary points, drag points to adjust them. Loaded with next/dynamic (ssr: false).
// (No drawing plugin needed: a polygon is just draggable markers, which also works with a finger on a phone.)
import L from 'leaflet'
import { useEffect } from 'react'
import { Circle, MapContainer, Marker, Polygon, Polyline, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import { toLatLng } from '@/lib/zones/geometry'
import type { Position } from '@/lib/zones/types'

export type DrawMode = 'polygon' | 'line' | 'circle' | 'point'

const vertexIcon = (n: number, first: boolean) =>
  L.divIcon({ className: '', html: `<div style="width:26px;height:26px;border-radius:50%;background:${first ? '#F47755' : '#fff'};border:3px solid #182B3A;display:grid;place-items:center;font:800 11px system-ui;color:#182B3A">${n}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] })

function Clicks({ mode, points, onChange }: { mode: DrawMode; points: Position[]; onChange: (p: Position[]) => void }) {
  useMapEvents({
    click: (e) => {
      const p: Position = [Number(e.latlng.lng.toFixed(6)), Number(e.latlng.lat.toFixed(6))]
      onChange(mode === 'circle' || mode === 'point' ? [p] : [...points, p])
    },
  })
  return null
}

function Fit({ bounds }: { bounds: [[number, number], [number, number]] | null }) {
  const map = useMap()
  useEffect(() => { if (bounds) map.fitBounds(bounds, { maxZoom: 15, padding: [30, 30] }) }, [bounds]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

export default function ZoneEditorMap({ center, mode, points, radiusM, onChange, fit, color = '#182B3A' }: {
  center: [number, number]; mode: DrawMode; points: Position[]; radiusM: number | null; onChange: (p: Position[]) => void; fit: [[number, number], [number, number]] | null; color?: string
}) {
  const ll = points.map(toLatLng)
  return (
    <MapContainer center={center} zoom={12} className="h-full w-full">
      <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <Fit bounds={fit} />
      <Clicks mode={mode} points={points} onChange={onChange} />
      {mode === 'polygon' && ll.length >= 3 && <Polygon positions={ll} pathOptions={{ color, weight: 3, fillOpacity: 0.2 }} />}
      {mode === 'polygon' && ll.length === 2 && <Polyline positions={ll} pathOptions={{ color, weight: 3, dashArray: '6 6' }} />}
      {mode === 'line' && ll.length >= 2 && <Polyline positions={ll} pathOptions={{ color, weight: 6 }} />}
      {mode === 'circle' && ll[0] && radiusM ? <Circle center={ll[0]} radius={radiusM} pathOptions={{ color, weight: 3, fillOpacity: 0.2 }} /> : null}
      {ll.map((p, i) => (
        <Marker
          key={`${i}-${points.length}`}
          position={p}
          draggable
          icon={vertexIcon(i + 1, i === 0)}
          title={mode === 'circle' ? 'Centre of the circle. Drag to move.' : `Point ${i + 1}. Drag to move.`}
          eventHandlers={{ dragend: (e) => { const m = e.target.getLatLng(); const next = [...points]; next[i] = [Number(m.lng.toFixed(6)), Number(m.lat.toFixed(6))]; onChange(next) } }}
        />
      ))}
    </MapContainer>
  )
}
