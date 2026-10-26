// Coverage analysis and hypothetical-site comparison.
//
// HONEST LIMITS (also returned to the UI in `method` and `disclaimer`):
//  * Travel time here is a STRAIGHT-LINE ESTIMATE (distance x 1.4 at 30 km/h), not a road route. Calling the routing engine
//    for every grid cell would be slow and rate-limited. Use the recommendation endpoint for real routes to a chosen site.
//  * VYRA has no population layer. "Demand" is people counted on OPEN incident reports, so quiet-but-populated areas can look
//    fine. Treat the map as "where known incidents have limited shelter access", not "where people live".
//  * A hypothetical site is compared on access only. Nothing here says a location is suitable, safe, legal or buildable.
import type { Hazard } from '../routing/types'
import { haversineM } from '../routing/geo'
import type { DisasterZone } from '../zones/types'
import { activeExceptions, estimateMinutes } from './engine'
import { availability, dataQuality, normaliseShelter } from './facilities'
import { siteRisk } from './risk'
import type { ShelterException, ShelterRecord } from './types'
import { pointInZone } from '../zones/geometry'
import { displayState } from '../zones/rules'

export const COVERAGE_DISCLAIMER =
  'Planning aid only. This compares shelter ACCESS using straight-line travel estimates and reported incidents. It does not show that a location is suitable or safe for a shelter or for construction: that needs a professional site assessment (structural, flood and geotechnical risk, land ownership and permits, utilities, and community consultation).'

export interface DemandPoint { lat: number; lng: number; people: number }
export interface Hypothetical { id: string; name: string; lat: number; lng: number; capacity: number }
export type CellClass = 'none' | 'limited' | 'adequate'
export interface Cell { row: number; col: number; lat: number; lng: number; sizeM: number; nearestMin: number | null; sheltersInReach: number; capacityInReach: number; demandPeople: number; cls: CellClass; inHazardZone: boolean }
export interface CoverageSummary { cells: number; none: number; limited: number; adequate: number; demandPeople: number; demandNone: number; demandLimited: number; avgNearestMinDemand: number | null }
export interface CoverageResult {
  generatedAt: string; reachMinutes: number; cellKm: number; cellM: number
  bounds: { south: number; west: number; north: number; east: number }
  cells: Cell[]; summary: CoverageSummary
  sheltersUsed: { id: string; name: string; lat: number; lng: number; available: number; hypothetical: boolean }[]
  sheltersNotCounted: { id: string; name: string; reason: string }[]
  method: string[]; disclaimer: string
}

export interface CoverageContext {
  shelters: ShelterRecord[]; exceptions: ShelterException[]; hazards: Hazard[]; zones: DisasterZone[]; demand: DemandPoint[]
  cellKm: number; reachMinutes: number; now: Date
}

const M_PER_DEG = 111_195
const MAX_CELLS = 6000

interface Source { id: string; name: string; lat: number; lng: number; available: number; hypothetical: boolean }

function eligibleSources(ctx: CoverageContext): { used: Source[]; skipped: CoverageResult['sheltersNotCounted'] } {
  const used: Source[] = []
  const skipped: CoverageResult['sheltersNotCounted'] = []
  for (const raw of ctx.shelters) {
    const s = normaliseShelter(raw as unknown as Record<string, unknown>)
    const why = (reason: string) => skipped.push({ id: s.id, name: s.name, reason })
    if (s.location_lat == null || s.location_lng == null) { why('No coordinates.'); continue }
    if (s.verification_status !== 'verified') { why(s.verification_status === 'rejected' ? 'Rejected record.' : 'Not verified, so it is not counted as coverage.'); continue }
    const ex = activeExceptions(ctx.exceptions, s.id, ctx.now)
    if (s.status === 'closed' && !ex.some((e) => e.kind === 'closed_use')) { why('Closed.'); continue }
    const overflow = ex.filter((e) => e.kind === 'over_capacity').reduce((n, e) => n + e.extra_capacity, 0)
    const av = availability({ ...s, authorized_overflow: overflow }, dataQuality(s, ctx.now))
    if (av.max == null) { why('Capacity unknown.'); continue }
    if (s.status === 'full' && !overflow) { why('Full.'); continue }
    if (!av.available) { why('No free places.'); continue }
    const risk = siteRisk([s.location_lat, s.location_lng], s, { hazards: ctx.hazards, zones: ctx.zones, now: ctx.now })
    if (risk.blocked) { why('Inside or next to a verified hazard.'); continue }
    used.push({ id: s.id, name: s.name, lat: s.location_lat, lng: s.location_lng, available: av.available, hypothetical: false })
  }
  return { used, skipped }
}

export interface FixedGrid { bounds: CoverageResult['bounds']; cellM: number }

export function analyseCoverage(ctx: CoverageContext, extra: Hypothetical[] = [], fixed?: FixedGrid): CoverageResult {
  const { used, skipped } = eligibleSources(ctx)
  const sources: Source[] = [...used, ...extra.map((h) => ({ id: h.id, name: h.name, lat: h.lat, lng: h.lng, available: h.capacity, hypothetical: true }))]
  const pts: [number, number][] = [...sources.map((s) => [s.lat, s.lng] as [number, number]), ...ctx.demand.map((d) => [d.lat, d.lng] as [number, number])]
  const reachM = (ctx.reachMinutes * ((30_000 / 60) / 1.4)) // metres straight-line that fit in the time budget
  const result = (cells: Cell[], bounds: CoverageResult['bounds'], cellMUsed = ctx.cellKm * 1000): CoverageResult => ({
    generatedAt: ctx.now.toISOString(), reachMinutes: ctx.reachMinutes, cellKm: ctx.cellKm, cellM: cellMUsed, bounds, cells, summary: summarise(cells), sheltersUsed: sources, sheltersNotCounted: skipped,
    method: [
      `Travel time is a straight-line estimate (distance x 1.4 at 30 km/h), not a road route. "In reach" means within ${ctx.reachMinutes} estimated minutes.`,
      'Demand is people counted on open incident reports. VYRA has no population data, so quiet populated areas may look adequate.',
      'Only verified, open, non-full shelters outside verified hazards count as coverage. Unverified shelters are listed but not counted.',
      'A cell is "limited" when only one shelter is in reach, or when free places in reach are under twice the reported demand there.',
    ],
    disclaimer: COVERAGE_DISCLAIMER,
  })
  if (!pts.length && !fixed) return result([], { south: 0, west: 0, north: 0, east: 0 })

  let south: number, north: number, west: number, east: number
  if (fixed) ({ south, north, west, east } = fixed.bounds)
  else {
    south = Math.min(...pts.map((p) => p[0])); north = Math.max(...pts.map((p) => p[0]))
    west = Math.min(...pts.map((p) => p[1])); east = Math.max(...pts.map((p) => p[1]))
    const pad = Math.min(reachM, 15_000) / M_PER_DEG
    south -= pad; north += pad; west -= pad; east += pad
  }
  const midLat = (south + north) / 2
  const mPerLng = M_PER_DEG * Math.cos((midLat * Math.PI) / 180)
  let cellM = fixed ? fixed.cellM : ctx.cellKm * 1000
  // Keep the grid bounded: coarsen the cell size instead of refusing or running forever.
  while (!fixed && Math.ceil(((north - south) * M_PER_DEG) / cellM) * Math.ceil(((east - west) * mPerLng) / cellM) > MAX_CELLS) cellM *= 1.25
  const rows = Math.ceil(((north - south) * M_PER_DEG) / cellM)
  const cols = Math.ceil(((east - west) * mPerLng) / cellM)
  const dLat = cellM / M_PER_DEG, dLng = cellM / mPerLng

  const demandGrid = new Map<number, number>()
  for (const d of ctx.demand) {
    const r = Math.min(rows - 1, Math.max(0, Math.floor((d.lat - south) / dLat)))
    const c = Math.min(cols - 1, Math.max(0, Math.floor((d.lng - west) / dLng)))
    demandGrid.set(r * cols + c, (demandGrid.get(r * cols + c) ?? 0) + d.people)
  }
  const dangerZones = ctx.zones.filter((z) => (z.zone_type === 'danger' || z.zone_type === 'restricted') && (z.verification_status === 'official' || z.verification_status === 'human_verified'))
  const cells: Cell[] = []
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const lat = south + (r + 0.5) * dLat, lng = west + (c + 0.5) * dLng
    const demand = demandGrid.get(r * cols + c) ?? 0
    let nearest = Infinity, inReach = 0, cap = 0, nearAnything = demand > 0
    for (const s of sources) {
      const m = haversineM([lat, lng], [s.lat, s.lng])
      if (m <= reachM * 1.2) nearAnything = true
      const min = estimateMinutes(m)
      if (min < nearest) nearest = min
      if (min <= ctx.reachMinutes) { inReach++; cap += s.available }
    }
    // Cells far from every shelter AND every incident are outside the area of interest: scoring them "none" would be noise.
    if (!nearAnything) continue
    const cls: CellClass = inReach === 0 ? 'none' : inReach === 1 || (demand > 0 && cap < demand * 2) ? 'limited' : 'adequate'
    cells.push({ row: r, col: c, lat, lng, sizeM: cellM, nearestMin: Number.isFinite(nearest) ? Math.round(nearest) : null, sheltersInReach: inReach, capacityInReach: cap, demandPeople: demand, cls, inHazardZone: dangerZones.some((z) => { try { return displayState(z, ctx.now.getTime()) === 'active' && pointInZone([lng, lat], z.geometry, z.radius_m) } catch { return false } }) })
  }
  return result(cells, { south, west, north, east }, cellM)
}


function summarise(cells: Cell[]): CoverageSummary {
  const s: CoverageSummary = { cells: cells.length, none: 0, limited: 0, adequate: 0, demandPeople: 0, demandNone: 0, demandLimited: 0, avgNearestMinDemand: null }
  let sumMin = 0, w = 0
  for (const c of cells) {
    s[c.cls]++
    s.demandPeople += c.demandPeople
    if (c.cls === 'none') s.demandNone += c.demandPeople
    if (c.cls === 'limited') s.demandLimited += c.demandPeople
    if (c.demandPeople > 0 && c.nearestMin != null) { sumMin += c.nearestMin * c.demandPeople; w += c.demandPeople }
  }
  s.avgNearestMinDemand = w ? Math.round((sumMin / w) * 10) / 10 : null
  return s
}

export interface CandidateComparison {
  id: string; name: string; lat: number; lng: number; capacity: number
  noneCellsBefore: number; noneCellsAfter: number; limitedCellsBefore: number; limitedCellsAfter: number
  demandNewlyReached: number // people on open reports whose cell goes from "no shelter in reach" to at least one
  demandLessLimited: number
  avgNearestMinBefore: number | null; avgNearestMinAfter: number | null
  siteFlags: string[]; notAssessed: string[]
  note: string
}
export interface HypotheticalReport {
  baseline: CoverageSummary
  candidates: CandidateComparison[] // best first
  combined: { summary: CoverageSummary; demandNewlyReached: number } | null
  coverageWithAll: CoverageResult | null
  disclaimer: string
}

export function compareHypotheticals(ctx: CoverageContext, hyps: Hypothetical[]): HypotheticalReport {
  const base = analyseCoverage(ctx)
  const key = (c: Cell) => `${c.row}:${c.col}`
  const baseCells = new Map(base.cells.map((c) => [key(c), c]))
  // Compare like with like: only cells that were already in the baseline area of interest. Cells that exist only because the
  // new site lies near them would otherwise inflate the "limited" count and make a helpful site look worse.
  const restrict = (r: CoverageResult): CoverageResult => { const cells = r.cells.filter((c) => baseCells.has(key(c))); return { ...r, cells, summary: summarise(cells) } }
  const delta = (after: CoverageResult) => {
    let reached = 0, less = 0
    for (const c of after.cells) {
      const b = baseCells.get(key(c))
      if (b && b.cls === 'none' && c.cls !== 'none') reached += c.demandPeople
      else if (b && b.cls === 'limited' && c.cls === 'adequate') less += c.demandPeople
    }
    return { reached, less }
  }
  const out: CandidateComparison[] = hyps.map((h) => {
    // Each candidate is evaluated on the SAME grid as the baseline, so cells line up. Bounds can grow when a site lies outside the
    // baseline area; cells are matched by centre rather than index in that case.
    const after = restrict(analyseCoverageAligned(ctx, base, [h]))
    const d = delta(after)
    const risk = siteRisk([h.lat, h.lng], { infrastructure_dependencies: [], facilities: {}, verification_status: 'unverified', last_verified_at: null, id: h.id, name: h.name }, { hazards: ctx.hazards, zones: ctx.zones, now: ctx.now })
    const flags = [...risk.reasons.filter((r) => r.severity !== 'info'), ...risk.access].map((r) => r.message)
    return {
      id: h.id, name: h.name, lat: h.lat, lng: h.lng, capacity: h.capacity,
      noneCellsBefore: base.summary.none, noneCellsAfter: after.summary.none, limitedCellsBefore: base.summary.limited, limitedCellsAfter: after.summary.limited,
      demandNewlyReached: d.reached, demandLessLimited: d.less, avgNearestMinBefore: base.summary.avgNearestMinDemand, avgNearestMinAfter: after.summary.avgNearestMinDemand,
      siteFlags: flags,
      notAssessed: ['Structural and construction suitability', 'Flood and geotechnical risk beyond the recorded hazards', 'Land ownership, permits and community acceptance', 'Utilities, sanitation and staffing', 'Road access (straight-line estimate only)'],
      note: flags.length ? 'Potential exposure is recorded at this location. Treat it with extra caution.' : 'No hazard exposure is recorded here in the available data. That is not an assessment of suitability.',
    }
  }).sort((a, b) => b.demandNewlyReached - a.demandNewlyReached || (b.noneCellsBefore - b.noneCellsAfter) - (a.noneCellsBefore - a.noneCellsAfter) || b.demandLessLimited - a.demandLessLimited || a.id.localeCompare(b.id))

  let combined: HypotheticalReport['combined'] = null
  let all: CoverageResult | null = null
  if (hyps.length > 1) {
    all = analyseCoverageAligned(ctx, base, hyps)
    const allR = restrict(all)
    combined = { summary: allR.summary, demandNewlyReached: delta(allR).reached }
  }
  return { baseline: base.summary, candidates: out, combined, coverageWithAll: all, disclaimer: COVERAGE_DISCLAIMER }
}

/** Same grid as `base`, so before/after cells line up by (row, col). */
function analyseCoverageAligned(ctx: CoverageContext, base: CoverageResult, hyps: Hypothetical[]): CoverageResult {
  return analyseCoverage(ctx, hyps, { bounds: base.bounds, cellM: base.cellM })
}
