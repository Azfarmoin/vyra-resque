// Explainable shelter recommendation engine. Pure: routing is injected (the production adapter wraps the existing
// analyzeRoutes / OSRM / OpenRouteService code, see routeAdapter.ts), so every rule here is unit-testable.
//
// What it guarantees (each has a test in tests/shelters.engine.test.ts):
//  * A closed or full shelter is never ranked as available unless an authorized, unexpired, unrevoked exception is recorded.
//  * "Closest" is never assumed best: ranking is a multi-factor score and tier, and the closest shelter's outcome is reported.
//  * A required capability counts only when it is DOCUMENTED. Unknown / undocumented / "no" all fail the requirement, and
//    each failure says which.
//  * Stale, unverified and estimated data are labelled, and push a shelter into "review required".
//  * If nothing qualifies, it says which requirements were unmet and asks for human review. It never invents a fallback.
//  * The score only ORDERS options. It is not a probability and not a safety rating.
import { haversineM } from '../routing/geo'
import type { Hazard, LatLng, RouteStatus, VehicleType } from '../routing/types'
import type { DisasterZone } from '../zones/types'
import {
  availability, dataQuality, facilityState, isDocumented, normaliseShelter, openNow, type Availability, type DataQuality,
} from './facilities'
import { siteRisk, type FloodScenario, type Reason } from './risk'
import { FACILITY_LABELS, type FacilityKey, type GroupNeeds, type ShelterException, type ShelterRecord } from './types'

export type { Reason }

export type RouteAssessment =
  | { state: 'ok'; distanceM: number; durationS: number; status: RouteStatus; closures: number; activeFindings: number; notes: string[]; provider: string | null }
  | { state: 'no_route' }
  | { state: 'unavailable'; reason: string }
export type RouteAssessor = (origin: LatLng, destination: LatLng, vehicle: VehicleType) => Promise<RouteAssessment>

export interface EngineContext {
  shelters: ShelterRecord[]
  exceptions: ShelterException[]
  hazards: Hazard[]
  zones: DisasterZone[]
  routeAssess: RouteAssessor | null
}
export interface RecommendInput {
  origin: LatLng
  needs: GroupNeeds
  vehicle?: VehicleType
  floodScenario?: FloodScenario | null
  maxRouted?: number
  now?: Date
}

export interface ScoreComponent { key: string; label: string; points: number; max: number; detail: string }
export interface Requirement { id: string; label: string; met: boolean; detail: string }
export interface ShelterAssessment {
  shelterId: string
  name: string
  area: string | null
  location: LatLng | null
  tier: 'recommended' | 'review_required' | 'excluded'
  rank: number | null
  score: number | null // ordering aid only
  scoreBreakdown: ScoreComponent[]
  reasons: Reason[]
  requirements: Requirement[]
  travel: { basis: 'road' | 'estimate' | 'none'; distanceM: number | null; durationMin: number | null; straightLineM: number | null; routeStatus: RouteStatus | null; note: string }
  availability: Availability
  dataQuality: DataQuality
  exceptionApplied: { id: string; kind: string; reason: string; authorizedBy: string; expiresAt: string } | null
  summary: string
}
export interface Recommendation {
  generatedAt: string
  needs: GroupNeeds
  recommended: ShelterAssessment[] // ranked: tier 'recommended' first, then 'review_required'
  excluded: ShelterAssessment[]
  closest: { shelterId: string; name: string; straightLineM: number; outcome: string } | null
  humanReview: { required: boolean; reasons: string[]; unmetRequirements: { requirement: string; failedAt: number; examples: string[] }[] }
  notices: string[]
  disclaimer: string
}

export const DISCLAIMER =
  'Decision support only. Shelter data may be incomplete or out of date, and routes and hazards are limited to what VYRA has recorded. A dispatcher must confirm availability, access and suitability with the shelter before sending people.'

const ESTIMATE_SPEED_KMH = 30
const ESTIMATE_CIRCUITY = 1.4
export const estimateMinutes = (straightM: number) => (straightM * ESTIMATE_CIRCUITY) / ((ESTIMATE_SPEED_KMH * 1000) / 60)

const wheelchairDocumented = (s: ShelterRecord) => s.wheelchair_access === 'full' && s.verification_status === 'verified'
const fl = (k: FacilityKey) => FACILITY_LABELS[k].toLowerCase()

/** Capabilities a group REQUIRES. Each is a hard requirement: if it is not documented the shelter is excluded. */
export function requirementsFor(needs: GroupNeeds, s: ShelterRecord): Requirement[] {
  const out: Requirement[] = []
  const stateWord = (k: FacilityKey) => {
    const st = facilityState(s, k)
    return st === 'documented' ? 'documented' : st === 'claimed_undocumented' ? 'listed but not documented' : st === 'no' ? 'recorded as not available' : 'unknown'
  }
  const need = (id: string, label: string, met: boolean, detail: string) => out.push({ id, label, met, detail })
  const keys = (ks: FacilityKey[]) => ks.map((k) => `${fl(k)}: ${stateWord(k)}`).join('; ')

  if ((needs.wheelchairUsers ?? 0) > 0) {
    const met = wheelchairDocumented(s)
    need('wheelchair', `Wheelchair access for ${needs.wheelchairUsers}`, met,
      met ? 'Full wheelchair access is documented on a verified record.'
        : s.wheelchair_access === 'partial' ? 'Only PARTIAL wheelchair access is documented.'
        : s.wheelchair_access === 'none' ? 'The record says there is no wheelchair access.'
        : s.wheelchair_access === 'full' ? 'Full access is recorded, but the record is not verified.'
        : 'Wheelchair access is not documented.')
  }
  if ((needs.mobilityAssistance ?? 0) > 0) {
    const met = isDocumented(s, 'mobility_assistance') || isDocumented(s, 'step_free_entry')
    need('mobility', `Mobility assistance for ${needs.mobilityAssistance}`, met, met ? 'Mobility assistance or step-free entry is documented.' : keys(['mobility_assistance', 'step_free_entry']))
  }
  if ((needs.oxygenUsers ?? 0) > 0) {
    const o2 = isDocumented(s, 'oxygen_support')
    const power = isDocumented(s, 'electricity') || isDocumented(s, 'backup_power')
    need('oxygen', `Oxygen support for ${needs.oxygenUsers}`, o2 && power, o2 && power ? 'Oxygen support and a power supply are documented.' : keys(['oxygen_support', 'electricity', 'backup_power']))
  }
  if ((needs.essentialMedication ?? 0) > 0) {
    const met = isDocumented(s, 'medical_support')
    need('medication', `Essential medication for ${needs.essentialMedication}`, met, met ? 'Medical support is documented.' : keys(['medical_support']))
  }
  if ((needs.infants ?? 0) > 0) {
    const met = isDocumented(s, 'family_accommodation') && isDocumented(s, 'drinking_water') && isDocumented(s, 'sanitation')
    need('infants', `Infants (${needs.infants})`, met, met ? 'Family space, drinking water and sanitation are documented.' : keys(['family_accommodation', 'drinking_water', 'sanitation']))
  }
  if ((needs.elderly ?? 0) > 0) {
    const met = isDocumented(s, 'step_free_entry') || wheelchairDocumented(s)
    need('elderly', `Older adults (${needs.elderly})`, met, met ? 'Step-free access is documented.' : keys(['step_free_entry']))
  }
  if ((needs.pregnant ?? 0) > 0) {
    const met = isDocumented(s, 'maternal_support') || isDocumented(s, 'medical_support')
    need('pregnancy', `Pregnancy-related needs (${needs.pregnant})`, met, met ? 'Maternal or medical support is documented.' : keys(['maternal_support', 'medical_support']))
  }
  if (needs.keepFamilyTogether) {
    const met = isDocumented(s, 'family_accommodation')
    need('family', 'Keep family members together', met, met ? 'Family accommodation is documented.' : keys(['family_accommodation']))
  }
  return out
}

export function activeExceptions(exceptions: ShelterException[], shelterId: string, now: Date): ShelterException[] {
  return exceptions.filter((e) => e.shelter_id === shelterId && !e.revoked_at && Date.parse(e.expires_at) > now.getTime())
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
const minutesLabel = (m: number) => (m < 60 ? `${Math.round(m)} min` : `${Math.floor(m / 60)} h ${Math.round(m % 60)} min`)
const km = (m: number) => `${(m / 1000).toFixed(1)} km`

interface Local {
  s: ShelterRecord
  q: DataQuality
  av: Availability
  reasons: Reason[]
  requirements: Requirement[]
  straightM: number | null
  exception: ShelterException | null
  nearestHazardM: number | null
  accessCount: number
}

/** Everything that can be decided without calling the routing engine. */
function evaluateLocal(raw: ShelterRecord, input: RecommendInput, ctx: EngineContext, now: Date): Local {
  const s = raw
  const q = dataQuality(s, now)
  const reasons: Reason[] = []
  const party = input.needs.partySize
  const exs = activeExceptions(ctx.exceptions, s.id, now)
  const closedEx = exs.find((e) => e.kind === 'closed_use') ?? null
  const overEx = exs.find((e) => e.kind === 'over_capacity') ?? null
  // The overflow a shelter may use comes ONLY from an active exception, whatever the stored column says.
  const withOverflow: ShelterRecord = { ...s, authorized_overflow: overEx ? overEx.extra_capacity : 0 }
  const av = availability(withOverflow, q)

  // ---- identity / verification ----
  if (s.verification_status === 'rejected') reasons.push({ code: 'rejected', severity: 'block', message: 'This record was rejected during verification and must not be used.' })
  else if (s.verification_status === 'unverified') reasons.push({ code: 'unverified', severity: 'flag', message: 'UNVERIFIED shelter record: existence, location and capacity are not confirmed.' })
  else if (s.verification_status === 'needs_review') reasons.push({ code: 'needs_review', severity: 'flag', message: 'This record is flagged as needing re-verification.' })
  if (s.verification_status === 'verified' && q.verification.stale) reasons.push({ code: 'verification_stale', severity: 'flag', message: `${q.verification.label}. Confirm the details by phone before sending people.` })

  // ---- location ----
  const hasPoint = s.location_lat != null && s.location_lng != null
  if (!hasPoint) reasons.push({ code: 'no_location', severity: 'block', message: 'The shelter has no recorded coordinates, so travel and exposure cannot be assessed.' })
  else if (!s.location_verified) reasons.push({ code: 'location_unverified', severity: 'flag', message: 'The shelter location has not been verified; the pin may be wrong.' })

  // ---- operational status ----
  if (s.status === 'closed') {
    if (closedEx) reasons.push({ code: 'authorized_exception', severity: 'flag', message: `Recorded as CLOSED, but an authorized exception allows use until ${closedEx.expires_at}: "${closedEx.reason}" (authorized by ${closedEx.authorized_by_name}).` })
    else reasons.push({ code: 'closed', severity: 'block', message: 'The shelter is closed and no authorized exception is recorded.' })
  }
  if (s.status === 'full' || (av.max != null && av.available === 0 && s.status !== 'closed')) {
    if (overEx && av.available! > 0) reasons.push({ code: 'authorized_exception', severity: 'flag', message: `Recorded as full, but an authorized exception adds ${overEx.extra_capacity} places until ${overEx.expires_at}: "${overEx.reason}" (authorized by ${overEx.authorized_by_name}).` })
    else if (s.status === 'full' && av.available != null && av.available > 0 && !overEx) reasons.push({ code: 'full', severity: 'block', message: `The shelter is marked FULL (${av.occupied} of ${av.max} occupied); a status of "full" is respected even though the numbers suggest ${av.available} free.` })
    else reasons.push({ code: 'full', severity: 'block', message: `No capacity left: ${av.occupied} occupied${av.reserved ? ` + ${av.reserved} reserved` : ''} of ${av.max}${av.overflow ? ` (+${av.overflow} authorized)` : ''}.` })
  }
  const oh = openNow(s.opening_hours, now)
  if (s.status !== 'closed' && oh === 'closed') reasons.push({ code: 'outside_hours', severity: 'flag', message: 'Outside the documented opening hours. Confirm someone can open the shelter.' })

  // ---- capacity ----
  if (av.max == null) reasons.push({ code: 'capacity_unknown', severity: 'block', message: 'Maximum capacity is not recorded, so a reservation cannot be sized.' })
  else if (!reasons.some((r) => r.code === 'full' || r.code === 'closed')) {
    if (av.available! < party) reasons.push({ code: 'insufficient_capacity', severity: 'block', message: `Only ${av.available} places are free (${av.occupied} occupied${av.reserved ? `, ${av.reserved} reserved` : ''} of ${av.max}); the group needs ${party}.` })
    else if (av.usable! < party) reasons.push({ code: 'capacity_uncertain', severity: 'flag', message: `${av.available} places look free, but the occupancy figure is not trustworthy (${q.occupancy.label}); only ${av.usable} are relied on and the group needs ${party}. Confirm by phone.` })
  }
  if (av.overAllocatedBy > 0) reasons.push({ code: 'over_allocated', severity: 'flag', message: `Records show ${av.overAllocatedBy} more people than the permitted capacity. Reconcile before relying on this shelter.` })
  if (q.occupancy.freshness !== 'fresh' || q.occupancy.basis === 'estimated' || q.occupancy.basis === 'unknown') {
    reasons.push({ code: q.occupancy.basis === 'estimated' ? 'occupancy_estimated' : 'occupancy_stale', severity: 'flag', message: q.occupancy.label })
  }

  // ---- required capabilities ----
  const requirements = requirementsFor(input.needs, s)
  for (const r of requirements) if (!r.met) reasons.push({ code: `unmet_${r.id}`, severity: 'block', message: `Required: ${r.label}. Not met: ${r.detail}` })
  for (const k of ['drinking_water', 'sanitation'] as FacilityKey[]) {
    if (!isDocumented(s, k)) reasons.push({ code: `basic_${k}`, severity: 'info', message: `${FACILITY_LABELS[k]} is not documented for this shelter.` })
  }

  // ---- site exposure ----
  let nearestHazardM: number | null = null
  let accessCount = 0
  if (hasPoint) {
    const risk = siteRisk([s.location_lat!, s.location_lng!], s, { hazards: ctx.hazards, zones: ctx.zones, floodScenario: input.floodScenario, now })
    reasons.push(...risk.reasons, ...risk.access, ...risk.dependencies)
    nearestHazardM = risk.nearestSiteHazardM
    accessCount = risk.access.length
  }
  const straightM = hasPoint ? haversineM(input.origin, [s.location_lat!, s.location_lng!]) : null
  return { s, q, av, reasons, requirements, straightM, exception: closedEx ?? overEx, nearestHazardM, accessCount }
}

async function pool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]) }
  }))
  return out
}

export async function recommendShelters(input: RecommendInput, ctx: EngineContext): Promise<Recommendation> {
  const now = input.now ?? new Date()
  const vehicle: VehicleType = input.vehicle ?? 'car'
  const notices: string[] = []
  const shelters = ctx.shelters.map((s) => normaliseShelter(s as unknown as Record<string, unknown>))
  const locals = shelters.map((s) => evaluateLocal(s, input, ctx, now))

  // ---- routing, only for shelters that survived the local checks ----
  const routes = new Map<string, RouteAssessment | 'not_checked'>()
  const survivors = locals.filter((l) => !l.reasons.some((r) => r.severity === 'block')).sort((a, b) => (a.straightM ?? Infinity) - (b.straightM ?? Infinity))
  const limit = input.maxRouted ?? 8
  if (ctx.routeAssess) {
    const toRoute = survivors.slice(0, limit)
    for (const l of survivors.slice(limit)) routes.set(l.s.id, 'not_checked')
    const results = await pool(toRoute, 3, async (l) => {
      try { return await ctx.routeAssess!(input.origin, [l.s.location_lat!, l.s.location_lng!], vehicle) }
      catch (e) { return { state: 'unavailable', reason: e instanceof Error ? e.message : 'routing failed' } as RouteAssessment }
    })
    toRoute.forEach((l, i) => routes.set(l.s.id, results[i]))
    if (results.some((r) => r.state === 'unavailable')) notices.push('The routing engine could not be reached for some shelters. Their travel times are straight-line ESTIMATES, not road routes, and they are marked for review.')
    if (survivors.length > limit) notices.push(`Road routes were checked for the ${limit} nearest eligible shelters only; the others use straight-line estimates and are marked for review.`)
  } else {
    for (const l of survivors) routes.set(l.s.id, { state: 'unavailable', reason: 'No routing provider is configured.' })
    if (survivors.length) notices.push('No routing provider is configured: travel times are straight-line estimates and every option needs review.')
  }

  const assessments: ShelterAssessment[] = locals.map((l) => finish(l, routes.get(l.s.id), input, now))

  // ---- order: tier, then score, then id (deterministic) ----
  const tierOrder = { recommended: 0, review_required: 1, excluded: 2 } as const
  const ranked = assessments.filter((a) => a.tier !== 'excluded').sort((a, b) => tierOrder[a.tier] - tierOrder[b.tier] || b.score! - a.score! || a.shelterId.localeCompare(b.shelterId))
  ranked.forEach((a, i) => (a.rank = i + 1))
  const excluded = assessments.filter((a) => a.tier === 'excluded').sort((a, b) => (a.travel.straightLineM ?? Infinity) - (b.travel.straightLineM ?? Infinity) || a.shelterId.localeCompare(b.shelterId))

  // ---- "closest is not best" ----
  const withPoint = assessments.filter((a) => a.travel.straightLineM != null).sort((a, b) => a.travel.straightLineM! - b.travel.straightLineM!)
  let closest: Recommendation['closest'] = null
  if (withPoint[0]) {
    const c = withPoint[0]
    const firstBlock = c.reasons.find((r) => r.severity === 'block')
    closest = {
      shelterId: c.shelterId, name: c.name, straightLineM: Math.round(c.travel.straightLineM!),
      outcome: c.tier === 'excluded' ? `Excluded: ${firstBlock?.message ?? 'not eligible'}` : c.rank === 1 ? 'Also ranked first, on its overall score rather than because it is closest.' : `Ranked #${c.rank} (${c.tier === 'review_required' ? 'needs review' : 'recommended'}): closer does not mean better.`,
    }
  }

  // ---- human review ----
  const humanReasons: string[] = []
  const hasRecommended = ranked.some((a) => a.tier === 'recommended')
  const unmet = new Map<string, { failedAt: number; examples: string[] }>()
  if (!ranked.length) {
    humanReasons.push('No shelter can be recommended for this group with the data available. A person must decide where to send them and confirm any option by phone.')
    for (const a of excluded) for (const r of a.requirements.filter((x) => !x.met)) {
      const e = unmet.get(r.label) ?? { failedAt: 0, examples: [] }
      e.failedAt++
      if (e.examples.length < 3) e.examples.push(`${a.name}: ${r.detail}`)
      unmet.set(r.label, e)
    }
    const capBlocked = excluded.filter((a) => a.reasons.some((r) => ['full', 'insufficient_capacity', 'closed'].includes(r.code))).length
    if (capBlocked) unmet.set('Open, with room for the whole group', { failedAt: capBlocked, examples: excluded.filter((a) => a.reasons.some((r) => ['full', 'insufficient_capacity', 'closed'].includes(r.code))).slice(0, 3).map((a) => `${a.name}: ${a.reasons.find((r) => ['full', 'insufficient_capacity', 'closed'].includes(r.code))!.message}`) })
    const exposed = excluded.filter((a) => a.reasons.some((r) => ['verified_hazard_exposure', 'in_danger_zone', 'in_restricted_zone', 'in_evacuation_order', 'scenario_exposure', 'route_blocked', 'route_no_road'].includes(r.code))).length
    if (exposed) unmet.set('Reachable and outside recorded hazards', { failedAt: exposed, examples: [] })
  } else if (!hasRecommended) {
    humanReasons.push('Every option has a data-quality, access or exposure warning. A person must review the warnings and confirm by phone before anyone is sent.')
  }
  if (ranked.some((a) => a.exceptionApplied)) humanReasons.push('At least one option relies on an authorized exception that a person recorded; confirm it is still in force.')

  return {
    generatedAt: now.toISOString(),
    needs: input.needs,
    recommended: ranked,
    excluded,
    closest,
    humanReview: { required: humanReasons.length > 0, reasons: humanReasons, unmetRequirements: [...unmet].map(([requirement, v]) => ({ requirement, ...v })) },
    notices,
    disclaimer: DISCLAIMER,
  }
}

function finish(l: Local, routeRes: RouteAssessment | 'not_checked' | undefined, input: RecommendInput, now: Date): ShelterAssessment {
  const { s, q, av } = l
  const reasons = [...l.reasons]
  const hasPoint = l.straightM != null
  let travel: ShelterAssessment['travel'] = { basis: 'none', distanceM: null, durationMin: null, straightLineM: l.straightM == null ? null : Math.round(l.straightM), routeStatus: null, note: 'Not assessed.' }

  const blockedLocally = reasons.some((r) => r.severity === 'block')
  if (hasPoint && !blockedLocally) {
    const est = estimateMinutes(l.straightM!)
    const estimate = (note: string) => (travel = { basis: 'estimate', distanceM: Math.round(l.straightM! * ESTIMATE_CIRCUITY), durationMin: Math.round(est), straightLineM: Math.round(l.straightM!), routeStatus: null, note })
    if (!routeRes || routeRes === 'not_checked') {
      estimate('Straight-line estimate (x1.4 for roads at 30 km/h); no road route was checked.')
      reasons.push({ code: 'route_not_checked', severity: 'flag', message: 'Road route not checked: travel time is a straight-line estimate.' })
    } else if (routeRes.state === 'ok') {
      travel = { basis: 'road', distanceM: Math.round(routeRes.distanceM), durationMin: Math.round(routeRes.durationS / 60), straightLineM: Math.round(l.straightM!), routeStatus: routeRes.status, note: `Road route${routeRes.provider ? ` via ${routeRes.provider}` : ''}.${routeRes.notes.length ? ' ' + routeRes.notes.join(' ') : ''}` }
      if (routeRes.status === 'known_blockage') reasons.push({ code: 'route_blocked', severity: 'block', message: `Every road route found crosses a recorded closure (${routeRes.closures} on the best route). Do not send the group this way without a dispatcher-approved alternative.` })
      else if (routeRes.status === 'hazard_reported') reasons.push({ code: 'route_hazard', severity: 'flag', message: `Hazards are reported along the route (${routeRes.activeFindings} active finding${routeRes.activeFindings === 1 ? '' : 's'}). Review the route before approving.` })
      else if (routeRes.status === 'limited_information') reasons.push({ code: 'route_limited_info', severity: 'flag', message: 'Hazard data along this route is limited or out of date.' })
      else reasons.push({ code: 'route_clear_in_data', severity: 'info', message: 'No hazards found along the route in the available data. This is not a guarantee the road is passable.' })
    } else if (routeRes.state === 'no_route') {
      reasons.push({ code: 'route_no_road', severity: 'block', message: 'The routing engine found no road route to this shelter.' })
    } else {
      estimate(`Straight-line estimate (routing failed: ${routeRes.reason}).`)
      reasons.push({ code: 'route_unavailable', severity: 'flag', message: `Routing failed (${routeRes.reason}). Travel time is a straight-line ESTIMATE, not a road route.` })
    }
  }

  const blocked = reasons.some((r) => r.severity === 'block')
  const flagged = reasons.some((r) => r.severity === 'flag')
  const tier: ShelterAssessment['tier'] = blocked ? 'excluded' : flagged ? 'review_required' : 'recommended'

  let score: number | null = null
  const breakdown: ScoreComponent[] = []
  if (!blocked) {
    const party = input.needs.partySize
    const mins = travel.durationMin ?? 90
    const tPts = (travel.basis === 'road' ? 30 : 24) * clamp(1 - mins / 90, 0, 1)
    breakdown.push({ key: 'travel', label: 'Travel time', points: tPts, max: 30, detail: `${minutesLabel(mins)}${travel.basis === 'estimate' ? ' (estimate, capped at 24)' : ''}${travel.distanceM ? `, ${km(travel.distanceM)}` : ''}; 0 points at 90 min or more.` })
    const surplus = (av.usable ?? 0) - party
    const cPts = 15 * clamp(surplus / Math.max(20, party), 0, 1)
    breakdown.push({ key: 'capacity', label: 'Spare capacity', points: cPts, max: 15, detail: `${av.usable} usable places for a group of ${party} (${surplus >= 0 ? surplus : 0} to spare).` })
    const dPts = q.verification.status === 'verified' ? (q.occupancy.freshness === 'fresh' && (q.occupancy.basis === 'counted' || q.occupancy.basis === 'reported') ? 15 : 8) : 3
    breakdown.push({ key: 'data', label: 'Data confidence', points: dPts - (q.verification.stale && q.verification.status === 'verified' ? 4 : 0), max: 15, detail: `${q.verification.label}. ${q.occupancy.label}.` })
    const rs = travel.routeStatus
    const rPts = travel.basis !== 'road' ? 3 : rs === 'no_hazards_found' ? 15 : rs === 'hazard_reported' ? 7 : 6
    breakdown.push({ key: 'route', label: 'Route hazards', points: rPts, max: 15, detail: travel.basis !== 'road' ? 'No road route was checked.' : rs === 'no_hazards_found' ? 'No hazards found along the route in the available data.' : 'Hazards or data gaps along the route.' })
    const exposureFlag = reasons.some((r) => ['potential_hazard_exposure', 'potential_zone_exposure', 'scenario_exposure'].includes(r.code))
    const hPts = exposureFlag ? 4 : l.nearestHazardM == null ? 15 : clamp(8 + (l.nearestHazardM / 2000) * 7, 8, 15)
    breakdown.push({ key: 'hazard', label: 'Distance from recorded hazards', points: hPts, max: 15, detail: exposureFlag ? 'Potential exposure is recorded near this shelter.' : l.nearestHazardM == null ? 'No site hazard recorded nearby.' : `Nearest recorded site hazard is ${km(l.nearestHazardM)} away.` })
    const extras: FacilityKey[] = ['food', 'medical_support', 'backup_power', 'family_accommodation', 'drinking_water', 'sanitation']
    const have = extras.filter((k) => isDocumented(s, k))
    const nPts = (10 * have.length) / extras.length - (l.accessCount ? 2 : 0)
    breakdown.push({ key: 'facilities', label: 'Documented facilities', points: Math.max(0, nPts), max: 10, detail: have.length ? `Documented: ${have.map((k) => fl(k)).join(', ')}.` : 'No extra facilities are documented.' })
    for (const b of breakdown) b.points = Math.round(b.points * 10) / 10
    score = Math.round(breakdown.reduce((n, b) => n + b.points, 0))
  }

  const firstBlock = reasons.find((r) => r.severity === 'block')
  const flags = reasons.filter((r) => r.severity === 'flag')
  const summary =
    tier === 'excluded' ? `Excluded: ${firstBlock!.message}`
    : tier === 'review_required' ? `Possible, but review first: ${flags.slice(0, 2).map((f) => f.message).join(' ')}${flags.length > 2 ? ` (+${flags.length - 2} more)` : ''}`
    : `Recommended on overall fit: ${travel.durationMin} min away, ${av.usable} usable places, current verified data.`

  return {
    shelterId: s.id, name: s.name, area: s.area, location: hasPoint ? [s.location_lat!, s.location_lng!] : null,
    tier, rank: null, score, scoreBreakdown: breakdown, reasons, requirements: l.requirements, travel, availability: av, dataQuality: q,
    exceptionApplied: l.exception ? { id: l.exception.id, kind: l.exception.kind, reason: l.exception.reason, authorizedBy: l.exception.authorized_by_name, expiresAt: l.exception.expires_at } : null,
    summary,
  }
}
