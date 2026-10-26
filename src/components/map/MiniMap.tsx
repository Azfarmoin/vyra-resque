'use client'

// Single-incident map for the case file. Loaded with next/dynamic (ssr: false). Shows the pin only, never contact details.
import { MapContainer, TileLayer, Marker } from 'react-leaflet'
import { reportIcon } from './markers'
import type { Priority } from '@/lib/constants'

export default function MiniMap({ lat, lng, priority, verified, overridden }: { lat: number; lng: number; priority: Priority; verified: boolean; overridden: boolean }) {
  return (
    <MapContainer center={[lat, lng]} zoom={15} className="h-full w-full" scrollWheelZoom={false}>
      <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <Marker position={[lat, lng]} icon={reportIcon(priority, { verified, overridden, selected: true })} keyboard={false} />
    </MapContainer>
  )
}
