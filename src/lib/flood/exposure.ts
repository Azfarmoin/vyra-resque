// Geographic intersection of assets with a DepthField. All counts are "intersects the ESTIMATED extent at or above the flooded
// threshold". They are approximate: they inherit the resolution and vertical error of the terrain, and a point sample cannot
// see a kerb, a raised floor or a flood wall.
import { polylineLengthM, samplePolyline, simplifyPath } from './geo'
import type { DepthField } from './field'
import { bandIndexFor, DEPTH_BANDS, type BuildingAsset, type BuildingExposure, type DatasetStatus, type IncidentContext, type IncidentPoint, type Loaded, type PointAsset, type PointExposure, type PointExposureItem, type ResourceAsset, type ResourceExposure, type RoadAsset, type RoadExposure, type RoadExposureItem, type TeamAsset } from './types'

export const ITEM_CAP = 300
const bandId = (d: number) => { const i = bandIndexFor(d); return i >= 0 ? DEPTH_BANDS[i].id : null }
const r2 = (v: number) => Math.round(v * 100) / 100

function unavailable(l: Loaded<unknown>): string {
  return l.status.state === 'failed' ? `The ${l.status.label.toLowerCase()} data could not be loaded.` : `No ${l.status.label.toLowerCase()} data is configured.`
}

export function pointExposure(l: Loaded<PointAsset[]>, field: DepthField, minDepthM: number, cap = ITEM_CAP): PointExposure {
  if (!l.data) return { available: false, reason: unavailable(l), total: null, affected: null, unassessed: 0, truncated: false, items: [] }
  const items: PointExposureItem[] = l.data.map((a) => {
    const d = field.depthAt(a.lat, a.lng)
    return { id: a.id, name: a.name, lat: a.lat, lng: a.lng, depthM: d == null ? null : r2(d), flooded: d != null && d >= minDepthM, band: d != null && d >= minDepthM ? bandId(d) : null, meta: a.meta }
  })
  const assessed = items.filter((i) => i.depthM != null)
  const affected = items.filter((i) => i.flooded)
  const ordered = [...items].sort((a, b) => Number(b.flooded) - Number(a.flooded) || (b.depthM ?? -1) - (a.depthM ?? -1))
  return { available: true, total: assessed.length, affected: affected.length, unassessed: items.length - assessed.length, truncated: ordered.length > cap, items: ordered.slice(0, cap) }
}

/** Depth for a building: deepest of the centre and the footprint corners. */
const buildingDepth = (b: BuildingAsset, field: DepthField): number | null => {
  const pts: [number, number][] = [[b.lat, b.lng], ...(b.ring ?? [])]
  let best: number | null = null
  for (const [la, ln] of pts) { const d = field.depthAt(la, ln); if (d != null && (best == null || d > best)) best = d }
  return best
}

export function buildingExposure(l: Loaded<BuildingAsset[]>, field: DepthField, minDepthM: number, cap = ITEM_CAP): BuildingExposure {
  if (!l.data) return { available: false, reason: unavailable(l), total: null, affected: null, byBand: {}, truncated: false, items: [] }
  const byBand: Record<string, number> = Object.fromEntries(DEPTH_BANDS.map((b) => [b.id, 0]))
  const hit: PointExposureItem[] = []
  let total = 0
  let affected = 0
  for (const b of l.data) {
    const d = buildingDepth(b, field)
    if (d == null) continue
    total++
    if (d >= minDepthM) {
      affected++
      const id = bandId(d)
      if (id) byBand[id]++
      hit.push({ id: b.id, name: b.name || 'Building', lat: b.lat, lng: b.lng, depthM: r2(d), flooded: true, band: id })
    }
  }
  hit.sort((a, b) => (b.depthM ?? 0) - (a.depthM ?? 0))
  return { available: true, total, affected, byBand, truncated: hit.length > cap || l.status.state === 'truncated', items: hit.slice(0, cap) }
}

export function roadExposure(l: Loaded<RoadAsset[]>, field: DepthField, minDepthM: number, cap = 150): RoadExposure {
  const empty = (reason: string): RoadExposure => ({ available: false, reason, totalCount: null, affectedCount: null, totalLengthKm: null, floodedLengthKm: null, bandLengthsKm: {}, truncated: false, items: [] })
  if (!l.data) return empty(unavailable(l))
  const step = Math.min(25, Math.max(5, (field.resolutionM ?? 20) / 2))
  const bandTotals: Record<string, number> = Object.fromEntries(DEPTH_BANDS.map((b) => [b.id, 0]))
  const items: RoadExposureItem[] = []
  let assessedCount = 0
  let affectedCount = 0
  let totalM = 0
  let floodedM = 0
  for (const road of l.data) {
    const samples = samplePolyline(road.path, step)
    let assessedM = 0
    let flM = 0
    let max = 0
    const bl: Record<string, number> = {}
    for (const s of samples) {
      const d = field.depthAt(s.point[0], s.point[1])
      if (d == null) continue
      assessedM += s.segmentM
      if (d >= minDepthM) {
        flM += s.segmentM
        if (d > max) max = d
        const id = bandId(d)
        if (id) bl[id] = (bl[id] ?? 0) + s.segmentM
      }
    }
    if (assessedM === 0) continue
    assessedCount++
    totalM += assessedM
    if (flM > 0) {
      affectedCount++
      floodedM += flM
      for (const [k, v] of Object.entries(bl)) bandTotals[k] += v
      items.push({ id: road.id, name: road.name, roadClass: road.roadClass, source: road.source, lengthM: Math.round(polylineLengthM(road.path)), floodedLengthM: Math.round(flM), maxDepthM: r2(max), bandLengthsM: Object.fromEntries(Object.entries(bl).map(([k, v]) => [k, Math.round(v)])), path: simplifyPath(road.path, 8) })
    }
  }
  items.sort((a, b) => b.floodedLengthM - a.floodedLengthM)
  return {
    available: true,
    totalCount: assessedCount,
    affectedCount,
    totalLengthKm: r2(totalM / 1000),
    floodedLengthKm: r2(floodedM / 1000),
    bandLengthsKm: Object.fromEntries(Object.entries(bandTotals).map(([k, v]) => [k, r2(v / 1000)])),
    truncated: items.length > cap || l.status.state === 'truncated',
    items: items.slice(0, cap),
  }
}

export function resourceExposure(teams: Loaded<TeamAsset[]>, resources: Loaded<ResourceAsset[]>, field: DepthField, minDepthM: number): ResourceExposure {
  const note = 'Supplies are placed at the position of the team that holds them (an inference). Supplies with no team cannot be placed and are not counted.'
  if (!teams.data) return { available: false, reason: unavailable(teams), teamsTotal: null, teamsInExtent: null, teams: [], resourcesByType: {}, note }
  const items: PointExposureItem[] = teams.data.map((t) => {
    const d = field.depthAt(t.lat, t.lng)
    return { id: t.id, name: t.name, lat: t.lat, lng: t.lng, depthM: d == null ? null : r2(d), flooded: d != null && d >= minDepthM, band: d != null && d >= minDepthM ? bandId(d) : null, meta: { teamType: t.teamType, status: t.status } }
  })
  const floodedTeams = new Set(items.filter((i) => i.flooded).map((i) => i.id))
  const assessedTeams = new Set(items.filter((i) => i.depthM != null).map((i) => i.id))
  const byType: ResourceExposure['resourcesByType'] = {}
  if (resources.data) {
    for (const r of resources.data) {
      if (!r.teamId || !assessedTeams.has(r.teamId)) continue
      const e = (byType[r.resourceType] ??= { quantityTotal: 0, quantityInExtent: 0 })
      e.quantityTotal += r.quantity
      if (floodedTeams.has(r.teamId)) e.quantityInExtent += r.quantity
    }
  }
  return {
    available: true,
    reason: resources.data ? undefined : 'Supply records could not be loaded, so supplies are not counted.',
    teamsTotal: assessedTeams.size,
    teamsInExtent: floodedTeams.size,
    teams: items.filter((i) => i.depthM != null).sort((a, b) => Number(b.flooded) - Number(a.flooded)),
    resourcesByType: byType,
    note,
  }
}

export function incidentContext(l: Loaded<IncidentPoint[]>, field: DepthField, minDepthM: number): IncidentContext {
  const note = 'Read only. These real reports are shown for context. The simulator never changes an incident, its priority, its status or any dispatch, and a report outside the estimate is not safer for it.'
  if (!l.data) return { available: false, reason: unavailable(l), openInExtent: null, byPriority: {}, ids: [], note }
  const hit = l.data.filter((i) => { const d = field.depthAt(i.lat, i.lng); return d != null && d >= minDepthM })
  const byPriority: Record<string, number> = {}
  for (const h of hit) byPriority[h.priority] = (byPriority[h.priority] ?? 0) + 1
  return { available: true, openInExtent: hit.length, byPriority, ids: hit.slice(0, 50).map((h) => h.id), note }
}

export const statusOf = (l: Loaded<unknown>): DatasetStatus => l.status
