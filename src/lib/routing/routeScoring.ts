// Deterministic route evaluation and ranking. The statuses here are the ONLY source of truth about a
// route; the AI layer may explain them but can never change them.
//
// Status precedence (most severe wins; every concern is still listed in `limitations`/`findings`):
//   known_blockage       an ACTIVE, CONFIRMED hazard whose record says it closes the road lies on the route
//   hazard_reported      any other active hazard lies on the route (unverified, or confirmed but not a closure)
//   limited_information  no hazard matched, but the data cannot support a conclusion (see LIMITING below)
//   no_hazards_found     no hazard matched AND the data is complete, local and fresh. Still NOT "safe".
//
// "candidate_for_dispatcher_review" is a recommendation given only to the best-ranked route whose status
// is no_hazards_found. Routes with reported hazards or limited information are `review_required`:
// a dispatcher may still choose them, but only with a recorded reason.
import { STALE_CONFIRMED_MIN } from './hazardMatcher'
import { STATUS_LABELS } from './types'
import type { CandidateRoute, HazardDataset, Limitation, Recommendation, RouteFinding, RouteStatus, VehicleType } from './types'

export const SEVERITY_WEIGHT = { low: 1, medium: 3, high: 6, critical: 10 } as const
export const UNVERIFIED_FACTOR = 0.7
export const NEAR_FACTOR = 0.25
export const LIMITATION_PENALTY = 2
/** Newest hazard record within this radius of the route must be younger than STALE_LOCAL_MIN, else the local picture is stale. */
export const LOCAL_DATA_RADIUS_M = 10_000
export const STALE_LOCAL_MIN = 12 * 60
/** Origin/destination farther than this from the road network means the provider's map may not cover the place. */
export const MAX_SNAP_M = 200
/** Route much longer than the straight line can mean missing roads in the provider's map. */
export const DETOUR_WARN_RATIO = 3.5

export interface RouteEvalInput {
  index: number
  distanceM: number
  durationS: number
  findings: RouteFinding[]
  originSnapM: number
  destinationSnapM: number
  straightLineM: number
  /** Newest basis time among hazard records within LOCAL_DATA_RADIUS_M of the route, or null when there are none. */
  newestLocalRecordAt: string | null
  localRecordCount: number
}

export interface RouteEvalContext {
  dataset: HazardDataset
  vehicle: VehicleType
  now: Date
  providerSupportsExclusions: boolean
  closuresOnAnyRoute: boolean
}

export interface RouteEval {
  status: RouteStatus
  limitations: Limitation[]
  exposure: CandidateRoute['exposure']
  coverage: CandidateRoute['coverage']
  rankScore: number
  hasClosure: boolean
}

const counted = (f: RouteFinding) => f.state === 'active' && f.duplicateOf === null

export function evaluateRoute(input: RouteEvalInput, ctx: RouteEvalContext): RouteEval {
  const onRoute = input.findings.filter((f) => f.proximity === 'on_route')
  const activeOnRoute = onRoute.filter(counted)
  const closures = activeOnRoute.filter((f) => f.verification === 'confirmed' && f.blocksRoad === true)
  const nearActive = input.findings.filter((f) => f.proximity === 'near_route' && counted(f))

  let score = 0
  for (const f of activeOnRoute) score += SEVERITY_WEIGHT[f.severity] * (f.verification === 'confirmed' ? 1 : UNVERIFIED_FACTOR)
  for (const f of nearActive) score += SEVERITY_WEIGHT[f.severity] * NEAR_FACTOR * (f.verification === 'confirmed' ? 1 : UNVERIFIED_FACTOR)

  const limitations: Limitation[] = []
  const add = (code: Limitation['code'], message: string, blocksCandidate: boolean) => limitations.push({ code, message, blocksCandidate })

  // --- data-level limits ---
  for (const s of ctx.dataset.sources.filter((x) => !x.ok)) {
    add('source_unavailable', `${s.name} could not be loaded${s.error ? ` (${s.error})` : ''}. Its hazards are missing from this analysis.`, true)
  }
  const totalRecords = ctx.dataset.sources.reduce((n, s) => n + s.count, 0)
  if (totalRecords === 0 && ctx.dataset.skipped.length === 0) {
    add('dataset_empty', 'There are no hazard records at all. An empty hazard database means nothing has been recorded, not that the roads are clear.', true)
  }
  if (ctx.dataset.skipped.length > 0) {
    add('unlocatable_records', `${ctx.dataset.skipped.length} hazard record(s) have no usable location, so they could not be checked against this route.`, true)
  }
  if (totalRecords > 0) {
    if (input.localRecordCount === 0) {
      add('no_local_data', `No hazard records exist within ${LOCAL_DATA_RADIUS_M / 1000} km of this route. The area may simply not be monitored.`, true)
    } else if (input.newestLocalRecordAt && ctx.now.getTime() - Date.parse(input.newestLocalRecordAt) > STALE_LOCAL_MIN * 60_000) {
      add('stale_local_data', `The newest hazard record near this route is over ${STALE_LOCAL_MIN / 60} hours old, so recent changes would not appear here.`, true)
    } else if (!input.newestLocalRecordAt) {
      add('stale_local_data', 'Hazard records near this route carry no timestamps, so their age cannot be judged.', true)
    }
  }

  // --- route-level limits ---
  const coverageOk = input.originSnapM <= MAX_SNAP_M && input.destinationSnapM <= MAX_SNAP_M
  if (!coverageOk) {
    const where = [input.originSnapM > MAX_SNAP_M ? `start (${Math.round(input.originSnapM)} m)` : '', input.destinationSnapM > MAX_SNAP_M ? `end (${Math.round(input.destinationSnapM)} m)` : ''].filter(Boolean).join(' and ')
    add('coverage_partial', `The routing provider placed the ${where} far from any mapped road, so road-network coverage there may be incomplete. The route may not reach the actual location.`, true)
  }
  if (input.straightLineM > 500 && input.distanceM / input.straightLineM > DETOUR_WARN_RATIO) {
    add('unusual_detour', `This route is ${(input.distanceM / input.straightLineM).toFixed(1)}x the straight-line distance, which can mean roads are missing from the provider's map.`, false)
  }

  // --- hazard-level limits (informational; the route already carries hazard_reported) ---
  if (activeOnRoute.some((f) => f.freshness === 'stale')) {
    add('stale_hazard', `At least one hazard on this route was last reported or verified more than ${STALE_CONFIRMED_MIN / 60} h (confirmed) or 3 h (unverified) ago. Conditions may have changed.`, false)
  }
  if (activeOnRoute.some((f) => f.freshness === 'unknown')) {
    add('unknown_age_hazard', 'At least one hazard on this route has no usable timestamp, so its age is unknown.', false)
  }
  if (closures.length === 0 && ctx.closuresOnAnyRoute && !ctx.providerSupportsExclusions) {
    // shown once per analysis on the notices list as well; kept per route so it travels with the audit copy
  }

  // --- always true today: nothing in VYRA surveys road conditions or vehicle restrictions ---
  add('vehicle_restrictions_unknown', `Width, height, weight and flood-depth limits along this route are unknown, so passability for a ${ctx.vehicle.replace('_', ' ')} is not established.`, false)
  add('road_access_unverified', 'No responder or survey has verified road access along this route.', false)

  const status: RouteStatus = closures.length
    ? 'known_blockage'
    : activeOnRoute.length
      ? 'hazard_reported'
      : limitations.some((l) => l.blocksCandidate)
        ? 'limited_information'
        : 'no_hazards_found'

  const penalty = limitations.filter((l) => l.blocksCandidate).length * LIMITATION_PENALTY
  const exposure = {
    score: Math.round(score * 100) / 100,
    closures: closures.length,
    activeOnRoute: activeOnRoute.length,
    confirmedOnRoute: activeOnRoute.filter((f) => f.verification === 'confirmed').length,
    unverifiedOnRoute: activeOnRoute.filter((f) => f.verification === 'unverified').length,
    nearRoute: nearActive.length,
    inactiveOnRoute: onRoute.filter((f) => f.state === 'inactive').length,
  }
  return {
    status,
    limitations,
    exposure,
    coverage: { state: coverageOk ? 'complete' : 'partial', originSnapM: Math.round(input.originSnapM), destinationSnapM: Math.round(input.destinationSnapM) },
    rankScore: score + penalty,
    hasClosure: closures.length > 0,
  }
}

export interface Rankable {
  eval: RouteEval
  distanceM: number
  durationS: number
  input: RouteEvalInput
}

/** Lexicographic: no confirmed closure first, then fewer weighted concerns, then faster, then shorter. */
export function compareRoutes(a: Rankable, b: Rankable): number {
  if (a.eval.hasClosure !== b.eval.hasClosure) return a.eval.hasClosure ? 1 : -1
  if (Math.abs(a.eval.rankScore - b.eval.rankScore) > 1e-9) return a.eval.rankScore - b.eval.rankScore
  if (a.durationS !== b.durationS) return a.durationS - b.durationS
  return a.distanceM - b.distanceM
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const minutes = (s: number) => Math.round(s / 60)

/** Plain-language, deterministic reasons for a route's position. Never uses model output. */
export function explainRank(ranked: { eval: RouteEval; durationS: number; distanceM: number; status: RouteStatus }[], i: number): string[] {
  const me = ranked[i]
  const reasons: string[] = []
  const e = me.eval.exposure
  if (e.closures) reasons.push(`Contains ${plural(e.closures, 'confirmed closure')} on the route, so it ranks below every route without one.`)
  else if (e.activeOnRoute) reasons.push(`${plural(e.activeOnRoute, 'active hazard')} on the route (${e.confirmedOnRoute} confirmed, ${e.unverifiedOnRoute} unverified).`)
  else reasons.push('No active hazard record matches this route in the available data.')
  if (e.nearRoute) reasons.push(`${plural(e.nearRoute, 'more hazard')} within a few hundred metres of the route.`)
  const blocking = me.eval.limitations.filter((l) => l.blocksCandidate)
  if (blocking.length) reasons.push(`${plural(blocking.length, 'data limitation')} reduce what can be concluded (listed below).`)

  const fastest = Math.min(...ranked.map((r) => r.durationS))
  if (me.durationS === fastest) reasons.push('Fastest of the candidates returned by the routing provider.')
  else reasons.push(`${plural(minutes(me.durationS - fastest), 'minute')} slower than the fastest candidate.`)

  if (ranked.length > 1) {
    const top = ranked[0]
    if (i === 0) {
      const next = ranked[1]
      if (me.eval.hasClosure) reasons.push('Every candidate returned contains a confirmed closure, so none is a clear option. This one is first only on fewer concerns or travel time.')
      else if (next.eval.hasClosure) reasons.push('Ranked first because the next candidate contains a confirmed closure.')
      else if (next.eval.rankScore > me.eval.rankScore + 1e-9) reasons.push('Ranked first: lower weighted hazard and data-limitation concerns than the next candidate.')
      else reasons.push('Ranked first on travel time; concerns are comparable to the next candidate.')
    } else if (me.eval.hasClosure && !top.eval.hasClosure) {
      reasons.push('Ranked lower because of its confirmed closure.')
    } else if (me.eval.rankScore > top.eval.rankScore + 1e-9) {
      reasons.push('Ranked below the top-ranked route because it carries more weighted hazard and data-limitation concerns.')
    } else {
      reasons.push('Ranked lower on travel time; concerns are comparable to the top-ranked route.')
    }
  }
  return reasons
}

export function recommendationFor(status: RouteStatus, isBestNonBlocked: boolean): Recommendation {
  if (status === 'known_blockage') return 'not_recommended'
  if (status === 'no_hazards_found' && isBestNonBlocked) return 'candidate_for_dispatcher_review'
  return 'review_required'
}

export const labelFor = (s: RouteStatus) => STATUS_LABELS[s]
