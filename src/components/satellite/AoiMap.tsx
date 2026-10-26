'use client'
// Pick the area of interest: click two opposite corners, or use what the map currently shows.
import { useState } from 'react'
import { MapContainer, Rectangle, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import type { Bbox } from '@/lib/satellite/types'

function Picker({ bbox, onChange }: { bbox: Bbox | null; onChange: (b: Bbox | null) => void }) {
  const [a, setA] = useState<[number, number] | null>(null)
  useMapEvents({
    click(e) {
      const p: [number, number] = [Number(e.latlng.lng.toFixed(5)), Number(e.latlng.lat.toFixed(5))]
      if (!a) { setA(p); onChange(null); return }
      onChange([Math.min(a[0], p[0]), Math.min(a[1], p[1]), Math.max(a[0], p[0]), Math.max(a[1], p[1])])
      setA(null)
    },
  })
  return bbox ? <Rectangle bounds={[[bbox[1], bbox[0]], [bbox[3], bbox[2]]]} pathOptions={{ color: '#182B3A', weight: 3, fillColor: '#F47755', fillOpacity: 0.15 }} /> : null
}
function UseView({ onChange }: { onChange: (b: Bbox) => void }) {
  const map = useMap()
  return (
    <div className="absolute right-3 top-3 z-[1000]">
      <button type="button" className="btn-ghost btn-sm clay-sm" onClick={() => { const b = map.getBounds().pad(-0.3); onChange([+b.getWest().toFixed(5), +b.getSouth().toFixed(5), +b.getEast().toFixed(5), +b.getNorth().toFixed(5)]) }}>Use the middle of this view</button>
    </div>
  )
}
export default function AoiMap({ bbox, onChange, center }: { bbox: Bbox | null; onChange: (b: Bbox | null) => void; center: [number, number] }) {
  return (
    <MapContainer center={center} zoom={11} className="h-full w-full" scrollWheelZoom>
      <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <Picker bbox={bbox} onChange={onChange} />
      <UseView onChange={onChange} />
    </MapContainer>
  )
}
