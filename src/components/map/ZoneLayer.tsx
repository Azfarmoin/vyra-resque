'use client'

// Draws every zone with a handful of imperative Leaflet layers (one SVG path per zone) instead of one React
// component per zone, so hundreds of zones stay light on low-end phones. Colour is never the only cue:
// each type also has its own fill pattern, outline style, glyph and a text label.
import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { useMap } from 'react-leaflet'
import { labelPriority, placeLabels, type LabelCandidate } from '@/lib/zones/cluster'
import { bboxIntersects, labelPoint, toLatLng } from '@/lib/zones/geometry'
import { SEVERITY_WEIGHT, VERIFICATION_INFO, ZONE_STYLES, zoneLabel, type PatternId } from '@/lib/zones/rules'
import type { DisasterZone, DisplayState, ZoneType } from '@/lib/zones/types'

export type MapZone = DisasterZone & { display_state: DisplayState }
const ENDED: DisplayState[] = ['expired', 'cancelled', 'deactivated']

const patternBody = (p: PatternId, c: string) => {
  switch (p) {
    case 'crosshatch': return { size: 10, svg: `<path d="M0 0L10 10M10 0L0 10" stroke="${c}" stroke-width="1.6" fill="none"/>` }
    case 'diagonal': return { size: 8, svg: `<path d="M-2 2L2 -2M0 8L8 0M6 10L10 6" stroke="${c}" stroke-width="1.6" fill="none"/>` }
    case 'dots': return { size: 8, svg: `<circle cx="4" cy="4" r="1.7" fill="${c}"/>` }
    case 'horizontal': return { size: 8, svg: `<path d="M0 4H8" stroke="${c}" stroke-width="1.6" fill="none"/>` }
    case 'plus': return { size: 12, svg: `<path d="M6 3V9M3 6H9" stroke="${c}" stroke-width="1.8" fill="none"/>` }
    case 'grid': return { size: 8, svg: `<path d="M0 0H8M0 0V8" stroke="${c}" stroke-width="1" fill="none"/>` }
  }
}

function installPatterns(renderer: L.SVG) {
  const svg = (renderer as unknown as { _container?: SVGSVGElement })._container
  if (!svg || svg.querySelector('#vz-defs')) return
  const NS = 'http://www.w3.org/2000/svg'
  const defs = document.createElementNS(NS, 'defs')
  defs.id = 'vz-defs'
  const one = (id: string, p: PatternId, colour: string, fill: string) => {
    const { size, svg: body } = patternBody(p, colour)
    return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${size}" height="${size}"><rect width="${size}" height="${size}" fill="${fill}" fill-opacity="0.22"/>${body}</pattern>`
  }
  defs.innerHTML = (Object.keys(ZONE_STYLES) as ZoneType[]).map((t) => one(`vz-${t}`, ZONE_STYLES[t].pattern, ZONE_STYLES[t].colour, ZONE_STYLES[t].fill)).join('') + one('vz-ended', 'diagonal', '#6B7280', '#D1D5DB')
  svg.prepend(defs)
}

function pathStyle(z: MapZone, selected: boolean): L.PathOptions {
  const s = ZONE_STYLES[z.zone_type]
  const ended = ENDED.includes(z.display_state)
  const verified = z.verification_status === 'official' || z.verification_status === 'human_verified'
  return {
    color: ended ? '#6B7280' : s.colour,
    weight: (SEVERITY_WEIGHT[z.severity] ?? 2) + (selected ? 2 : 0),
    dashArray: ended ? '3 7' : s.dash ?? undefined,
    fillColor: ended ? 'url(#vz-ended)' : `url(#vz-${z.zone_type})`,
    fillOpacity: ended ? 0.6 : verified ? 0.95 : 0.55,
    opacity: ended ? 0.8 : verified ? 1 : 0.8,
    lineJoin: 'round',
  }
}

function labelText(z: MapZone): string {
  const s = ZONE_STYLES[z.zone_type]
  const state = ENDED.includes(z.display_state) ? z.display_state.toUpperCase() : z.display_state === 'upcoming' ? 'NOT STARTED' : null
  const what = z.zone_type === 'evacuation' ? (z.evacuation_status === 'order' ? 'EVACUATION ORDER' : 'EVACUATION PLAN') : s.short
  const trust = z.verification_status === 'official' ? 'OFFICIAL' : z.verification_status === 'human_verified' ? 'VERIFIED' : 'UNVERIFIED'
  return [what, state ?? trust, z.boundary_quality === 'approximate' && z.geometry.type !== 'LineString' ? 'APPROX.' : null].filter(Boolean).join(' · ')
}

export default function ZoneLayer({ zones, selectedId, onSelect }: { zones: MapZone[]; selectedId: string | null; onSelect: (z: MapZone | null) => void }) {
  const map = useMap()
  const shapes = useRef(new Map<string, { key: string; layer: L.Layer }>())
  const group = useRef<L.LayerGroup | null>(null)
  const labels = useRef<L.LayerGroup | null>(null)
  const renderer = useRef<L.SVG | null>(null)
  const latest = useRef({ zones, selectedId, onSelect })
  latest.current = { zones, selectedId, onSelect }

  // One-time setup: a pane below the markers, an SVG renderer with pattern fills.
  useEffect(() => {
    if (!map.getPane('vyra-zones')) { map.createPane('vyra-zones').style.zIndex = '420' }
    renderer.current = L.svg({ pane: 'vyra-zones', padding: 0.3 }).addTo(map)
    installPatterns(renderer.current)
    group.current = L.layerGroup().addTo(map)
    labels.current = L.layerGroup().addTo(map)
    const redraw = () => drawLabels()
    map.on('moveend zoomend', redraw)
    const current = shapes.current
    return () => {
      map.off('moveend zoomend', redraw)
      group.current?.remove(); labels.current?.remove(); renderer.current?.remove()
      current.clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map])

  function drawShapes() {
    const g = group.current
    if (!g) return
    const { zones: list, selectedId: sel, onSelect: pick } = latest.current
    const wanted = new Set(list.map((z) => z.id))
    for (const [id, entry] of shapes.current) if (!wanted.has(id)) { g.removeLayer(entry.layer); shapes.current.delete(id) }
    // Draw big areas first so small zones and lines stay clickable on top.
    for (const z of [...list].sort((a, b) => areaOf(b) - areaOf(a))) {
      const key = `${z.id}:${z.revision}:${z.display_state}:${z.id === sel}:${z.geometry.type}:${(z.geometry as { coordinates: unknown[] }).coordinates.length}`
      const prev = shapes.current.get(z.id)
      if (prev?.key === key) continue
      if (prev) g.removeLayer(prev.layer)
      const style = pathStyle(z, z.id === sel)
      const opts = { ...style, renderer: renderer.current!, pane: 'vyra-zones', bubblingMouseEvents: false, interactive: true }
      let layer: L.Layer
      if (z.boundary_kind === 'circle' && z.geometry.type === 'Point' && z.radius_m) layer = L.circle(toLatLng(z.geometry.coordinates), { ...opts, radius: z.radius_m })
      else if (z.geometry.type === 'Point') layer = L.circleMarker(toLatLng(z.geometry.coordinates), { ...opts, radius: 10 })
      else if (z.geometry.type === 'LineString') layer = L.polyline(z.geometry.coordinates.map(toLatLng), { ...opts, weight: 7, fill: false })
      else if (z.geometry.type === 'Polygon') layer = L.polygon(z.geometry.coordinates.map((r) => r.map(toLatLng)), opts)
      else layer = L.polygon(z.geometry.coordinates.map((p) => p.map((r) => r.map(toLatLng))), opts)
      layer.on('click', (e) => { L.DomEvent.stopPropagation(e as L.LeafletEvent as unknown as Event); pick(z) })
      g.addLayer(layer)
      shapes.current.set(z.id, { key, layer })
    }
  }

  // Labels: highest priority first, anything that would overlap is skipped (the list view still has every zone).
  function drawLabels() {
    const l = labels.current
    if (!l) return
    l.clearLayers()
    const { zones: list, selectedId: sel, onSelect: pick } = latest.current
    const b = map.getBounds()
    const view: [number, number, number, number] = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]
    const cand: (LabelCandidate & { z: MapZone; text: string })[] = []
    for (const z of list) {
      if (!bboxIntersects(z.bbox, view)) continue
      const [lng, lat] = labelPoint(z.geometry)
      const p = map.latLngToContainerPoint([lat, lng])
      const text = labelText(z)
      cand.push({ id: z.id, x: p.x, y: p.y, w: text.length * 6.6 + 34, h: 22, priority: (z.id === sel ? 1000 : 0) + labelPriority(z.zone_type, z.verification_status, z.severity) - (ENDED.includes(z.display_state) ? 40 : 0), z, text })
    }
    const shown = placeLabels(cand)
    for (const c of cand) {
      if (!shown.has(c.id)) continue
      const s = ZONE_STYLES[c.z.zone_type]
      const unverified = c.z.verification_status !== 'official' && c.z.verification_status !== 'human_verified'
      const cls = `zone-label${unverified ? ' unverified' : ''}${ENDED.includes(c.z.display_state) ? ' ended' : ''}${c.z.id === sel ? ' selected' : ''}`
      const icon = L.divIcon({ className: 'zone-label-icon', html: `<span class="${cls}" style="--zc:${s.colour}"><span class="g" aria-hidden="true">${s.glyph}</span>${escapeHtml(c.text)}</span>`, iconSize: [0, 0] })
      const [lng, lat] = labelPoint(c.z.geometry)
      const m = L.marker([lat, lng], { icon, keyboard: true, title: `${zoneLabel(c.z)}: ${c.z.name}. ${VERIFICATION_INFO[c.z.verification_status].label}. Press Enter for details.`, zIndexOffset: c.z.id === sel ? 5000 : 0, riseOnHover: true })
      m.on('click', (e) => { L.DomEvent.stopPropagation(e as L.LeafletEvent as unknown as Event); pick(c.z) })
      l.addLayer(m)
    }
  }

  useEffect(() => { drawShapes(); drawLabels() }, [zones, selectedId]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
function areaOf(z: MapZone) { return (z.bbox[2] - z.bbox[0]) * (z.bbox[3] - z.bbox[1]) }
