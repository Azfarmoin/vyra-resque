// Scenario report: a schematic map, inputs, results, assumptions and limitations, as HTML (with inline SVG), PDF, JSON or GeoJSON.
// The map has NO basemap (the server must not depend on a tile service); it draws the estimate, the area outline and the
// affected assets on a plain background with a scale bar. Every page carries the ESTIMATE banner.
import { gridToBandRects, unpackGrid } from './field'
import { cellCenter, M_PER_DEG_LAT, mPerDegLng } from './geo'
import type { StoredScenario } from './repo'
import { bandIndexFor, DEPTH_BANDS, type DatasetStatus, type LatLng, type PointExposure, type ScenarioResult } from './types'

// ---- map primitives --------------------------------------------------------------------------------------------------

type Prim =
  | { t: 'rect'; x: number; y: number; w: number; h: number; fill: string; opacity?: number; stroke?: string }
  | { t: 'poly'; pts: [number, number][]; fill?: string; stroke?: string; sw?: number; dash?: string; opacity?: number }
  | { t: 'line'; pts: [number, number][]; stroke: string; sw: number; dash?: string; opacity?: number }
  | { t: 'circle'; cx: number; cy: number; r: number; fill: string; stroke?: string }
  | { t: 'text'; x: number; y: number; text: string; size: number; anchor?: 'start' | 'middle' | 'end'; fill?: string; bold?: boolean }

export interface MapDrawing { w: number; h: number; prims: Prim[]; legend: { label: string; color: string; shape: 'box' | 'circle' | 'line' | 'diamond' }[] }

const INK = '#182b3a'
const WARN = '#b8452a'

export function buildMap(s: StoredScenario, W = 760, H = 540): MapDrawing {
  const r = s.results
  const [w0, s0, e0, n0] = r.area.bbox
  const padX = (e0 - w0) * 0.08 || 0.001
  const padY = (n0 - s0) * 0.08 || 0.001
  const w = w0 - padX, e = e0 + padX, so = s0 - padY, n = n0 + padY
  const cos = Math.cos(((so + n) / 2) * (Math.PI / 180))
  const top = 34, bottom = 40, side = 12
  const availW = W - side * 2, availH = H - top - bottom
  const k = Math.min(availW / ((e - w) * cos), availH / (n - so)) // px per degree of latitude
  const ox = side + (availW - (e - w) * cos * k) / 2
  const oy = top + (availH - (n - so) * k) / 2
  const X = (lng: number) => ox + (lng - w) * cos * k
  const Y = (lat: number) => oy + (n - lat) * k
  const prims: Prim[] = []
  const legend: MapDrawing['legend'] = []

  prims.push({ t: 'rect', x: 0, y: 0, w: W, h: H, fill: '#f6f3ec' })
  prims.push({ t: 'rect', x: ox, y: oy, w: (e - w) * cos * k, h: (n - so) * k, fill: '#ffffff', stroke: '#d8d2c4' })

  const ring = (c: number[][]): [number, number][] => c.map(([lng, lat]) => [X(lng), Y(lat)])
  const areaPolys = r.area.geometry.type === 'Polygon' ? [r.area.geometry.coordinates] : r.area.geometry.coordinates
  for (const p of areaPolys) prims.push({ t: 'poly', pts: ring(p[0]), fill: '#fbfaf6' })

  // the estimate
  const L = s.layers
  if (L?.kind === 'grid') {
    const { spec, depth } = unpackGrid(L.grid)
    const rects = gridToBandRects(spec, depth, (d) => bandIndexFor(d, DEPTH_BANDS))
    const cw = spec.dxDeg, ch = spec.dyDeg
    for (const q of rects) {
      const x0 = X(spec.bbox[0] + q.col0 * cw), x1 = X(spec.bbox[0] + (q.col1 + 1) * cw)
      const y0 = Y(spec.bbox[3] - q.row0 * ch), y1 = Y(spec.bbox[3] - (q.row1 + 1) * ch)
      prims.push({ t: 'rect', x: x0, y: y0, w: x1 - x0 + 0.3, h: y1 - y0 + 0.3, fill: DEPTH_BANDS[q.band].color, opacity: 0.85 })
    }
    for (const b of DEPTH_BANDS) legend.push({ label: `Depth ${b.label} (estimate)`, color: b.color, shape: 'box' })
  } else if (L?.kind === 'uniform') {
    const bi = bandIndexFor(L.depthM)
    const col = bi >= 0 ? DEPTH_BANDS[bi].color : '#ddd'
    for (const p of areaPolys) prims.push({ t: 'poly', pts: ring(p[0]), fill: col, opacity: 0.7 })
    legend.push({ label: `Uniform hypothetical depth ${L.depthM} m (no terrain)`, color: col, shape: 'box' })
  } else if (L?.kind === 'polygons') {
    for (const f of L.features.features) {
      const bi = bandIndexFor(f.properties.depth_m)
      const polys = (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates) as number[][][][]
      for (const p of polys) prims.push({ t: 'poly', pts: ring(p[0]), fill: bi >= 0 ? DEPTH_BANDS[bi].color : '#cfe', opacity: 0.8 })
    }
    for (const b of DEPTH_BANDS) legend.push({ label: `Depth ${b.label} (imported model)`, color: b.color, shape: 'box' })
  }
  for (const p of areaPolys) prims.push({ t: 'poly', pts: ring(p[0]), stroke: INK, sw: 1.6, dash: '6 4' })
  legend.push({ label: 'Selected area', color: INK, shape: 'line' })

  const ex = r.exposure
  const roads = (items: typeof ex.roads.items, color: string, sw: number) => { for (const it of items) prims.push({ t: 'line', pts: it.path.map(([la, ln]) => [X(ln), Y(la)] as [number, number]), stroke: color, sw }) }
  if (ex.roads.available && ex.roads.items.length) { roads(ex.roads.items, WARN, 1.8); legend.push({ label: 'Roads with flooded sections', color: WARN, shape: 'line' }) }
  if (ex.blockedRoadRegister.available && ex.blockedRoadRegister.items.length) { roads(ex.blockedRoadRegister.items, '#6b2d5c', 3); legend.push({ label: 'Reported blocked road inside estimate', color: '#6b2d5c', shape: 'line' }) }
  if (ex.buildings.available && ex.buildings.items.length) { for (const b of ex.buildings.items) prims.push({ t: 'circle', cx: X(b.lng), cy: Y(b.lat), r: 1.6, fill: '#8a5a00' }); legend.push({ label: 'Affected buildings (up to 300 shown)', color: '#8a5a00', shape: 'circle' }) }
  const pts = (p: PointExposure, color: string, label: string, glyph: string) => {
    if (!p.available) return
    for (const i of p.items) {
      prims.push({ t: 'circle', cx: X(i.lng), cy: Y(i.lat), r: 6, fill: i.flooded ? WARN : color, stroke: '#fff' })
      prims.push({ t: 'text', x: X(i.lng), y: Y(i.lat) + 3, text: glyph, size: 8, anchor: 'middle', fill: '#fff', bold: true })
    }
    if (p.items.length) legend.push({ label: `${label} (red = inside estimate)`, color, shape: 'circle' })
  }
  pts(ex.shelters, '#1f7a4d', 'Shelters', 'S')
  pts(ex.hospitals, '#1d4f91', 'Hospitals', 'H')
  for (const o of r.observations.inArea) {
    const x = X(o.lng), y = Y(o.lat)
    prims.push({ t: 'poly', pts: [[x, y - 6], [x + 6, y], [x, y + 6], [x - 6, y]], fill: '#6a3fb0', stroke: '#fff' })
  }
  if (r.observations.inArea.length) legend.push({ label: 'Recorded observations', color: '#6a3fb0', shape: 'diamond' })
  const seeds = ((r.inputs as { scenario?: { seeds?: LatLng[] } })?.scenario?.seeds ?? []) as LatLng[]
  for (const [la, ln] of seeds) { const x = X(ln), y = Y(la); prims.push({ t: 'poly', pts: [[x, y - 7], [x + 6, y + 5], [x - 6, y + 5]], fill: '#0a7d8c', stroke: '#fff' }) }
  if (seeds.length) legend.push({ label: 'Water source point', color: '#0a7d8c', shape: 'diamond' })

  // frame, banner, scale bar, north arrow
  prims.push({ t: 'rect', x: 0, y: 0, w: W, h: 26, fill: WARN })
  prims.push({ t: 'text', x: W / 2, y: 17, text: r.banner.toUpperCase(), size: 12, anchor: 'middle', fill: '#fff', bold: true })
  const pxPerM = k / M_PER_DEG_LAT
  const nice = [50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10_000, 20_000]
  const target = (W * 0.2) / pxPerM
  const len = nice.reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a))
  const bx = side + 6, by = H - 16
  prims.push({ t: 'line', pts: [[bx, by], [bx + len * pxPerM, by]], stroke: INK, sw: 3 })
  prims.push({ t: 'text', x: bx, y: by - 5, text: len >= 1000 ? `${len / 1000} km` : `${len} m`, size: 10, fill: INK })
  prims.push({ t: 'poly', pts: [[W - 24, H - 40], [W - 18, H - 24], [W - 24, H - 28], [W - 30, H - 24]], fill: INK })
  prims.push({ t: 'text', x: W - 24, y: H - 44, text: 'N', size: 10, anchor: 'middle', fill: INK, bold: true })
  prims.push({ t: 'text', x: W / 2, y: H - 4, text: 'Schematic map, no basemap. Positions are approximate. Estimate, not a real event.', size: 8.5, anchor: 'middle', fill: '#5a6670' })
  void cellCenter; void mPerDegLng
  return { w: W, h: H, prims, legend }
}

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const f1 = (n: number) => Math.round(n * 10) / 10

export function mapToSvg(m: MapDrawing): string {
  const body = m.prims.map((p) => {
    switch (p.t) {
      case 'rect': return `<rect x="${f1(p.x)}" y="${f1(p.y)}" width="${f1(p.w)}" height="${f1(p.h)}" fill="${p.fill}"${p.opacity != null ? ` fill-opacity="${p.opacity}"` : ''}${p.stroke ? ` stroke="${p.stroke}"` : ''}/>`
      case 'poly': return `<polygon points="${p.pts.map(([x, y]) => `${f1(x)},${f1(y)}`).join(' ')}" fill="${p.fill ?? 'none'}"${p.opacity != null ? ` fill-opacity="${p.opacity}"` : ''}${p.stroke ? ` stroke="${p.stroke}" stroke-width="${p.sw ?? 1}"` : ''}${p.dash ? ` stroke-dasharray="${p.dash}"` : ''}/>`
      case 'line': return `<polyline points="${p.pts.map(([x, y]) => `${f1(x)},${f1(y)}`).join(' ')}" fill="none" stroke="${p.stroke}" stroke-width="${p.sw}" stroke-linecap="round" stroke-linejoin="round"/>`
      case 'circle': return `<circle cx="${f1(p.cx)}" cy="${f1(p.cy)}" r="${p.r}" fill="${p.fill}"${p.stroke ? ` stroke="${p.stroke}"` : ''}/>`
      case 'text': return `<text x="${f1(p.x)}" y="${f1(p.y)}" font-size="${p.size}" text-anchor="${p.anchor ?? 'start'}" fill="${p.fill ?? INK}"${p.bold ? ' font-weight="700"' : ''} font-family="Helvetica, Arial, sans-serif">${esc(p.text)}</text>`
    }
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${m.w} ${m.h}" role="img" aria-label="Schematic map of the estimated flood extent and affected assets. Estimate, not a real event.">${body}</svg>`
}

// ---- readable text ---------------------------------------------------------------------------------------------------

export const unknown = (v: number | null | undefined, unit = '') => (v == null ? 'unknown' : `${v}${unit}`)

export function describeInputs(r: ScenarioResult): [string, string][] {
  const i = r.inputs as { scenario?: Record<string, unknown>; options?: Record<string, unknown>; areaSource?: Record<string, unknown>; model?: Record<string, unknown>; validation?: Record<string, unknown> }
  const rows: [string, string][] = [['Area', `${r.area.label}, ${r.area.areaKm2} km2`], ['Area basis', r.area.basis], ['Scenario type', r.tier.title]]
  const sc = i.scenario
  if (sc?.kind === 'hypothetical_overlay') rows.push(['Water depth above ground (typed in)', `${sc.depthM} m, applied evenly`])
  if (sc?.kind === 'terrain_bathtub') {
    rows.push(['Water surface elevation (terrain datum)', `${sc.waterSurfaceElevationM} m`], ['Connectivity', sc.connectivity === 'seeded' ? `from ${(sc.seeds as unknown[]).length} source point(s)` : 'off: every cell below the level floods'])
  }
  if (sc?.kind === 'terrain_rainfall') {
    const rf = sc.rainfall as Record<string, unknown>
    rows.push(['Rainfall', rf.kind === 'manual' ? `${rf.mm} mm over ${rf.durationHours} h (typed in${rf.note ? `: ${rf.note}` : ''})` : `Open-Meteo model precipitation ${rf.start} to ${rf.end}`], ['Runoff coefficient', String(sc.runoffCoefficient)], ['Drainage capacity (typed in)', `${sc.drainageCapacityMm} mm`], ['Infiltration', `${sc.infiltrationMm} mm`])
  }
  if (i.model) rows.push(['Model', `${i.model.name} ${i.model.version ?? ''}`.trim()], ['Validation status', String(i.validation?.status ?? 'none')])
  rows.push(['Flooded threshold', `${(i.options as { minDepthM?: number } | undefined)?.minDepthM ?? 0.1} m`])
  for (const p of r.provenance) rows.push([p.label, p.value])
  return rows
}

export function exposureRows(r: ScenarioResult): [string, string, string][] {
  const e = r.exposure
  const cnt = (p: PointExposure) => (p.available ? [`${p.affected} of ${p.total}`, p.unassessed ? `${p.unassessed} outside the assessed area` : ''] : ['unknown', p.reason ?? ''])
  const [sh, shn] = cnt(e.shelters)
  const [ho, hon] = cnt(e.hospitals)
  return [
    ['Shelters affected', sh, shn],
    ['Hospitals affected', ho, hon],
    ['Roads with flooded sections', e.roads.available ? `${e.roads.affectedCount} of ${e.roads.totalCount}` : 'unknown', e.roads.available ? `${e.roads.floodedLengthKm} km of ${e.roads.totalLengthKm} km flooded${e.roads.truncated ? ' (lower bound: dataset capped)' : ''}` : e.roads.reason ?? ''],
    ['Reported blocked roads inside estimate', e.blockedRoadRegister.available ? `${e.blockedRoadRegister.affectedCount} of ${e.blockedRoadRegister.totalCount}` : 'unknown', e.blockedRoadRegister.available ? 'A register of verified reports, not a road network.' : e.blockedRoadRegister.reason ?? ''],
    ['Buildings affected', e.buildings.available ? `${e.buildings.affected} of ${e.buildings.total}${e.buildings.truncated ? '+' : ''}` : 'unknown', e.buildings.available ? (e.buildings.truncated ? 'Lower bound: the dataset was capped.' : '') : e.buildings.reason ?? ''],
    ['Rescue teams inside extent', e.resources.available ? `${e.resources.teamsInExtent} of ${e.resources.teamsTotal}` : 'unknown', e.resources.available ? Object.entries(e.resources.resourcesByType).map(([t, v]) => `${t.replace('_', ' ')}: ${v.quantityInExtent} of ${v.quantityTotal}`).join('; ') || e.resources.note : e.resources.reason ?? ''],
    ['Open incident reports inside extent (context only)', e.incidents.available ? String(e.incidents.openInExtent) : 'unknown', e.incidents.note],
  ]
}

const levelText: Record<DatasetStatus['level'], string> = { good: 'Good', fair: 'Fair', poor: 'Poor', missing: 'Missing' }
const stateText: Record<DatasetStatus['state'], string> = { ok: 'OK', empty: 'Empty', not_configured: 'Not configured', failed: 'Failed to load', stale: 'Stale', truncated: 'Truncated', synthetic: 'SYNTHETIC', partial: 'Partial' }

// ---- HTML -----------------------------------------------------------------------------------------------------------

export function renderHtml(s: StoredScenario, generatedBy: string, now = new Date()): string {
  const r = s.results
  const map = buildMap(s)
  const legend = map.legend.map((l) => `<li><span class="sw ${l.shape}" style="background:${l.shape === 'line' ? 'transparent' : l.color};border-color:${l.color}"></span>${esc(l.label)}</li>`).join('')
  const table = (head: string[], rows: string[][]) => `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
  const list = (items: string[]) => `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`
  const sm = r.summary
  const bands = DEPTH_BANDS.map((b) => [b.label, r.tier.depthBands === 'not_supported' ? 'not supported (uniform depth)' : `${sm.bandAreasKm2[b.id] ?? 0} km2`])
  const aff = (p: PointExposure) => p.available ? p.items.filter((i) => i.flooded).map((i) => `${i.name} (${i.depthM} m)`).join('; ') || 'none inside the estimate' : 'unknown'
  const cmp = r.observations.comparison
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(s.name)} - flood scenario report (ESTIMATE)</title>
<style>
 body{font:14px/1.5 Helvetica,Arial,sans-serif;color:#182b3a;margin:0;background:#fff}
 .banner{background:#b8452a;color:#fff;text-align:center;font-weight:700;padding:8px;letter-spacing:.04em;position:sticky;top:0}
 main{max-width:900px;margin:0 auto;padding:20px}
 h1{font-size:26px;margin:.2em 0}h2{font-size:18px;margin:1.6em 0 .4em;border-bottom:2px solid #182b3a;padding-bottom:3px}
 table{border-collapse:collapse;width:100%;margin:.4em 0;font-size:13px}th,td{border:1px solid #cfc9bb;padding:5px 8px;text-align:left;vertical-align:top}th{background:#f1ede2}
 .box{border:2px solid #b8452a;background:#fdf1ec;padding:10px 14px;border-radius:8px;margin:12px 0}
 .meta{color:#5a6670}svg{width:100%;height:auto;border:1px solid #cfc9bb;border-radius:6px}
 .legend{columns:2;list-style:none;padding:0;font-size:12px}.sw{display:inline-block;width:14px;height:10px;margin-right:6px;border:2px solid;vertical-align:middle}.sw.circle{border-radius:50%;width:10px}.sw.line{height:0;border-width:2px 0 0;width:18px}.sw.diamond{transform:rotate(45deg);width:9px;height:9px}
 .foot{margin-top:2em;font-size:12px;color:#5a6670}
 @media print{.banner{position:static}h2{break-after:avoid}table,svg,.box{break-inside:avoid}}
</style></head><body><div class="banner">${esc(r.banner.toUpperCase())}</div><main>
<h1>${esc(s.name)}</h1>
<p class="meta">Scenario ${esc(s.id)} &middot; created by ${esc(s.createdByName ?? 'unknown')} on ${esc(s.createdAt)} &middot; computed ${esc(r.computedAt)} &middot; ${esc(r.modelVersion)}<br>Report generated ${esc(now.toISOString())} by ${esc(generatedBy)}. Simulation: not stored as, and not linked to, any real incident.</p>
${s.description ? `<p>${esc(s.description)}</p>` : ''}
<div class="box"><strong>${esc(r.tier.title)}</strong><br>${esc(r.tier.summary)}<br><strong>Data quality:</strong> ${esc(r.dataQuality.headline)}</div>
${r.warnings.length ? `<div class="box"><strong>Warnings</strong>${list(r.warnings)}</div>` : ''}
<h2>Map</h2>${mapToSvg(map)}<ul class="legend">${legend}</ul>
<h2>Inputs</h2>${table(['Input', 'Value'], describeInputs(r))}
<h2>Results</h2>${table(['Measure', 'Estimated value'], [
  ['Selected area', `${sm.areaKm2} km2`], ['Area assessed', `${sm.assessedAreaKm2} km2${sm.unassessedFraction ? ` (${Math.round(sm.unassessedFraction * 1000) / 10}% had no terrain data)` : ''}`],
  ['Flooded area (estimate)', `${sm.floodedAreaKm2} km2 (${Math.round(sm.floodedFractionOfAssessed * 100)}% of assessed)`], ['Maximum depth (estimate)', unknown(sm.maxDepthM, ' m')], ['Mean depth where flooded (estimate)', unknown(sm.meanDepthM, ' m')], ['Water volume (estimate)', sm.volumeM3 == null ? 'unknown' : `${sm.volumeM3.toLocaleString('en')} m3`], ['Working cell size', sm.cellSizeM == null ? 'not applicable' : `about ${sm.cellSizeM} m`],
])}
<h3>Flooded area by depth band</h3>${table(['Depth band', 'Area'], bands)}
<h2>Potentially affected assets (approximate)</h2>${table(['Asset', 'Affected', 'Notes'], exposureRows(r))}
<p><strong>Shelters inside the estimate:</strong> ${esc(aff(r.exposure.shelters))}<br><strong>Hospitals inside the estimate:</strong> ${esc(aff(r.exposure.hospitals))}</p>
<h2>Data quality</h2>${table(['Dataset', 'State', 'Quality', 'Source', 'As of', 'Resolution', 'Records', 'Notes'], r.dataQuality.datasets.map((d) => [d.label, stateText[d.state], levelText[d.level], d.source ?? '-', d.asOf ?? 'unknown', d.resolutionM ? `${d.resolutionM} m` : '-', d.count == null ? '-' : String(d.count), [...d.notes, d.error ? `Error: ${d.error}` : ''].filter(Boolean).join(' ')]))}
<h2>Recorded observations</h2>${cmp ? `<p>${esc(cmp.note)}</p>${table(['Window', 'Observations', 'Usable', 'Mean error', 'MAE', 'RMSE'], [[`${cmp.windowFrom} to ${cmp.windowTo}`, String(cmp.n), String(cmp.usable), unknown(cmp.meanErrorM, ' m'), unknown(cmp.maeM, ' m'), unknown(cmp.rmseM, ' m')]])}` : `<p>${r.observations.inArea.length} recorded observation(s) lie inside the area. No comparison window was chosen, so no comparison was made.</p>`}
<h2>Assumptions</h2>${list(r.assumptions)}
<h2>Limitations</h2>${list(r.limitations)}
<p class="foot">${esc(r.disclaimer)}</p></main></body></html>`
}

// ---- GeoJSON ---------------------------------------------------------------------------------------------------------

export function toGeoJson(s: StoredScenario) {
  const r = s.results
  const features: unknown[] = [{ type: 'Feature', geometry: r.area.geometry, properties: { layer: 'scenario_area', estimate: true, name: s.name, tier: r.tier.id } }]
  const L = s.layers
  if (L?.kind === 'grid') {
    const { spec, depth } = unpackGrid(L.grid)
    const rects = gridToBandRects(spec, depth, (d) => bandIndexFor(d, DEPTH_BANDS))
    const byBand = new Map<number, number[][][][]>()
    for (const q of rects) {
      const x0 = spec.bbox[0] + q.col0 * spec.dxDeg, x1 = spec.bbox[0] + (q.col1 + 1) * spec.dxDeg
      const y1 = spec.bbox[3] - q.row0 * spec.dyDeg, y0 = spec.bbox[3] - (q.row1 + 1) * spec.dyDeg
      const list = byBand.get(q.band) ?? []
      list.push([[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]])
      byBand.set(q.band, list)
    }
    for (const [b, polys] of byBand) features.push({ type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: polys }, properties: { layer: 'depth_band', estimate: true, band: DEPTH_BANDS[b].label, min_depth_m: DEPTH_BANDS[b].min, max_depth_m: DEPTH_BANDS[b].max, note: 'Cell-based estimate; depths are indicative only.' } })
  } else if (L?.kind === 'uniform') features.push({ type: 'Feature', geometry: r.area.geometry, properties: { layer: 'uniform_overlay', estimate: true, depth_m: L.depthM, note: 'Hypothetical uniform depth, no terrain used.' } })
  else if (L?.kind === 'polygons') for (const f of L.features.features) features.push({ type: 'Feature', geometry: f.geometry, properties: { layer: 'imported_depth', estimate: true, depth_m: f.properties.depth_m, tier: r.tier.id } })
  const pt = (p: PointExposure, layer: string) => { if (p.available) for (const i of p.items) features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [i.lng, i.lat] }, properties: { layer, estimate: true, name: i.name, flooded: i.flooded, depth_m: i.depthM } }) }
  pt(r.exposure.shelters, 'shelter'); pt(r.exposure.hospitals, 'hospital')
  for (const road of [...r.exposure.roads.items, ...r.exposure.blockedRoadRegister.items]) features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: road.path.map(([la, ln]) => [ln, la]) }, properties: { layer: 'road', estimate: true, name: road.name, flooded_length_m: road.floodedLengthM, max_depth_m: road.maxDepthM } })
  return { type: 'FeatureCollection', properties: { estimate: true, simulation: true, disclaimer: r.disclaimer, scenario_id: s.id, computed_at: r.computedAt, tier: r.tier.title }, features }
}

// ---- PDF ------------------------------------------------------------------------------------------------------------

const latin = (v: unknown) => String(v ?? '').replace(/[^\x20-\x7E -ÿ]/g, '?') // built-in PDF fonts are Latin-1 only

export async function renderPdf(s: StoredScenario, generatedBy: string, now = new Date()): Promise<Buffer> {
  const PDFDocument = (await import('pdfkit')).default
  const r = s.results
  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true, info: { Title: latin(`${s.name} - flood scenario report (ESTIMATE)`), Author: 'VYRA', Subject: 'Flood scenario estimate' } })
  const chunks: Buffer[] = []
  doc.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<Buffer>((res) => doc.on('end', () => res(Buffer.concat(chunks))))
  const W = doc.page.width - 80
  const need = (h: number) => { if (doc.y + h > doc.page.height - 60) doc.addPage() }
  const h2 = (t: string) => { need(60); doc.moveDown(0.8).font('Helvetica-Bold').fontSize(13).fillColor(INK).text(latin(t)); doc.moveTo(40, doc.y + 1).lineTo(40 + W, doc.y + 1).lineWidth(1).strokeColor(INK).stroke(); doc.moveDown(0.4) }
  const p = (t: string, o: { bold?: boolean; size?: number; color?: string } = {}) => { doc.font(o.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(o.size ?? 9.5).fillColor(o.color ?? INK).text(latin(t), { width: W }) }
  const bullets = (items: string[]) => items.forEach((i) => { need(24); doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(latin(`- ${i}`), { width: W, indent: 6 }) })
  const rows = (data: string[][], widths: number[], head?: string[]) => {
    const draw = (cells: string[], bold: boolean) => {
      const hts = cells.map((c, i) => doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).heightOfString(latin(c), { width: widths[i] * W - 8 }))
      const h = Math.max(...hts) + 8
      need(h)
      const y = doc.y
      let x = 40
      cells.forEach((c, i) => {
        if (bold) doc.rect(x, y, widths[i] * W, h).fillAndStroke('#f1ede2', '#cfc9bb'); else doc.rect(x, y, widths[i] * W, h).strokeColor('#cfc9bb').lineWidth(0.5).stroke()
        doc.fillColor(INK).font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).text(latin(c), x + 4, y + 4, { width: widths[i] * W - 8 })
        x += widths[i] * W
      })
      doc.y = y + h
    }
    if (head) draw(head, true)
    data.forEach((row) => draw(row, false))
    doc.moveDown(0.3)
  }

  doc.font('Helvetica-Bold').fontSize(18).fillColor(INK).text(latin(s.name), { width: W })
  p(`Scenario ${s.id}`, { color: '#5a6670', size: 8.5 })
  p(`Created by ${s.createdByName ?? 'unknown'} on ${s.createdAt}. Computed ${r.computedAt}. ${r.modelVersion}. Report generated ${now.toISOString()} by ${generatedBy}.`, { color: '#5a6670', size: 8.5 })
  p('Simulation only: not stored as, and not linked to, any real incident.', { color: '#5a6670', size: 8.5 })
  if (s.description) { doc.moveDown(0.3); p(s.description) }
  doc.moveDown(0.5)
  const boxY = doc.y
  const boxText = `${r.tier.title}\n${r.tier.summary}\nData quality: ${r.dataQuality.headline}`
  const bh = doc.font('Helvetica').fontSize(9).heightOfString(latin(boxText), { width: W - 16 }) + 14
  doc.rect(40, boxY, W, bh).lineWidth(1.5).fillAndStroke('#fdf1ec', WARN)
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(9).text(latin(r.tier.title), 48, boxY + 6, { width: W - 16 })
  doc.font('Helvetica').text(latin(`${r.tier.summary}\nData quality: ${r.dataQuality.headline}`), 48, doc.y, { width: W - 16 })
  doc.y = boxY + bh + 6
  if (r.warnings.length) { h2('Warnings'); bullets(r.warnings) }

  h2('Map')
  const m = buildMap(s, 760, 540)
  need(m.h * (W / m.w) + 90)
  const sc = W / m.w
  const ox = 40, oy = doc.y
  const T = (x: number, y: number): [number, number] => [ox + x * sc, oy + y * sc]
  for (const q of m.prims) {
    if (q.t === 'rect') { const [x, y] = T(q.x, q.y); doc.save(); if (q.opacity != null) doc.fillOpacity(q.opacity); doc.rect(x, y, q.w * sc, q.h * sc); q.stroke ? doc.fillAndStroke(q.fill, q.stroke) : doc.fill(q.fill); doc.restore() }
    else if (q.t === 'poly') { doc.save(); const pts = q.pts.map(([x, y]) => T(x, y)); doc.moveTo(pts[0][0], pts[0][1]); pts.slice(1).forEach(([x, y]) => doc.lineTo(x, y)); doc.closePath(); if (q.opacity != null) doc.fillOpacity(q.opacity); if (q.dash) doc.dash(4, { space: 3 }); if (q.fill && q.stroke) doc.lineWidth(q.sw ?? 1).fillAndStroke(q.fill, q.stroke); else if (q.fill) doc.fill(q.fill); else doc.lineWidth(q.sw ?? 1).stroke(q.stroke ?? INK); doc.restore() }
    else if (q.t === 'line') { doc.save(); const pts = q.pts.map(([x, y]) => T(x, y)); doc.moveTo(pts[0][0], pts[0][1]); pts.slice(1).forEach(([x, y]) => doc.lineTo(x, y)); doc.lineWidth(q.sw * sc).lineJoin('round').lineCap('round').stroke(q.stroke); doc.restore() }
    else if (q.t === 'circle') { const [x, y] = T(q.cx, q.cy); doc.save(); doc.circle(x, y, q.r * sc); q.stroke ? doc.lineWidth(0.6).fillAndStroke(q.fill, q.stroke) : doc.fill(q.fill); doc.restore() }
    else { const [x, y] = T(q.x, q.y); const w = 200; doc.save().font(q.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(q.size * sc).fillColor(q.fill ?? INK); const left = q.anchor === 'middle' ? x - w / 2 : q.anchor === 'end' ? x - w : x; doc.text(latin(q.text), left, y - q.size * sc * 0.85, { width: w, align: q.anchor === 'middle' ? 'center' : q.anchor === 'end' ? 'right' : 'left', lineBreak: false }); doc.restore() }
  }
  doc.rect(ox, oy, m.w * sc, m.h * sc).lineWidth(0.5).strokeColor('#cfc9bb').stroke()
  doc.y = oy + m.h * sc + 6
  m.legend.forEach((l) => { need(14); const y = doc.y; if (l.shape === 'line') doc.moveTo(40, y + 5).lineTo(54, y + 5).lineWidth(2).strokeColor(l.color).stroke(); else if (l.shape === 'circle') doc.circle(47, y + 5, 4).fill(l.color); else doc.rect(41, y + 1, 12, 8).fill(l.color); doc.fillColor(INK).font('Helvetica').fontSize(8.5).text(latin(l.label), 62, y, { width: W - 24 }); doc.y = y + 12 })

  h2('Inputs'); rows(describeInputs(r).map(([a, b]) => [a, b]), [0.34, 0.66])
  const sm = r.summary
  h2('Results')
  rows([['Selected area', `${sm.areaKm2} km2`], ['Flooded area (estimate)', `${sm.floodedAreaKm2} km2 (${Math.round(sm.floodedFractionOfAssessed * 100)}% of assessed)`], ['Maximum depth (estimate)', unknown(sm.maxDepthM, ' m')], ['Mean depth where flooded (estimate)', unknown(sm.meanDepthM, ' m')], ['Water volume (estimate)', sm.volumeM3 == null ? 'unknown' : `${sm.volumeM3} m3`], ['Working cell size', sm.cellSizeM == null ? 'not applicable' : `about ${sm.cellSizeM} m`], ...(r.tier.depthBands === 'not_supported' ? [['Depth bands', 'not supported: depth is uniform and typed in']] : DEPTH_BANDS.map((b) => [`Area at depth ${b.label}`, `${sm.bandAreasKm2[b.id] ?? 0} km2`]))], [0.45, 0.55])
  h2('Potentially affected assets (approximate)'); rows(exposureRows(r), [0.3, 0.2, 0.5], ['Asset', 'Affected', 'Notes'])
  h2('Data quality')
  rows(r.dataQuality.datasets.map((d) => [d.label, `${stateText[d.state]} / ${levelText[d.level]}`, `${d.source ?? '-'}${d.asOf ? `, as of ${d.asOf}` : ', date unknown'}${d.resolutionM ? `, ${d.resolutionM} m` : ''}${d.count != null ? `, ${d.count} records` : ''}`, [...d.notes, d.error ? `Error: ${d.error}` : ''].filter(Boolean).join(' ')]), [0.18, 0.14, 0.26, 0.42], ['Dataset', 'State / quality', 'Source', 'Notes'])
  h2('Recorded observations')
  const c = r.observations.comparison
  p(c ? `${c.note} Window ${c.windowFrom} to ${c.windowTo}: ${c.n} observation(s), ${c.usable} usable; mean error ${unknown(c.meanErrorM, ' m')}, MAE ${unknown(c.maeM, ' m')}, RMSE ${unknown(c.rmseM, ' m')}.` : `${r.observations.inArea.length} recorded observation(s) lie inside the area. No comparison window was chosen, so no comparison was made.`)
  h2('Assumptions'); bullets(r.assumptions)
  h2('Limitations'); bullets(r.limitations)
  doc.moveDown(0.8); p(r.disclaimer, { size: 8.5, color: '#5a6670' })

  const range = doc.bufferedPageRange()
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i)
    doc.save().rect(0, 0, doc.page.width, 22).fill(WARN)
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(9).text(latin(r.banner.toUpperCase()), 0, 7, { width: doc.page.width, align: 'center', lineBreak: false })
    doc.fillColor('#5a6670').font('Helvetica').fontSize(8).text(latin(`VYRA flood scenario report - ESTIMATE - page ${i + 1} of ${range.count}`), 40, doc.page.height - 30, { width: W, align: 'center', lineBreak: false })
    doc.restore()
  }
  doc.end()
  return done
}
