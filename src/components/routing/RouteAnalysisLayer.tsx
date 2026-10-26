'use client'

// Route-analysis overlay for the live map. Everything drawn comes from the analysis response:
// route lines are the routing provider's road geometry, hazards are the matched records.
import { Marker, Polyline, Popup, Tooltip } from 'react-leaflet'
import { destinationIcon, hazardIcon, originIcon } from '../map/markers'
import { ageLine, KIND_LABEL, PROXIMITY_LABEL, SEVERITY_LABEL, VERIFY_LABEL } from './labels'
import type { AnalysisResult, LatLng } from '@/lib/routing/types'

export default function RouteAnalysisLayer({
  origin,
  destination,
  result,
  selectedId,
  onSelect,
}: {
  origin: LatLng | null
  destination: LatLng | null
  result: AnalysisResult | null
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const selected = result?.candidates.find((c) => c.id === selectedId) ?? null
  // Unselected candidates first so the selected one draws on top.
  const ordered = result ? [...result.candidates].sort((a, b) => Number(a.id === selectedId) - Number(b.id === selectedId)) : []

  return (
    <>
      {ordered.map((c) => {
        const on = c.id === selectedId
        return (
          <span key={c.id}>
            {on && <Polyline positions={c.geometry} pathOptions={{ color: '#fff', weight: 11, opacity: 0.9 }} interactive={false} />}
            <Polyline
              positions={c.geometry}
              pathOptions={on ? { color: '#B8452A', weight: 6, opacity: 1 } : { color: '#4B6073', weight: 4, opacity: 0.75, dashArray: '3 9' }}
              eventHandlers={{ click: () => onSelect(c.id) }}
            >
              <Tooltip sticky>
                Route {c.rank}: {c.statusLabel}
                {c.recalculated ? ' (recalculated by routing provider)' : ''}
              </Tooltip>
            </Polyline>
          </span>
        )
      })}

      {selected?.findings.map((f) => (
        <span key={f.hazardId}>
          {f.path && <Polyline positions={f.path} pathOptions={{ color: '#182B3A', weight: 9, opacity: f.state === 'active' ? 0.85 : 0.35, dashArray: f.verification === 'confirmed' ? undefined : '2 8', lineCap: 'butt' }} interactive={false} />}
          <Marker position={f.location} icon={hazardIcon(f.kind, f.severity, f.verification, f.proximity)} zIndexOffset={900}>
            <Popup>
              <div className="space-y-1 text-sm text-ink-900">
                <p className="font-semibold">{KIND_LABEL[f.kind]}</p>
                <p>{SEVERITY_LABEL[f.severity]} · <strong>{VERIFY_LABEL[f.verification]}</strong> · {PROXIMITY_LABEL[f.proximity]} ({f.distanceM} m)</p>
                <p>{f.description}</p>
                <p className="text-xs">Source: {f.source}</p>
                <p className="text-xs">{ageLine(f)}</p>
              </div>
            </Popup>
          </Marker>
        </span>
      ))}

      {origin && <Marker position={origin} icon={originIcon} zIndexOffset={1000}><Tooltip permanent direction="top" offset={[0, -14]}>Start (A)</Tooltip></Marker>}
      {destination && <Marker position={destination} icon={destinationIcon} zIndexOffset={1000}><Tooltip permanent direction="top" offset={[0, -14]}>Destination (B)</Tooltip></Marker>}
    </>
  )
}
