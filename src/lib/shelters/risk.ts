// Site exposure for ONE shelter location: verified/potential hazard exposure, access problems near the entrance, and
// infrastructure-dependency risk. Used by the recommendation engine, the dashboard and the coverage analysis, so all three
// agree. It reads the EXISTING hazard model (src/lib/routing/types.ts Hazard, built from route_hazards, blocked_roads and
// incident reports) and the EXISTING disaster zones (src/lib/zones). It does not add a hazard store.
//
// VYRA has no flood simulator and no infrastructure network model. What this file can honestly say is limited to:
//   * the shelter point lies inside / near an active mapped zone or recorded hazard,
//   * a caller-supplied flood scenario (polygons) covers the point,
//   * the shelter says it depends on grid power / municipal water / one access road, and a recorded hazard of that
//     kind is nearby while no documented backup exists.
// "No exposure found" therefore means "none in the available data", never "safe".
import { haversineM, nearestOnPolyline } from '../routing/geo'
import type { Hazard, LatLng } from '../routing/types'
import { pointInZone } from '../zones/geometry'
import { displayState } from '../zones/rules'
import type { DisasterZone, ZoneGeometry } from '../zones/types'
import { isDocumented } from './facilities'
import type { ShelterRecord } from './types'

export interface Reason { code: string; severity: 'block' | 'flag' | 'info'; message: string }
export interface FloodScenario { name: string; polygons: ZoneGeometry[]; excludeExposed?: boolean; source?: string }
export interface RiskContext { hazards: Hazard[]; zones: DisasterZone[]; floodScenario?: FloodScenario | null; now: Date }

export const EXPOSURE_FLAG_M = 500
export const EXPOSURE_BLOCK_M = 100
export const FIRE_GAS_BLOCK_M = 300
export const ACCESS_RADIUS_M = 300
export const DEPENDENCY_RADIUS_M = 1500
const STALE_HAZARD_MIN = 6 * 60

const SITE_KINDS = new Set(['flooding', 'structural_collapse', 'fire', 'gas_leak', 'landslide'])
const ACCESS_KINDS = new Set(['road_closure', 'debris', 'flooding', 'damaged_infrastructure', 'structural_collapse'])
const POWER_KINDS = new Set(['electrical', 'gas_leak', 'damaged_infrastructure', 'fire'])

const KIND_WORD: Record<string, string> = {
  flooding: 'flooding', structural_collapse: 'structural collapse', fire: 'fire', gas_leak: 'gas leak', landslide: 'landslide', electrical: 'electrical hazard',
  road_closure: 'road closure', debris: 'debris', damaged_infrastructure: 'damaged infrastructure', other: 'hazard',
}

/** Distance from a point to the hazard's footprint, in metres (0 = inside). */
export function gapToHazard(p: LatLng, h: Hazard): number {
  if (h.geometry.type === 'point') return Math.max(0, haversineM(p, h.geometry.point) - h.geometry.radiusM)
  const n = nearestOnPolyline(p, h.geometry.path)
  return n ? n.distanceM : Infinity
}

const isActive = (h: Hazard) => h.verification !== 'resolved' && h.verification !== 'expired'
const ageMin = (h: Hazard, now: Date) => {
  const t = Date.parse(h.lastVerifiedAt || h.reportedAt || '')
  return Number.isFinite(t) ? Math.round((now.getTime() - t) / 60_000) : null
}
const rounded = (m: number) => (m < 50 ? 'at the site' : m < 1000 ? `about ${Math.round(m / 10) * 10} m away` : `about ${(m / 1000).toFixed(1)} km away`)

export interface SiteRisk {
  reasons: Reason[] // hazard / zone / scenario exposure
  access: Reason[] // problems reaching the entrance
  dependencies: Reason[] // infrastructure the shelter relies on
  nearestSiteHazardM: number | null
  blocked: boolean
}

export function siteRisk(point: LatLng, shelter: Pick<ShelterRecord, 'infrastructure_dependencies' | 'facilities' | 'verification_status' | 'last_verified_at' | 'id' | 'name'> & Partial<ShelterRecord>, ctx: RiskContext): SiteRisk {
  const reasons: Reason[] = []
  const access: Reason[] = []
  const dependencies: Reason[] = []
  let nearest: number | null = null
  const nowMs = ctx.now.getTime()
  const hasBackup = isDocumented(shelter as ShelterRecord, 'backup_power')

  // ---- recorded hazards ----
  for (const h of ctx.hazards) {
    if (!isActive(h)) continue
    const gap = gapToHazard(point, h)
    if (!Number.isFinite(gap)) continue
    const age = ageMin(h, ctx.now)
    const confirmed = h.verification === 'confirmed'
    const staleNote = age == null ? ' (report age unknown)' : age > STALE_HAZARD_MIN ? ` (last updated ${Math.round(age / 60)} h ago, may be out of date)` : ''
    const word = KIND_WORD[h.kind] ?? 'hazard'
    const status = confirmed ? 'confirmed' : 'UNVERIFIED'

    if (SITE_KINDS.has(h.kind)) {
      nearest = nearest == null ? gap : Math.min(nearest, gap)
      const blockM = h.kind === 'fire' || h.kind === 'gas_leak' ? FIRE_GAS_BLOCK_M : EXPOSURE_BLOCK_M
      if (confirmed && (h.severity === 'high' || h.severity === 'critical') && gap <= blockM) {
        reasons.push({ code: 'verified_hazard_exposure', severity: 'block', message: `A ${status} ${h.severity} ${word} is recorded ${rounded(gap)}: "${h.description}".${staleNote}` })
      } else if (gap <= EXPOSURE_FLAG_M) {
        reasons.push({ code: 'potential_hazard_exposure', severity: 'flag', message: `Potential exposure: a ${status} ${h.severity} ${word} is recorded ${rounded(gap)}: "${h.description}".${staleNote}` })
      }
    }
    if (ACCESS_KINDS.has(h.kind) && gap <= ACCESS_RADIUS_M && h.blocksRoad !== false) {
      access.push({
        code: 'access_problem', severity: 'flag',
        message: `${confirmed ? 'Confirmed' : 'UNVERIFIED'} ${word} ${rounded(gap)} may affect access to the entrance: "${h.description}".${staleNote}`,
      })
    }
    if (gap <= DEPENDENCY_RADIUS_M) {
      if (POWER_KINDS.has(h.kind) && shelter.infrastructure_dependencies?.includes('grid_power') && !hasBackup) {
        dependencies.push({ code: 'dependency_at_risk', severity: 'flag', message: `The shelter relies on grid power with no documented backup, and a ${status} ${word} is recorded ${rounded(gap)}.` })
      }
      if ((h.kind === 'flooding' || h.kind === 'damaged_infrastructure') && shelter.infrastructure_dependencies?.includes('municipal_water')) {
        dependencies.push({ code: 'dependency_at_risk', severity: 'flag', message: `The shelter relies on municipal water, and a ${status} ${word} is recorded ${rounded(gap)}; supply may be affected.` })
      }
    }
  }
  if (shelter.infrastructure_dependencies?.includes('single_access_road') && access.length) {
    dependencies.push({ code: 'dependency_at_risk', severity: 'flag', message: 'The shelter has a single access road and a possible access problem is recorded nearby.' })
  }

  // ---- mapped zones (existing disaster-zone layer) ----
  const pos: [number, number] = [point[1], point[0]]
  for (const z of ctx.zones) {
    if (displayState(z, nowMs) !== 'active') continue
    if (z.zone_type === 'shelter') continue
    let inside = false
    try { inside = pointInZone(pos, z.geometry, z.radius_m) } catch { inside = false }
    if (!inside) continue
    const official = z.verification_status === 'official' || z.verification_status === 'human_verified'
    const label = `"${z.name}" (${z.hazard_type}, ${z.severity}${official ? `, ${z.verification_status}` : ', UNVERIFIED'})`
    if (z.verification_status === 'ai_suggested') {
      reasons.push({ code: 'ai_suggested_zone', severity: 'info', message: `Inside an AI-suggested zone ${label}; a human has not confirmed it.` })
    } else if (z.zone_type === 'danger' && official) {
      reasons.push({ code: 'in_danger_zone', severity: 'block', message: `The shelter is inside an active danger zone ${label}.` })
    } else if (z.zone_type === 'restricted' && official) {
      reasons.push({ code: 'in_restricted_zone', severity: 'block', message: `The shelter is inside an active restricted-access zone ${label}${z.status_detail ? `: ${z.status_detail}` : ''}.` })
    } else if (z.zone_type === 'evacuation' && official && z.evacuation_status === 'order') {
      reasons.push({ code: 'in_evacuation_order', severity: 'block', message: `The shelter is inside an area under an evacuation order ${label}.` })
    } else if (z.zone_type === 'caution') {
      reasons.push({ code: 'in_caution_zone', severity: 'info', message: `Inside a caution zone ${label}.` })
    } else {
      reasons.push({ code: 'potential_zone_exposure', severity: 'flag', message: `Potential exposure: inside an active ${z.zone_type} zone ${label}.` })
    }
  }

  // ---- flood scenario supplied by the caller ----
  const sc = ctx.floodScenario
  if (sc?.polygons?.length) {
    const hit = sc.polygons.some((g) => { try { return pointInZone(pos, g, null) } catch { return false } })
    if (hit) {
      reasons.push({
        code: 'scenario_exposure', severity: sc.excludeExposed ? 'block' : 'flag',
        message: `The shelter lies inside the flood scenario "${sc.name}"${sc.source ? ` (source: ${sc.source})` : ''}. Scenario output is a projection, not an observation.`,
      })
    }
  }

  return { reasons, access, dependencies, nearestSiteHazardM: nearest, blocked: reasons.some((r) => r.severity === 'block') }
}
