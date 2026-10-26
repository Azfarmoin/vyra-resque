// Orchestrates one analysis:
//   origin + destination -> routing provider -> candidate road geometries -> hazard dataset
//   -> geographic matching -> deterministic evaluation/ranking -> optional AI explanation -> audit record
// Every number about distance and time comes from the provider; every status comes from routeScoring.
import { randomUUID } from 'node:crypto'
import { AI_TIMEOUT_MS, buildAiInput, notConfigured, skipped, type AiExplainer } from '../ai/hazardExplanation'
import { bufferPathToRings, boundsOf, boxesOverlap, expandBox, haversineM, simplifyPolyline } from './geo'
import { findDuplicates, hazardBasisTime, matchRoute } from './hazardMatcher'
import { loadHazards as defaultLoadHazards } from './hazardSources'
import { RoutingUnavailableError, snapDistanceM, type ProviderRoute, type RoutingProvider } from './providers'
import { compareRoutes, evaluateRoute, explainRank, labelFor, LOCAL_DATA_RADIUS_M, recommendationFor, type RouteEval, type RouteEvalInput } from './routeScoring'
import { DISCLAIMER, type AiStatus, type AnalysisResult, type CandidateRoute, type Hazard, type HazardDataset, type LatLng, type VehicleType } from './types'

export class AnalysisError extends Error {
  constructor(public code: 'routing_unavailable' | 'invalid_request', public status: number, message: string) {
    super(message)
  }
}

export interface AuditRecord {
  id: string
  analyzedAt: string
  vehicle: VehicleType
  origin: LatLng
  destination: LatLng
  provider: string
  dataSources: HazardDataset['sources']
  skippedRecords: number
  hazardIds: string[]
  candidates: {
    id: string
    rank: number
    status: string
    recommendation: string
    distanceM: number
    durationS: number
    hazardIds: string[]
    limitationCodes: string[]
    recalculated: boolean
  }[]
  newestRecordAt: string | null
  aiState: AiStatus['state']
  notices: string[]
}

export interface AnalyzeInput {
  origin: LatLng
  destination: LatLng
  vehicle: VehicleType
  includeAi?: boolean
}

export interface AnalyzeDeps {
  provider: RoutingProvider | null
  loadHazards?: () => Promise<HazardDataset>
  explainer?: AiExplainer | null
  saveAudit?: (record: AuditRecord) => Promise<boolean>
  now?: Date
  routingTimeoutMs?: number
}

/** Radius used when asking a provider to avoid a confirmed closure that is mapped as a point. */
const AVOID_POINT_RADIUS_M = 60
const AVOID_LINE_BUFFER_M = 25

async function withTimeout<T>(ms: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), ms)
  try {
    return await fn(ctl.signal)
  } finally {
    clearTimeout(timer)
  }
}

const sameRoute = (a: ProviderRoute, b: ProviderRoute) =>
  Math.abs(a.distanceM - b.distanceM) / Math.max(1, b.distanceM) < 0.01 && Math.abs(a.durationS - b.durationS) / Math.max(1, b.durationS) < 0.01

interface Built {
  id: string
  raw: ProviderRoute
  input: RouteEvalInput
  eval: RouteEval
  findings: CandidateRoute['findings']
  recalculated: boolean
  avoided: string[]
}

export async function analyzeRoutes(input: AnalyzeInput, deps: AnalyzeDeps): Promise<AnalysisResult> {
  const now = deps.now ?? new Date()
  const { provider } = deps
  if (!provider) throw new AnalysisError('routing_unavailable', 503, 'No routing provider is configured, so no routes can be calculated. Emergency reporting is unaffected.')
  const timeoutMs = deps.routingTimeoutMs ?? 10_000

  // 1. Candidate routes from the real road network.
  let raw: ProviderRoute[]
  try {
    raw = await withTimeout(timeoutMs, (signal) => provider.route({ origin: input.origin, destination: input.destination, vehicle: input.vehicle, alternatives: 3 }, signal))
  } catch (err) {
    if (err instanceof RoutingUnavailableError) throw new AnalysisError('routing_unavailable', 503, `${err.message} No routes were calculated; nothing here is an estimate.`)
    throw err
  }

  const notices: string[] = []
  if (provider.note) notices.push(provider.note)

  // 2. Hazard data. loadHazards reports failing sources instead of throwing.
  const dataset = await (deps.loadHazards ?? defaultLoadHazards)()
  const duplicates = findDuplicates(dataset.hazards)
  const straight = haversineM(input.origin, input.destination)

  const build = (r: ProviderRoute, id: string, recalculated: boolean, avoided: string[], closuresAnywhere: boolean): Built => {
    const box = boundsOf(r.geometry)!
    const localBox = expandBox(box, LOCAL_DATA_RADIUS_M)
    const local = dataset.hazards.filter((h) => boxesOverlap(localBox, boundsOf(h.geometry.type === 'point' ? [h.geometry.point] : h.geometry.path)!))
    const newestLocal = local.reduce<string | null>((acc, h) => {
      const t = hazardBasisTime(h)
      return t && (!acc || t > acc) ? t : acc
    }, null)
    const findings = matchRoute(r.geometry, dataset.hazards, { now, duplicates })
    const evalInput: RouteEvalInput = {
      index: 0,
      distanceM: r.distanceM,
      durationS: r.durationS,
      findings,
      originSnapM: snapDistanceM(input.origin, r.geometry[0]),
      destinationSnapM: snapDistanceM(input.destination, r.geometry[r.geometry.length - 1]),
      straightLineM: straight,
      newestLocalRecordAt: newestLocal,
      localRecordCount: local.length,
    }
    return {
      id,
      raw: r,
      input: evalInput,
      eval: evaluateRoute(evalInput, { dataset, vehicle: input.vehicle, now, providerSupportsExclusions: provider.supportsExclusions, closuresOnAnyRoute: closuresAnywhere }),
      findings,
      recalculated,
      avoided,
    }
  }

  const usable = raw.filter((r) => r.geometry.length >= 2)
  let built = usable.map((r, i) => build(r, `route-${i + 1}`, false, [], false))

  // 3. Closures that touch any candidate -> try a genuine recalculation, only where the engine supports it.
  const hazardsById = new Map<string, Hazard>(dataset.hazards.map((h) => [h.id, h]))
  const closureIds = new Set(built.flatMap((b) => b.findings.filter((f) => f.proximity === 'on_route' && f.state === 'active' && f.duplicateOf === null && f.verification === 'confirmed' && f.blocksRoad === true).map((f) => f.hazardId)))
  let recalculation = { attempted: false, usedExclusions: false, note: 'No confirmed closure lies on a candidate route, so no recalculation was needed.' }
  if (usable.length && closureIds.size) {
    if (!provider.supportsExclusions) {
      recalculation = {
        attempted: false,
        usedExclusions: false,
        note: `${provider.name} cannot be told to avoid a specific road. Only the alternatives it returned are shown; none were recalculated around the closure.`,
      }
      notices.push(recalculation.note)
    } else {
      recalculation = { attempted: true, usedExclusions: true, note: 'Asked the routing provider for routes avoiding all confirmed closures near the candidates.' }
      const rings: number[][][] = []
      const avoided: string[] = []
      const allBox = expandBox(boundsOf(usable.flatMap((r) => r.geometry))!, 2000)
      for (const h of dataset.hazards) {
        if (h.verification !== 'confirmed' || h.blocksRoad !== true) continue
        const pts = h.geometry.type === 'point' ? [h.geometry.point] : h.geometry.path
        if (!boxesOverlap(allBox, boundsOf(pts)!)) continue
        rings.push(...bufferPathToRings(pts, h.geometry.type === 'point' ? Math.min(h.geometry.radiusM, AVOID_POINT_RADIUS_M) : AVOID_LINE_BUFFER_M))
        avoided.push(h.id)
      }
      try {
        const extra = await withTimeout(timeoutMs, (signal) => provider.route({ origin: input.origin, destination: input.destination, vehicle: input.vehicle, alternatives: 2, avoidRings: rings }, signal))
        const fresh = extra.filter((r) => r.geometry.length >= 2 && !usable.some((u) => sameRoute(u, r)))
        built = [...built, ...fresh.map((r, i) => build(r, `route-${built.length + i + 1}`, true, avoided.filter((id) => hazardsById.has(id)), true))]
        if (!fresh.length) recalculation.note = 'The provider returned no route different from the originals when avoiding the closures. The original candidates are shown with their closures marked.'
      } catch (err) {
        recalculation = { attempted: true, usedExclusions: true, note: `Recalculation around closures failed (${err instanceof Error ? err.message : 'provider error'}). No recalculated route is shown.` }
        notices.push(recalculation.note)
      }
    }
  }

  // 4. Rank (deterministic), then explain the ranking in words.
  const ranked = [...built].sort((a, b) => compareRoutes({ eval: a.eval, distanceM: a.raw.distanceM, durationS: a.raw.durationS, input: a.input }, { eval: b.eval, distanceM: b.raw.distanceM, durationS: b.raw.durationS, input: b.input }))
  const rankView = ranked.map((b) => ({ eval: b.eval, durationS: b.raw.durationS, distanceM: b.raw.distanceM, status: b.eval.status }))
  const bestNonBlocked = ranked.findIndex((b) => !b.eval.hasClosure)

  let candidates: CandidateRoute[] = ranked.map((b, i) => ({
    id: b.id,
    rank: i + 1,
    distanceM: Math.round(b.raw.distanceM),
    durationS: Math.round(b.raw.durationS),
    geometry: simplifyPolyline(b.raw.geometry, 5),
    status: b.eval.status,
    statusLabel: labelFor(b.eval.status),
    recommendation: recommendationFor(b.eval.status, i === bestNonBlocked),
    findings: b.findings,
    limitations: b.eval.limitations,
    rankReasons: explainRank(rankView, i),
    exposure: b.eval.exposure,
    coverage: b.eval.coverage,
    roadAccess: { verified: false, vehicle: input.vehicle, note: 'No responder or survey has verified road access along this route.' },
    recalculated: b.recalculated,
    avoidedHazardIds: b.avoided,
    ai: null,
  }))

  if (!candidates.length) notices.push('The routing provider found no drivable route between these points. This may reflect gaps in its road map or genuine disconnection; do not treat it as a statement about the area.')
  if (candidates.some((c) => c.coverage.state === 'partial')) notices.push('At least one endpoint is far from any road the provider knows about. Check the location before relying on a route.')
  for (const s of dataset.sources.filter((x) => !x.ok)) notices.push(`${s.name} was unavailable: hazards from that source are missing.`)

  // 5. Optional AI explanation. Never required, never able to change the results above.
  let ai: AnalysisResult['ai'] = { state: 'skipped' }
  let aiDuplicateGroups: AnalysisResult['aiDuplicateGroups'] = []
  let aiExtractions: AnalysisResult['aiExtractions'] = []
  if (input.includeAi !== false && candidates.length) {
    const explainer = deps.explainer ?? null
    const result = explainer ? await withTimeout(AI_TIMEOUT_MS, (signal) => explainer(buildAiInput(input.vehicle, candidates), signal)).catch(() => null) : notConfigured()
    if (!result) {
      ai = { state: 'unavailable', reason: 'The AI service failed. Routes and hazards above are unaffected.' }
    } else {
      ai = result.status
      candidates = candidates.map((c) => ({ ...c, ai: result.routes.get(c.id) ?? null }))
      aiDuplicateGroups = result.duplicateGroups
      aiExtractions = result.extractions
    }
  } else if (input.includeAi === false) {
    ai = skipped().status
  }

  // 6. Audit record. If it cannot be saved, no analysisId is returned and approvals stay disabled.
  const allIds = [...new Set(candidates.flatMap((c) => c.findings.map((f) => f.hazardId)))]
  const newest = dataset.sources.reduce<string | null>((acc, s) => (s.newestAt && (!acc || s.newestAt > acc) ? s.newestAt : acc), null)
  const analysisId = randomUUID()
  const record: AuditRecord = {
    id: analysisId,
    analyzedAt: now.toISOString(),
    vehicle: input.vehicle,
    origin: input.origin,
    destination: input.destination,
    provider: provider.id,
    dataSources: dataset.sources,
    skippedRecords: dataset.skipped.length,
    hazardIds: allIds,
    candidates: candidates.map((c) => ({
      id: c.id,
      rank: c.rank,
      status: c.status,
      recommendation: c.recommendation,
      distanceM: c.distanceM,
      durationS: c.durationS,
      hazardIds: c.findings.map((f) => f.hazardId),
      limitationCodes: c.limitations.map((l) => l.code),
      recalculated: c.recalculated,
    })),
    newestRecordAt: newest,
    aiState: ai.state,
    notices,
  }
  let auditSaved = false
  try {
    auditSaved = deps.saveAudit ? await deps.saveAudit(record) : false
  } catch {
    auditSaved = false
  }
  if (!auditSaved) notices.push('This analysis could not be saved to the audit log, so route approval is disabled. Refresh to try again.')

  return {
    analysisId: auditSaved ? analysisId : null,
    auditSaved,
    analyzedAt: now.toISOString(),
    vehicle: input.vehicle,
    origin: input.origin,
    destination: input.destination,
    provider: { id: provider.id, name: provider.name, supportsExclusions: provider.supportsExclusions, note: provider.note },
    recalculation,
    candidates,
    notices,
    dataFreshness: { sources: dataset.sources, newestRecordAt: newest, skippedRecords: dataset.skipped.length, recordsConsidered: dataset.hazards.length },
    aiDuplicateGroups,
    aiExtractions,
    ai,
    disclaimer: DISCLAIMER,
  }
}
