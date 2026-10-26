'use client'

// Map layers for the flood simulator. Everything here is an ESTIMATE and is drawn as one: dashed outline, translucent fill.
import L from 'leaflet'
import { useEffect, useState } from 'react'
import { CircleMarker, GeoJSON, ImageOverlay, Marker, Polygon, Polyline, Popup, Tooltip } from 'react-leaflet'
import { decodeGrid } from '@/lib/flood/client'
import type { FloodLayerToggles } from './toggles'
import { DEPTH_BANDS, bandIndexFor, type LatLng, type PointExposure, type ScenarioLayers, type ScenarioResult } from '@/lib/flood/types'


const hex = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]

function GridImage({ layers, opacity }: { layers: Extract<ScenarioLayers, { kind: 'grid' }>; opacity: number }) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    setUrl(null); setFailed(false)
    decodeGrid(layers.grid).then((depth) => {
      const { nx, ny } = layers.grid
      const c = document.createElement('canvas')
      c.width = nx; c.height = ny
      const ctx = c.getContext('2d')!
      const img = ctx.createImageData(nx, ny)
      const rgb = DEPTH_BANDS.map((b) => hex(b.color))
      for (let i = 0; i < depth.length; i++) {
        const bi = Number.isFinite(depth[i]) ? bandIndexFor(depth[i]) : -1
        if (bi < 0) continue
        img.data[i * 4] = rgb[bi][0]; img.data[i * 4 + 1] = rgb[bi][1]; img.data[i * 4 + 2] = rgb[bi][2]; img.data[i * 4 + 3] = 255
      }
      ctx.putImageData(img, 0, 0)
      if (live) setUrl(c.toDataURL('image/png'))
    }).catch(() => live && setFailed(true))
    return () => { live = false }
  }, [layers])
  if (failed || !url) return null
  const [w, s, e, n] = layers.grid.bbox
  return <ImageOverlay url={url} bounds={[[s, w], [n, e]]} opacity={opacity} interactive={false} className="flood-grid" />
}

const ring = (c: number[][]): LatLng[] => c.map(([lng, lat]) => [lat, lng])
const polys = (g: ScenarioResult['area']['geometry']): LatLng[][][] => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).map((p) => p.map(ring))

function Points({ p, color, label, glyph }: { p: PointExposure; color: string; label: string; glyph: string }) {
  if (!p.available) return null
  return (
    <>
      {p.items.map((i) => (
        <Marker key={i.id} position={[i.lat, i.lng]} icon={L.divIcon({ className: '', html: `<div style="width:24px;height:24px;border-radius:50%;background:${i.flooded ? '#b8452a' : color};border:2px solid #fff;color:#fff;display:grid;place-items:center;font:800 11px system-ui;box-shadow:0 1px 4px #0006">${glyph}</div>`, iconSize: [24, 24], iconAnchor: [12, 12] })}>
          <Popup>
            <div className="space-y-1 text-sm text-ink-900">
              <p className="font-semibold">{i.name}</p>
              <p>{label}: {i.flooded ? <strong>inside the estimated extent{i.depthM != null ? `, about ${i.depthM} m (estimate)` : ''}</strong> : i.depthM == null ? 'outside the assessed area, unknown' : 'not inside the estimated extent'}</p>
              <p className="text-xs text-ink-600">Estimate only. Not a real event.</p>
            </div>
          </Popup>
        </Marker>
      ))}
    </>
  )
}

export default function FloodLayer({ result, layers, toggles, opacity, drawPoints, seedPoints, floodedRuns }: {
  result: ScenarioResult | null
  layers: ScenarioLayers | null
  toggles: FloodLayerToggles
  opacity: number
  /** Points being drawn for a custom area, [lat, lng]. */
  drawPoints?: LatLng[]
  /** Water source points chosen for a seeded terrain scenario, [lat, lng]. */
  seedPoints?: LatLng[]
  /** Flooded stretches of the route candidates, from the route evidence (supplementary). */
  floodedRuns?: LatLng[][]
}) {
  const area = result ? polys(result.area.geometry) : []
  const ex = result?.exposure
  return (
    <>
      {drawPoints && drawPoints.length > 0 && (
        <>
          {drawPoints.length >= 3 ? <Polygon positions={drawPoints} pathOptions={{ color: '#12306e', weight: 2, dashArray: '6 6', fillOpacity: 0.1 }} /> : <Polyline positions={drawPoints} pathOptions={{ color: '#12306e', weight: 2, dashArray: '6 6' }} />}
          {drawPoints.map((p, i) => <CircleMarker key={i} center={p} radius={6} pathOptions={{ color: '#12306e', fillColor: i === 0 ? '#f47755' : '#fff', fillOpacity: 1, weight: 3 }} />)}
        </>
      )}

      {seedPoints?.map((p, i) => <CircleMarker key={`s${i}`} center={p} radius={8} pathOptions={{ color: '#fff', fillColor: '#0a7d8c', fillOpacity: 1, weight: 3 }}><Tooltip permanent direction="top">Water source {i + 1}</Tooltip></CircleMarker>)}

      {result && layers && toggles.extent && (
        <>
          {layers.kind === 'grid' && <GridImage layers={layers} opacity={opacity} />}
          {layers.kind === 'uniform' && area.map((p, i) => { const b = bandIndexFor(layers.depthM); return <Polygon key={i} positions={p} pathOptions={{ stroke: false, fillColor: b >= 0 ? DEPTH_BANDS[b].color : '#8fc6e8', fillOpacity: opacity * 0.8 }} /> })}
          {layers.kind === 'polygons' && <GeoJSON key={result.computedAt} data={layers.features as never} style={(f) => { const b = bandIndexFor(Number(f?.properties?.depth_m ?? 0)); return { stroke: false, fillColor: b >= 0 ? DEPTH_BANDS[b].color : '#8fc6e8', fillOpacity: opacity } }} />}
        </>
      )}
      {result && area.map((p, i) => <Polygon key={`o${i}`} positions={p} interactive={false} pathOptions={{ color: '#182B3A', weight: 2, dashArray: '8 6', fill: false }} />)}

      {ex && toggles.roads && ex.roads.available && ex.roads.items.map((r) => (
        <Polyline key={r.id} positions={r.path} pathOptions={{ color: '#b8452a', weight: 4, opacity: 0.9 }}>
          <Tooltip sticky>{r.name}: about {Math.round(r.floodedLengthM)} m inside the estimate (max {r.maxDepthM} m, estimate)</Tooltip>
        </Polyline>
      ))}
      {ex && toggles.roads && ex.blockedRoadRegister.available && ex.blockedRoadRegister.items.map((r) => (
        <Polyline key={`b${r.id}`} positions={r.path} pathOptions={{ color: '#6b2d5c', weight: 6, dashArray: '2 8', opacity: 0.9 }}>
          <Tooltip sticky>Reported blocked road inside the estimate: {r.name}</Tooltip>
        </Polyline>
      ))}
      {ex && toggles.buildings && ex.buildings.available && ex.buildings.items.map((b) => <CircleMarker key={b.id} center={[b.lat, b.lng]} radius={3} pathOptions={{ color: '#8a5a00', fillColor: '#d99a1e', fillOpacity: 0.9, weight: 1 }} />)}
      {ex && toggles.shelters && <Points p={ex.shelters} color="#1f7a4d" label="Shelter" glyph="S" />}
      {ex && toggles.hospitals && <Points p={ex.hospitals} color="#1d4f91" label="Hospital" glyph="H" />}
      {result && toggles.observations && result.observations.inArea.map((o) => (
        <CircleMarker key={o.id} center={[o.lat, o.lng]} radius={7} pathOptions={{ color: '#fff', fillColor: '#6a3fb0', fillOpacity: 1, weight: 2 }}>
          <Popup><div className="text-sm text-ink-900"><p className="font-semibold">Recorded observation: {o.depthM} m</p><p className="text-xs">{o.source} · {new Date(o.observedAt).toLocaleString()} · {o.verified ? 'verified' : 'not verified'}</p></div></Popup>
        </CircleMarker>
      ))}
      {floodedRuns?.map((run, i) => <Polyline key={`fr${i}`} positions={run} interactive={false} pathOptions={{ color: '#b8452a', weight: 9, opacity: 0.45 }} />)}
    </>
  )
}
