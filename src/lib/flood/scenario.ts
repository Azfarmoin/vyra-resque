// Orchestrates one scenario run: validate -> resolve the area -> terrain / rainfall -> engine -> assets -> exposure -> quality.
// It reads from operational registers but never writes to them. The output is a plain JSON ScenarioResult plus drawing layers.
import { bathtub, rainfallPonding, summarise, uniformOverlay } from './engine'
import { chooseElevationProvider, ProviderError, type ElevationProvider } from './elevation'
import { GridField, PolygonField, UniformField, packGrid, type DepthField } from './field'
import { areaOfKm2, bboxOfArea, circlePolygon, makeGridSpec, pointInArea, rasterizeArea, padBBox, validateArea, type GridSpec } from './geo'
import { buildingExposure, incidentContext, pointExposure, resourceExposure, roadExposure } from './exposure'
import { assumptionsFor, headlineFor, limitationsFor, missingStatus, rainfallStatus, terrainStatus } from './quality'
import type { FloodConfig } from './config'
import { failedLoad, type AssetProviders } from './assets'
import type { RainfallProvider, RainfallResult } from './rainfall'
import type { ScenarioInput } from './schema'
import { AREAS } from '../constants'
import {
  DEPTH_BANDS, DISCLAIMER, ESTIMATE_BANNER, FloodError, MODEL_VERSION, TIERS,
  type AreaGeometry, type BBox, type DatasetStatus, type DepthFeatureCollection, type LatLng, type Loaded, type ObservationComparison, type ObservationRecord,
  type ProvenanceNote, type ScenarioKind, type ScenarioLayers, type ScenarioResult, type ScenarioSummary, type TierId,
} from './types'

export interface FloodDeps {
  config: FloodConfig
  assets: AssetProviders
  rainfall?: RainfallProvider | null
  elevation?: { geotiff?: ElevationProvider | null; openMeteo?: ElevationProvider | null }
  observations: (bbox: BBox) => Promise<ObservationRecord[]>
  resolveZone: (id: string) => Promise<AreaGeometry | null>
  now?: () => Date
}

export interface RunOutput {
  result: ScenarioResult
  layers: ScenarioLayers
  /** Not persisted: rebuilt from layers when needed. */
  field: DepthField
  name: string
}

const centroid = (b: BBox): LatLng => [(b[1] + b[3]) / 2, (b[0] + b[2]) / 2]

export async function resolveArea(src: ScenarioInput['areaSource'], deps: FloodDeps): Promise<{ area: AreaGeometry; areaKm2: number; bbox: BBox; label: string; basis: string }> {
  const opt = { maxAreaKm2: deps.config.maxAreaKm2, allowAnyRegion: deps.config.allowAnyRegion }
  if (src.kind === 'operational_area') {
    const a = AREAS.find((x) => x.name === src.name)
    if (!a) throw new FloodError('invalid_area', 400, `Unknown area "${src.name}".`)
    const v = validateArea(circlePolygon(a.center, src.radiusM), opt)
    return { ...v, label: `${a.name} (${(src.radiusM / 1000).toFixed(1)} km radius)`, basis: `A circle of ${src.radiusM} m around the VYRA operational-area centre point for ${a.name}. This is NOT an administrative boundary.` }
  }
  if (src.kind === 'vyra_zone') {
    const g = await deps.resolveZone(src.zoneId)
    if (!g) throw new FloodError('zone_not_found', 404, 'That disaster zone was not found.')
    if (g.type !== 'Polygon' && g.type !== 'MultiPolygon') throw new FloodError('zone_not_area', 422, 'That zone is a point or a line, not an area.')
    const v = validateArea(g, opt)
    return { ...v, label: 'Existing VYRA zone', basis: 'The boundary of an existing VYRA disaster zone, used as drawn.' }
  }
  const v = validateArea(src.geometry, opt)
  return { ...v, label: 'Drawn area', basis: 'An outline drawn by the user on the map.' }
}

function compareObservations(obs: ObservationRecord[], field: DepthField, from: string, to: string): ObservationComparison {
  const f = Date.parse(from)
  const t = Date.parse(to)
  const inWin = obs.filter((o) => Date.parse(o.observedAt) >= f && Date.parse(o.observedAt) <= t)
  const rows = inWin.map((o) => {
    const e = field.depthAt(o.lat, o.lng)
    return { id: o.id, observedM: o.depthM, estimatedM: e == null ? null : Math.round(e * 100) / 100, errorM: e == null ? null : Math.round((e - o.depthM) * 100) / 100 }
  })
  const used = rows.filter((r) => r.errorM != null) as { errorM: number }[]
  const n = used.length
  const mean = n ? used.reduce((s, r) => s + r.errorM, 0) / n : null
  return {
    windowFrom: from, windowTo: to, n: inWin.length, usable: n,
    meanErrorM: mean == null ? null : Math.round(mean * 100) / 100,
    maeM: n ? Math.round((used.reduce((s, r) => s + Math.abs(r.errorM), 0) / n) * 100) / 100 : null,
    rmseM: n ? Math.round(Math.sqrt(used.reduce((s, r) => s + r.errorM ** 2, 0) / n) * 100) / 100 : null,
    rows,
    note: n < 10
      ? `Only ${n} usable observation(s). This comparison is anecdotal and does NOT validate the estimate. It only helps judge whether the estimate is in the right range for this event. A scenario is meaningfully comparable to observations only if its inputs describe the same event.`
      : 'A comparison with measured depths for the stated window. It describes how far this estimate was from those observations, not how accurate it would be for another event.',
  }
}

type Loadeds = Awaited<ReturnType<typeof loadAssets>>
async function guard<T>(run: () => Promise<Loaded<T>>, id: string, label: string, group: DatasetStatus['group']): Promise<Loaded<T>> {
  try { return await run() } catch (e) { return failedLoad<T>(id, label, group, e) }
}
async function loadAssets(p: AssetProviders, bbox: BBox) {
  const [shelters, hospitals, roads, blocked, buildings, teams, resources, incidents, drainage] = await Promise.all([
    guard(() => p.shelters(bbox), 'shelters', 'Shelters', 'assets'),
    guard(() => p.hospitals(bbox), 'hospitals', 'Hospitals', 'assets'),
    guard(() => p.roads(bbox), 'roads', 'Road network', 'assets'),
    guard(() => p.blockedRoads(bbox), 'blocked_roads', 'Reported blocked roads', 'assets'),
    guard(() => p.buildings(bbox), 'buildings', 'Buildings', 'assets'),
    guard(() => p.teams(bbox), 'teams', 'Rescue teams', 'assets'),
    guard(() => p.resources(), 'resources', 'Supplies and equipment', 'assets'),
    guard(() => p.incidents(bbox), 'incidents', 'Open incident reports (read-only context)', 'context'),
    guard(() => p.drainage(bbox), 'drainage', 'Drainage network (drains, nullahs)', 'context'),
  ])
  return { shelters, hospitals, roads, blocked, buildings, teams, resources, incidents, drainage }
}

export async function assessField(field: DepthField, a: { area: AreaGeometry; bbox: BBox }, deps: FloodDeps, minDepthM: number, obsWindow?: { from: string; to: string }) {
  const L: Loadeds = await loadAssets(deps.assets, padBBox(a.bbox, 300))
  // Only assets inside the scenario area are assessed: the field returns null elsewhere.
  const exposure = {
    shelters: pointExposure(L.shelters, field, minDepthM),
    hospitals: pointExposure(L.hospitals, field, minDepthM),
    roads: roadExposure(L.roads, field, minDepthM),
    blockedRoadRegister: roadExposure(L.blocked, field, minDepthM),
    buildings: buildingExposure(L.buildings, field, minDepthM),
    resources: resourceExposure(L.teams, L.resources, field, minDepthM),
    incidents: incidentContext(L.incidents, field, minDepthM),
  }
  let observations: ObservationRecord[] = []
  let obsStatus: DatasetStatus
  try {
    observations = (await deps.observations(a.bbox)).filter((o) => pointInArea(o.lat, o.lng, a.area))
    obsStatus = { id: 'observations', label: 'Recorded flood observations', group: 'context', state: observations.length ? 'ok' : 'empty', level: observations.length ? 'fair' : 'missing', source: 'VYRA flood observation register (entered by staff)', asOf: observations.length ? observations.map((o) => o.observedAt).sort().at(-1)! : null, ageDays: null, resolutionM: null, count: observations.length, notes: observations.length ? ['Observations are real records entered or imported by staff and are never generated by VYRA.'] : ['No recorded flood observations in this area, so the estimate cannot be compared with measured depths.'] }
  } catch (e) {
    obsStatus = { id: 'observations', label: 'Recorded flood observations', group: 'context', state: 'failed', level: 'missing', source: null, asOf: null, ageDays: null, resolutionM: null, count: null, notes: ['The observation register could not be read.'], error: (e as Error).message.slice(0, 160) }
  }
  const comparison = obsWindow && obsStatus.state !== 'failed' ? compareObservations(observations, field, obsWindow.from, obsWindow.to) : null

  const dr = L.drainage.data
  const drainage = dr
    ? { available: true, featureCount: dr.length, lengthKm: Math.round((dr.reduce((s, r) => s + r.path.reduce((t, p, i) => (i ? t + Math.hypot((p[1] - r.path[i - 1][1]) * 111320 * Math.cos((p[0] * Math.PI) / 180), (p[0] - r.path[i - 1][0]) * 111320) : t), 0), 0)) / 100) / 10, note: 'Drains and nullahs are shown for context. Their capacity is NOT modelled; in a rainfall run, reflect them only through the drainage capacity you typed in.' }
    : { available: false, featureCount: null, lengthKm: null, note: 'No drainage data is available, so the drainage network is not represented at all.' }

  const datasets: DatasetStatus[] = [L.shelters, L.hospitals, L.roads, L.blocked, L.buildings, L.teams, L.resources, L.incidents, L.drainage].map((l) => l.status).concat(obsStatus)
  return { exposure, observations: { available: obsStatus.state !== 'failed', inArea: observations.slice(0, 200), comparison }, drainage, datasets }
}

export async function runScenario(input: ScenarioInput, deps: FloodDeps): Promise<RunOutput> {
  const cfg = deps.config
  const now = (deps.now?.() ?? new Date())
  const a = await resolveArea(input.areaSource, deps)
  const minDepthM = input.options.minDepthM
  const spec0 = input.scenario
  const kind: ScenarioKind = spec0.kind
  const warnings: string[] = []
  const provenance: ProvenanceNote[] = [{ label: 'Model', value: MODEL_VERSION }, { label: 'Computed', value: now.toISOString() }]
  const datasets: DatasetStatus[] = []
  let field: DepthField
  let layers: ScenarioLayers
  let summary: ScenarioSummary
  let tier: TierId
  let assumptions: string[]
  let effectiveCellM: number | null = null

  if (spec0.kind === 'hypothetical_overlay') {
    tier = 'hypothetical_overlay'
    field = new UniformField(a.area, spec0.depthM, a.bbox)
    layers = { kind: 'uniform', depthM: spec0.depthM }
    const flooded = spec0.depthM >= minDepthM
    if (!flooded) warnings.push(`The depth (${spec0.depthM} m) is below the flooded threshold (${minDepthM} m), so nothing counts as flooded.`)
    const bandId = DEPTH_BANDS.find((b) => spec0.depthM >= b.min && (b.max == null || spec0.depthM < b.max))?.id
    summary = {
      areaKm2: round(a.areaKm2, 3), assessedAreaKm2: round(a.areaKm2, 3), floodedAreaKm2: flooded ? round(a.areaKm2, 3) : 0, floodedFractionOfAssessed: flooded ? 1 : 0,
      maxDepthM: flooded ? spec0.depthM : null, meanDepthM: flooded ? spec0.depthM : null, volumeM3: flooded ? Math.round(spec0.depthM * a.areaKm2 * 1e6) : null,
      bandAreasKm2: Object.fromEntries(DEPTH_BANDS.map((b) => [b.id, flooded && b.id === bandId ? round(a.areaKm2, 3) : 0])), cellSizeM: null, cells: null, unassessedFraction: 0,
    }
    assumptions = assumptionsFor(kind, { depthM: spec0.depthM, minDepthM })
    datasets.push(missingStatus('terrain', 'Terrain (elevation model)', 'terrain', 'Not used by this scenario type. Every point is treated as if it were at the same height.'))
    datasets.push(missingStatus('rainfall', 'Rainfall input', 'rainfall', 'Not used by this scenario type.'))
  } else {
    tier = 'terrain_estimate'
    // Rainfall first: a failing rainfall service should fail before any terrain work is done.
    let rain: RainfallResult | null = null
    if (spec0.kind === 'terrain_rainfall') {
      const r = spec0.rainfall
      if (r.kind === 'manual') rain = { totalMm: r.mm, durationHours: r.durationHours, kind: 'manual', sourceName: r.note ? `Typed in: ${r.note}` : 'Typed in by the user', windowStart: null, windowEnd: null, asOf: now.toISOString(), notes: [] }
      else {
        if (!(Date.parse(r.end) > Date.parse(r.start))) throw new FloodError('invalid_input', 400, 'The rainfall window must end after it starts.')
        if (!deps.rainfall) throw new ProviderError('rainfall_not_configured', 'Open-Meteo rainfall is not enabled.', 'Set FLOOD_OPEN_METEO_ENABLED=true (non-commercial use only) or type in a rainfall total.', 503)
        rain = await deps.rainfall.total(centroid(a.bbox), new Date(r.start), new Date(r.end))
      }
    }
    const seeds: LatLng[] = spec0.kind === 'terrain_bathtub' && spec0.connectivity === 'seeded' ? (spec0.seeds as LatLng[]) : []
    if (spec0.kind === 'terrain_bathtub' && spec0.connectivity === 'seeded' && seeds.length === 0) throw new FloodError('missing_source', 422, 'Connected flooding needs at least one source point (where the water comes from).', 'Click the map to place a source point, or switch connectivity off to flood every cell below the level.')
    let wbox = a.bbox
    for (const [la, ln] of seeds) wbox = [Math.min(wbox[0], ln), Math.min(wbox[1], la), Math.max(wbox[2], ln), Math.max(wbox[3], la)]
    wbox = padBBox(wbox, 100)

    const provider = await chooseElevationProvider(cfg, wbox, spec0.elevationSource, deps.elevation)
    const target = Math.max(input.options.targetCellM ?? 0, provider.targetCellM())
    const gspec: GridSpec = makeGridSpec(wbox, target, Math.min(cfg.maxCells, provider.maxCells()))
    const grid = await provider.fetchGrid(gspec)
    const mask = rasterizeArea(a.area, gspec)
    let maskCells = 0
    let noData = 0
    for (let i = 0; i < mask.length; i++) if (mask[i]) { maskCells++; if (!Number.isFinite(grid.z[i])) noData++ }
    if (maskCells === 0) throw new FloodError('area_too_small', 422, 'The area is smaller than one terrain cell at this resolution.', 'Choose a larger area.')
    if (noData / maskCells > 0.5) throw new FloodError('insufficient_terrain', 422, `More than half of the area (${Math.round((100 * noData) / maskCells)}%) has no terrain data, so no estimate can be made.`, 'Choose an area the elevation data covers.')
    if (noData) warnings.push(`${noData} of ${maskCells} cells have no terrain data and were not assessed.`)

    let res
    if (spec0.kind === 'terrain_bathtub') {
      res = bathtub(grid.z, mask, gspec, { waterLevelM: spec0.waterSurfaceElevationM, connectivity: spec0.connectivity, seeds })
      assumptions = assumptionsFor(kind, { level: spec0.waterSurfaceElevationM, connectivity: spec0.connectivity, seeds: seeds.length, minDepthM })
    } else {
      const r = spec0 as Extract<typeof spec0, { kind: 'terrain_rainfall' }>
      res = rainfallPonding(grid.z, mask, gspec, { rainfallMm: rain!.totalMm, runoffCoefficient: r.runoffCoefficient, drainageCapacityMm: r.drainageCapacityMm, infiltrationMm: r.infiltrationMm })
      assumptions = assumptionsFor(kind, { rainfallMm: rain!.totalMm, runoff: r.runoffCoefficient, drainageMm: r.drainageCapacityMm, infiltrationMm: r.infiltrationMm, effectiveMm: res.info.effectiveMm, minDepthM })
      provenance.push({ label: 'Rainfall', value: `${rain!.totalMm} mm over ${rain!.durationHours} h (${rain!.sourceName})` })
      if (Number.isFinite(res.info.waterLevelM)) provenance.push({ label: 'Ponded water level reached', value: `${res.info.waterLevelM.toFixed(2)} m (terrain datum)` })
      datasets.push(rainfallStatus(rain!))
    }
    warnings.push(...res.warnings)
    const s = summarise(res.depth, gspec, maskCells, minDepthM)
    effectiveCellM = s.cellSizeM
    const unassessed = maskCells ? noData / maskCells : 0
    summary = { areaKm2: round(a.areaKm2, 3), unassessedFraction: round(unassessed, 4), ...s }
    delete (summary as unknown as { assessedCells?: number }).assessedCells
    datasets.unshift(terrainStatus(grid.meta, effectiveCellM ?? target, unassessed, s.maxDepthM))
    if (spec0.kind === 'terrain_bathtub') datasets.push(missingStatus('rainfall', 'Rainfall input', 'rainfall', 'Not used: this scenario is driven by a water level.'))
    field = new GridField(gspec, res.depth)
    layers = { kind: 'grid', grid: packGrid(gspec, res.depth) }
    provenance.push({ label: 'Terrain', value: `${grid.meta.name}, working cell about ${Math.round(effectiveCellM ?? target)} m${grid.meta.vintage ? `, vintage ${grid.meta.vintage}` : ''}` })
    if (grid.meta.synthetic) warnings.unshift('SYNTHETIC TEST TERRAIN: this run used invented ground, not real data.')
    if (s.maxDepthM != null && grid.meta.verticalErrorM != null && s.maxDepthM <= grid.meta.verticalErrorM) warnings.push(`All estimated depths are within the terrain data's vertical error (about ${grid.meta.verticalErrorM} m).`)
  }

  const assessed = await assessField(field, a, deps, minDepthM, input.options.compareObservations)
  const allDatasets = [...datasets, ...assessed.datasets]
  const result: ScenarioResult = {
    isEstimate: true, isSimulation: true, banner: ESTIMATE_BANNER, modelVersion: MODEL_VERSION, computedAt: now.toISOString(), kind, tier: TIERS[tier],
    area: { geometry: a.area, areaKm2: round(a.areaKm2, 3), bbox: a.bbox, label: a.label, basis: a.basis },
    inputs: input, summary, exposure: assessed.exposure, observations: assessed.observations, drainage: assessed.drainage,
    dataQuality: { reliability: tier === 'hypothetical_overlay' ? 'illustrative' : 'screening', datasets: allDatasets, headline: headlineFor(tier, allDatasets) },
    assumptions, limitations: limitationsFor(tier, { effectiveCellM, kind }), warnings, provenance, disclaimer: DISCLAIMER,
  }
  const name = input.name || `${TIERS[tier].title.split(' (')[0]}: ${a.label}`
  return { result, layers, field, name }
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d

// ---- imported hydraulic output (administrators) ----------------------------------------------------------------------

import type { ImportInput } from './schema'

export interface ValidationAssessment { validated: boolean; missing: string[] }
export function assessValidation(v: ImportInput['validation']): ValidationAssessment {
  const missing: string[] = []
  if (v.status !== 'validated') missing.push('status is not "validated"')
  if (!v.method) missing.push('validation method')
  if (!v.validatedBy) missing.push('who validated it')
  if (!v.validatedAt) missing.push('when it was validated')
  if (!((v.metricName && v.metricValue !== undefined) || v.reportUrl)) missing.push('a skill metric with its value, or a link to the validation report')
  return { validated: missing.length === 0, missing }
}

export async function importHydraulic(input: ImportInput, deps: FloodDeps): Promise<RunOutput> {
  const now = deps.now?.() ?? new Date()
  const a = await resolveArea({ kind: 'polygon', geometry: input.area }, deps)
  const feats: DepthFeatureCollection['features'] = []
  let skipped = 0
  for (const f of input.depths.features as { type?: string; properties?: { depth_m?: unknown }; geometry?: { type?: string; coordinates?: unknown } }[]) {
    const d = f?.properties?.depth_m
    const g = f?.geometry
    if (f?.type !== 'Feature' || typeof d !== 'number' || !Number.isFinite(d) || d < 0 || d > 30 || !g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon') || !Array.isArray(g.coordinates)) { skipped++; continue }
    try { validateArea(g, { maxAreaKm2: 1e9, allowAnyRegion: true, minAreaKm2: 0, maxVertices: 100_000 }) } catch { skipped++; continue }
    feats.push({ type: 'Feature', properties: { depth_m: d }, geometry: { type: g.type, coordinates: g.coordinates } })
  }
  if (!feats.length) throw new FloodError('invalid_input', 400, 'None of the depth features were usable. Each needs a Polygon or MultiPolygon geometry and a numeric depth_m between 0 and 30.')
  const fc: DepthFeatureCollection = { type: 'FeatureCollection', features: feats }
  const field = new PolygonField(fc, a.area, a.bbox)
  const gspec = makeGridSpec(a.bbox, 20, Math.min(deps.config.maxCells, 40_000))
  const mask = rasterizeArea(a.area, gspec)
  const depth = new Float32Array(mask.length).fill(NaN)
  for (let r = 0; r < gspec.ny; r++) for (let c = 0; c < gspec.nx; c++) { const i = r * gspec.nx + c; if (mask[i]) { const d = field.depthAt(gspec.bbox[3] - (r + 0.5) * gspec.dyDeg, gspec.bbox[0] + (c + 0.5) * gspec.dxDeg); if (d != null) depth[i] = d } }
  const s = summarise(depth, gspec, 0, 0.1)
  delete (s as unknown as { assessedCells?: number }).assessedCells
  const val = assessValidation(input.validation)
  const tier: TierId = val.validated ? 'validated_hydraulic' : 'imported_unvalidated'
  const warnings: string[] = []
  if (skipped) warnings.push(`${skipped} depth feature(s) were unusable and skipped.`)
  if (!val.validated) warnings.push(`Validation record incomplete (missing: ${val.missing.join('; ')}). Shown as UNVALIDATED.`)
  const summary: ScenarioSummary = { areaKm2: round(a.areaKm2, 3), unassessedFraction: 0, ...s }
  const assessed = await assessField(field, a, deps, 0.1)
  const modelDs: DatasetStatus = { id: 'hydraulic_model', label: 'Imported hydraulic model output', group: 'terrain', state: val.validated ? 'ok' : 'partial', level: val.validated ? 'fair' : 'poor', source: `${input.model.name}${input.model.version ? ` ${input.model.version}` : ''}${input.model.software ? ` (${input.model.software})` : ''}`, asOf: input.model.runDate ?? null, ageDays: null, resolutionM: null, count: feats.length, notes: [val.validated ? `Validation record: ${input.validation.method}; ${input.validation.metricName ?? 'see report'} ${input.validation.metricValue ?? ''}; by ${input.validation.validatedBy} on ${input.validation.validatedAt}. Supplied by the importer; VYRA has not checked it.` : 'No complete validation record.'] }
  const allDatasets = [modelDs, ...assessed.datasets]
  const result: ScenarioResult = {
    isEstimate: true, isSimulation: true, banner: ESTIMATE_BANNER, modelVersion: MODEL_VERSION, computedAt: now.toISOString(), kind: 'imported_hydraulic', tier: TIERS[tier],
    area: { geometry: a.area, areaKm2: round(a.areaKm2, 3), bbox: a.bbox, label: a.label, basis: 'The area supplied with the imported model output.' },
    inputs: { name: input.name, model: input.model, validation: input.validation, features: feats.length }, summary, exposure: assessed.exposure, observations: assessed.observations, drainage: assessed.drainage,
    dataQuality: { reliability: val.validated ? 'validated' : 'model_output', datasets: allDatasets, headline: headlineFor(tier, allDatasets) },
    assumptions: assumptionsFor('imported_hydraulic', { minDepthM: 0.1 }), limitations: limitationsFor(tier, { kind: 'imported_hydraulic' }), warnings,
    provenance: [{ label: 'Model', value: `${input.model.name} ${input.model.version ?? ''}`.trim() }, { label: 'Event / scenario', value: input.model.eventDescription ?? 'not stated' }, { label: 'Imported', value: now.toISOString() }], disclaimer: DISCLAIMER,
  }
  return { result, layers: { kind: 'polygons', features: fc }, field, name: input.name }
}

/** Rebuild the DepthField from a stored scenario. */
export function fieldFromStored(area: AreaGeometry, layers: ScenarioLayers, depthM?: number): DepthField {
  const bbox = bboxOfArea(area)
  if (layers.kind === 'uniform') return new UniformField(area, layers.depthM ?? depthM ?? 0, bbox)
  if (layers.kind === 'polygons') return new PolygonField(layers.features, area, bbox)
  return gridFieldFromPacked(layers.grid)
}
import { unpackGrid } from './field'
function gridFieldFromPacked(p: Parameters<typeof unpackGrid>[0]): DepthField {
  const { spec, depth } = unpackGrid(p)
  return new GridField(spec, depth)
}
void areaOfKm2
