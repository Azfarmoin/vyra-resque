// Supplementary evidence for the EXISTING route analysis and shelter views. Nothing here changes a route's status, rank,
// recommendation or a dispatcher decision, and nothing recommends or reorders shelters: it only adds "what the estimate says".
import { fieldFromStored } from './scenario'
import { cellCenter, padBBox, polylineLengthM, samplePolyline, distanceM } from './geo'
import { unpackGrid } from './field'
import { DEPTH_BANDS, bandIndexFor, type LatLng, type PointAsset } from './types'
import type { StoredScenario } from './repo'
import type { AssetProviders } from './assets'

export interface RouteFloodEvidence {
  routeId: string
  lengthM: number
  assessedLengthM: number
  floodedLengthM: number
  maxDepthM: number | null
  bandLengthsM: Record<string, number>
  /** 'unknown' when none of the route lies inside the assessed area. Never "clear". */
  intersectsEstimatedExtent: 'yes' | 'no_within_assessed_part' | 'unknown'
  floodedRuns: LatLng[][]
  note: string
}
export interface RouteFloodResult { scenarioId: string; scenarioName: string; tier: string; isEstimate: true; computedAt: string; supplementary: true; routes: RouteFloodEvidence[]; caveats: string[] }

export function routeExposure(s: StoredScenario, routes: { id: string; geometry: LatLng[] }[]): RouteFloodResult {
  if (!s.layers) throw new Error('This scenario has no stored map layer.')
  const field = fieldFromStored(s.area, s.layers)
  const minDepth = (s.results.inputs as { options?: { minDepthM?: number } })?.options?.minDepthM ?? 0.1
  const step = Math.min(25, Math.max(5, (field.resolutionM ?? 20) / 2))
  const out: RouteFloodEvidence[] = routes.map((r) => {
    const samples = samplePolyline(r.geometry, step)
    let assessed = 0
    let flooded = 0
    let max = -1
    const bl: Record<string, number> = {}
    const runs: LatLng[][] = []
    let cur: LatLng[] | null = null
    for (const sm of samples) {
      const d = field.depthAt(sm.point[0], sm.point[1])
      if (d == null) { cur = null; continue }
      assessed += sm.segmentM
      if (d >= minDepth) {
        flooded += sm.segmentM
        max = Math.max(max, d)
        const bi = bandIndexFor(d)
        if (bi >= 0) bl[DEPTH_BANDS[bi].id] = (bl[DEPTH_BANDS[bi].id] ?? 0) + sm.segmentM
        if (!cur) { cur = []; if (runs.length < 200) runs.push(cur) }
        cur.push(sm.point)
      } else cur = null
    }
    const len = polylineLengthM(r.geometry)
    return {
      routeId: r.id, lengthM: Math.round(len), assessedLengthM: Math.round(assessed), floodedLengthM: Math.round(flooded), maxDepthM: max >= 0 ? Math.round(max * 100) / 100 : null,
      bandLengthsM: Object.fromEntries(Object.entries(bl).map(([k, v]) => [k, Math.round(v)])),
      intersectsEstimatedExtent: assessed === 0 ? 'unknown' : flooded > 0 ? 'yes' : 'no_within_assessed_part',
      floodedRuns: runs,
      note: assessed === 0 ? 'This route is entirely outside the area the scenario assessed, so the scenario says nothing about it.' : assessed < len * 0.95 ? `Only ${Math.round((100 * assessed) / Math.max(1, len))}% of this route lies inside the assessed area; the rest is unknown.` : 'The whole route lies inside the assessed area.',
    }
  })
  return {
    scenarioId: s.id, scenarioName: s.name, tier: s.results.tier.title, isEstimate: true, computedAt: s.computedAt, supplementary: true, routes: out,
    caveats: ['ESTIMATE from a simulation, not a real event. It does not change the route analysis, the route ranking or any dispatcher decision.', 'Not finding water on a route in this estimate does NOT mean the route is passable.', s.results.dataQuality.headline],
  }
}

export type ShelterEvidenceKind = 'inside_estimated_extent' | 'near_estimated_extent' | 'outside_extent_within_assessed_area' | 'outside_assessed_area'
export interface ShelterEvidence {
  id: string; name: string; lat: number; lng: number
  status: string | null; capacity: number | null; occupancy: number | null
  depthM: number | null; evidence: ShelterEvidenceKind; nearestFloodedM: number | null
  note: string
}
export interface ShelterFloodResult { scenarioId: string; scenarioName: string; tier: string; isEstimate: true; supplementary: true; nearM: number; shelters: ShelterEvidence[]; caveats: string[]; datasetState: string }

export async function shelterEvidence(s: StoredScenario, assets: AssetProviders, nearM = 250): Promise<ShelterFloodResult> {
  if (!s.layers) throw new Error('This scenario has no stored map layer.')
  const field = fieldFromStored(s.area, s.layers)
  const minDepth = (s.results.inputs as { options?: { minDepthM?: number } })?.options?.minDepthM ?? 0.1
  const loaded = await assets.shelters(padBBox(s.results.area.bbox, 2000))
  // Flooded cell centres, for nearest-distance (grid scenarios only).
  let centres: LatLng[] | null = null
  if (s.layers.kind === 'grid') {
    const { spec, depth } = unpackGrid(s.layers.grid)
    centres = []
    for (let r = 0; r < spec.ny; r++) for (let c = 0; c < spec.nx; c++) { const d = depth[r * spec.nx + c]; if (Number.isFinite(d) && d >= minDepth) centres.push(cellCenter(spec, c, r)) }
  }
  const items: ShelterEvidence[] = (loaded.data ?? []).map((p: PointAsset) => {
    const d = field.depthAt(p.lat, p.lng)
    let nearest: number | null = null
    if (centres && d != null && d < minDepth) { let best = Infinity; for (const c of centres) { const m = distanceM([p.lat, p.lng], c); if (m < best) best = m } nearest = Number.isFinite(best) ? Math.round(best) : null }
    const evidence: ShelterEvidenceKind = d == null ? 'outside_assessed_area' : d >= minDepth ? 'inside_estimated_extent' : nearest != null && nearest <= nearM ? 'near_estimated_extent' : 'outside_extent_within_assessed_area'
    const note = { inside_estimated_extent: 'Inside the estimated flood extent in this scenario.', near_estimated_extent: `Within ${nearM} m of the estimated flood extent.`, outside_extent_within_assessed_area: 'Not inside the estimated extent. This does not make it safe or reachable.', outside_assessed_area: 'Outside the area this scenario assessed: the scenario says nothing about it.' }[evidence]
    const m = p.meta ?? {}
    return { id: p.id, name: p.name, lat: p.lat, lng: p.lng, status: (m.status as string) ?? null, capacity: (m.capacity as number) ?? null, occupancy: (m.occupancy as number) ?? null, depthM: d == null ? null : Math.round(d * 100) / 100, evidence, nearestFloodedM: nearest, note }
  })
  return {
    scenarioId: s.id, scenarioName: s.name, tier: s.results.tier.title, isEstimate: true, supplementary: true, nearM, shelters: items, datasetState: loaded.status.state,
    caveats: ['ESTIMATE from a simulation, not a real event. Shelters are listed in their usual order; this view does not rank, recommend or change any shelter.', 'Access roads to a shelter are not assessed here: a shelter outside the estimate may still be cut off.', ...(loaded.data ? [] : ['Shelter data could not be loaded.'])],
  }
}
