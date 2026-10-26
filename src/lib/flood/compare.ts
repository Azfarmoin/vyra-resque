// Scenario comparison. Honest about what is and is not like-for-like.
import { fieldFromStored } from './scenario'
import { bboxesIntersect, makeGridSpec, cellCenter } from './geo'
import type { StoredScenario } from './repo'
import type { BBox } from './types'

export interface Delta { metric: string; unit: string; a: number | null; b: number | null; delta: number | null }
export interface Comparison {
  a: { id: string; name: string; tier: string; kind: string; computedAt: string }
  b: { id: string; name: string; tier: string; kind: string; computedAt: string }
  deltas: Delta[]
  spatial: { sampled: boolean; bothKm2: number | null; onlyAKm2: number | null; onlyBKm2: number | null; overlapOfAreasKm2: number | null; note: string }
  warnings: string[]
  isEstimate: true
}

const d = (metric: string, unit: string, a: number | null | undefined, b: number | null | undefined): Delta => {
  const av = a ?? null
  const bv = b ?? null
  return { metric, unit, a: av, b: bv, delta: av == null || bv == null ? null : Math.round((bv - av) * 1000) / 1000 }
}

export function compareScenarios(A: StoredScenario, B: StoredScenario): Comparison {
  const ra = A.results
  const rb = B.results
  const warnings: string[] = []
  if (ra.tier.id !== rb.tier.id) warnings.push(`Not like-for-like: A is "${ra.tier.title}" and B is "${rb.tier.title}". Differences partly reflect the method, not only the conditions.`)
  const ca = ra.summary.cellSizeM
  const cb = rb.summary.cellSizeM
  if (ca != null && cb != null && Math.abs(ca - cb) / Math.max(ca, cb) > 0.25) warnings.push(`The scenarios were computed at different resolutions (about ${Math.round(ca)} m and ${Math.round(cb)} m).`)
  const unknownIn = (k: 'shelters' | 'hospitals' | 'buildings') => !ra.exposure[k].available || !rb.exposure[k].available
  for (const k of ['shelters', 'hospitals', 'buildings'] as const) if (unknownIn(k)) warnings.push(`The ${k} count is unknown in at least one scenario (dataset missing or failed), so it cannot be compared.`)
  if (!ra.exposure.roads.available || !rb.exposure.roads.available) warnings.push('The road network was unavailable in at least one scenario, so road lengths cannot be compared.')
  const gap = Math.abs(Date.parse(ra.computedAt) - Date.parse(rb.computedAt)) / 86_400_000
  if (gap > 7) warnings.push(`The scenarios were computed ${Math.round(gap)} days apart; asset datasets may have changed in between.`)
  if (ra.area.areaKm2 > 0 && Math.abs(ra.area.areaKm2 - rb.area.areaKm2) / ra.area.areaKm2 > 0.05) warnings.push('The two scenarios cover different areas; totals are not directly comparable.')

  const deltas: Delta[] = [
    d('Flooded area', 'km2', ra.summary.floodedAreaKm2, rb.summary.floodedAreaKm2),
    d('Maximum depth', 'm', ra.summary.maxDepthM, rb.summary.maxDepthM),
    d('Mean depth (flooded cells)', 'm', ra.summary.meanDepthM, rb.summary.meanDepthM),
    d('Water volume', 'm3', ra.summary.volumeM3, rb.summary.volumeM3),
    d('Shelters affected', 'count', ra.exposure.shelters.affected, rb.exposure.shelters.affected),
    d('Hospitals affected', 'count', ra.exposure.hospitals.affected, rb.exposure.hospitals.affected),
    d('Road length flooded', 'km', ra.exposure.roads.floodedLengthKm, rb.exposure.roads.floodedLengthKm),
    d('Roads affected', 'count', ra.exposure.roads.affectedCount, rb.exposure.roads.affectedCount),
    d('Reported blocked roads affected', 'count', ra.exposure.blockedRoadRegister.affectedCount, rb.exposure.blockedRoadRegister.affectedCount),
    d('Buildings affected', 'count', ra.exposure.buildings.affected, rb.exposure.buildings.affected),
    d('Rescue teams inside extent', 'count', ra.exposure.resources.teamsInExtent, rb.exposure.resources.teamsInExtent),
    d('Open incident reports inside extent', 'count', ra.exposure.incidents.openInExtent, rb.exposure.incidents.openInExtent),
  ]

  // Spatial overlap on a common grid over the intersection of the two areas.
  let spatial: Comparison['spatial'] = { sampled: false, bothKm2: null, onlyAKm2: null, onlyBKm2: null, overlapOfAreasKm2: null, note: 'The two areas do not overlap, so there is no spatial comparison.' }
  const ba = ra.area.bbox
  const bb = rb.area.bbox
  if (bboxesIntersect(ba, bb)) {
    const inter: BBox = [Math.max(ba[0], bb[0]), Math.max(ba[1], bb[1]), Math.min(ba[2], bb[2]), Math.min(ba[3], bb[3])]
    try {
      const fa = A.layers ? fieldFromStored(A.area, A.layers) : null
      const fb = B.layers ? fieldFromStored(B.area, B.layers) : null
      if (fa && fb) {
        const spec = makeGridSpec(inter, 40, 90_000)
        const cellKm2 = (spec.cellWM * spec.cellHM) / 1e6
        const minA = (ra.inputs as { options?: { minDepthM?: number } })?.options?.minDepthM ?? 0.1
        const minB = (rb.inputs as { options?: { minDepthM?: number } })?.options?.minDepthM ?? 0.1
        let both = 0, onlyA = 0, onlyB = 0, common = 0
        for (let r = 0; r < spec.ny; r++) for (let c = 0; c < spec.nx; c++) {
          const [la, ln] = cellCenter(spec, c, r)
          const x = fa.depthAt(la, ln)
          const y = fb.depthAt(la, ln)
          if (x == null || y == null) continue
          common++
          const xa = x >= minA
          const yb = y >= minB
          if (xa && yb) both++
          else if (xa) onlyA++
          else if (yb) onlyB++
        }
        spatial = {
          sampled: true, bothKm2: Math.round(both * cellKm2 * 1000) / 1000, onlyAKm2: Math.round(onlyA * cellKm2 * 1000) / 1000, onlyBKm2: Math.round(onlyB * cellKm2 * 1000) / 1000,
          overlapOfAreasKm2: Math.round(common * cellKm2 * 1000) / 1000, note: `Sampled on a ${Math.round(Math.sqrt(spec.cellWM * spec.cellHM))} m grid over the part of both areas that both scenarios assessed.`,
        }
      } else spatial.note = 'A scenario has no stored map layer, so there is no spatial comparison.'
    } catch {
      spatial.note = 'The spatial comparison could not be computed.'
    }
  }
  const meta = (s: StoredScenario) => ({ id: s.id, name: s.name, tier: s.results.tier.title, kind: s.kind, computedAt: s.computedAt })
  return { a: meta(A), b: meta(B), deltas, spatial, warnings, isEstimate: true }
}
