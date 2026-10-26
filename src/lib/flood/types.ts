// Flood-Depth and Impact Simulator: shared types. Pure TypeScript (no React / Next / Supabase imports) so the same code runs
// in the API routes, the browser and the tests.
//
// DESIGN RULES that run through every file in this folder
//  1. Everything produced here is an ESTIMATE. Results carry `isEstimate: true` and `isSimulation: true` and are never
//     written to the incident tables.
//  2. The model tier is explicit and never upgraded silently:
//       hypothetical_overlay  - a typed-in depth, no terrain used          -> illustrative only, no depth bands
//       terrain_estimate      - DEM based "bathtub" / ponding              -> screening estimate, depth bands indicative
//       imported_unvalidated  - external hydraulic output, no evidence     -> shown, but NOT called validated
//       validated_hydraulic   - external hydraulic output WITH validation  -> only when complete evidence is on record
//  3. "No data" is never turned into "zero". A dataset that is missing, stale, failed or truncated is reported as such and the
//     matching count is null (unknown), not 0.
import type { Position, ZoneGeometry } from '../zones/types'

export const MODEL_VERSION = 'vyra-flood-engine/1.0'

export type LatLng = [number, number] // [lat, lng] (same order as the rest of VYRA)
export type BBox = [number, number, number, number] // [minLng, minLat, maxLng, maxLat]
export type AreaGeometry = Extract<ZoneGeometry, { type: 'Polygon' | 'MultiPolygon' }>
export type { Position }

export const SCENARIO_KINDS = ['hypothetical_overlay', 'terrain_bathtub', 'terrain_rainfall', 'imported_hydraulic'] as const
export type ScenarioKind = (typeof SCENARIO_KINDS)[number]

export type TierId = 'hypothetical_overlay' | 'terrain_estimate' | 'imported_unvalidated' | 'validated_hydraulic'
export interface Tier {
  id: TierId
  title: string
  summary: string
  /** Whether depth bands are meaningful for this tier. */
  depthBands: 'not_supported' | 'indicative' | 'model_output' | 'validated'
}

export const TIERS: Record<TierId, Tier> = {
  hypothetical_overlay: {
    id: 'hypothetical_overlay',
    title: 'Hypothetical water-level overlay',
    summary: 'A single water depth typed in by a person and applied evenly to the selected area. No terrain, rainfall or hydrology is used. It shows what would be affected IF this depth occurred; it does not predict that it will.',
    depthBands: 'not_supported',
  },
  terrain_estimate: {
    id: 'terrain_estimate',
    title: 'Terrain-based inundation estimate (screening)',
    summary: 'A simple calculation on a digital elevation model: ground height compared with a water level (or with a ponded rainfall volume). It is not a hydraulic simulation: there is no flow routing, drainage network, structures or time dimension. Use it to screen, never to state a depth at a location.',
    depthBands: 'indicative',
  },
  imported_unvalidated: {
    id: 'imported_unvalidated',
    title: 'Imported hydraulic model output (validation evidence missing)',
    summary: 'Depths produced by an external hydraulic model and imported into VYRA. VYRA did not run or check the model, and no complete validation record is on file, so this is NOT presented as a validated simulation.',
    depthBands: 'model_output',
  },
  validated_hydraulic: {
    id: 'validated_hydraulic',
    title: 'Validated hydraulic simulation (imported)',
    summary: 'Depths produced by an external hydraulic model, imported by an administrator together with a validation record (method, metric, who validated it and when). VYRA did not run the model; the validation claim is the importer\'s and should be checked against the cited report.',
    depthBands: 'validated',
  },
}

export interface DepthBand {
  id: string
  min: number // metres, inclusive
  max: number | null // metres, exclusive; null = no upper limit
  label: string
  color: string
}

// Colour is sequential light-to-dark blue; labels carry the meaning, so colour is never the only cue.
export const DEPTH_BANDS: DepthBand[] = [
  { id: 'b1', min: 0.1, max: 0.3, label: '0.1 to 0.3 m', color: '#c6e4f5' },
  { id: 'b2', min: 0.3, max: 0.5, label: '0.3 to 0.5 m', color: '#8fc6e8' },
  { id: 'b3', min: 0.5, max: 1.0, label: '0.5 to 1.0 m', color: '#4f9fd6' },
  { id: 'b4', min: 1.0, max: 2.0, label: '1.0 to 2.0 m', color: '#2268b0' },
  { id: 'b5', min: 2.0, max: null, label: 'Over 2.0 m', color: '#12306e' },
]

export const bandIndexFor = (depthM: number, bands: DepthBand[] = DEPTH_BANDS): number => {
  for (let i = bands.length - 1; i >= 0; i--) if (depthM >= bands[i].min) return i
  return -1
}

// ---- datasets and data quality ---------------------------------------------------------------------------------------

export type DatasetState = 'ok' | 'empty' | 'not_configured' | 'failed' | 'stale' | 'truncated' | 'synthetic' | 'partial'
export type QualityLevel = 'good' | 'fair' | 'poor' | 'missing'

export interface DatasetStatus {
  id: string
  label: string
  group: 'terrain' | 'rainfall' | 'assets' | 'context'
  state: DatasetState
  level: QualityLevel
  source: string | null
  asOf: string | null
  ageDays: number | null
  resolutionM: number | null
  count: number | null
  notes: string[]
  error?: string
}

export interface Loaded<T> {
  status: DatasetStatus
  data: T | null
}

// ---- assets ----------------------------------------------------------------------------------------------------------

export interface PointAsset {
  id: string
  name: string
  lat: number
  lng: number
  meta?: Record<string, string | number | boolean | null>
}
export interface RoadAsset {
  id: string
  name: string
  roadClass: string | null
  source: string
  path: LatLng[]
}
export interface BuildingAsset {
  id: string
  name: string | null
  lat: number
  lng: number
  /** Footprint ring as [lat, lng] when the source provides one. */
  ring?: LatLng[]
}
export interface TeamAsset extends PointAsset {
  teamType: string | null
  status: string
}
export interface ResourceAsset {
  id: string
  resourceType: string
  quantity: number
  teamId: string | null
  status: string
}
export interface IncidentPoint {
  id: string
  lat: number
  lng: number
  priority: string
  status: string
}

// ---- exposure --------------------------------------------------------------------------------------------------------

export interface PointExposureItem {
  id: string
  name: string
  lat: number
  lng: number
  depthM: number | null // null = outside the assessed area / no data
  flooded: boolean
  band: string | null
  meta?: Record<string, string | number | boolean | null>
}
export interface PointExposure {
  /** false = the dataset is missing or failed: counts are null, never 0. */
  available: boolean
  reason?: string
  total: number | null
  affected: number | null
  unassessed: number
  truncated: boolean
  items: PointExposureItem[]
}
export interface RoadExposureItem {
  id: string
  name: string
  roadClass: string | null
  source: string
  lengthM: number
  floodedLengthM: number
  maxDepthM: number
  bandLengthsM: Record<string, number>
  path: LatLng[] // simplified, for drawing
}
export interface RoadExposure {
  available: boolean
  reason?: string
  totalCount: number | null
  affectedCount: number | null
  totalLengthKm: number | null
  floodedLengthKm: number | null
  bandLengthsKm: Record<string, number>
  truncated: boolean
  items: RoadExposureItem[]
}
export interface BuildingExposure {
  available: boolean
  reason?: string
  total: number | null
  affected: number | null
  byBand: Record<string, number>
  truncated: boolean
  items: PointExposureItem[]
}
export interface ResourceExposure {
  available: boolean
  reason?: string
  teamsTotal: number | null
  teamsInExtent: number | null
  teams: PointExposureItem[]
  /** Supplies are positioned by the team that holds them: this is an inference, not a surveyed location. */
  resourcesByType: Record<string, { quantityTotal: number; quantityInExtent: number }>
  note: string
}
export interface IncidentContext {
  available: boolean
  reason?: string
  openInExtent: number | null
  byPriority: Record<string, number>
  ids: string[]
  note: string
}

export interface ObservationRecord {
  id: string
  lat: number
  lng: number
  depthM: number
  observedAt: string
  source: string
  sourceUrl?: string | null
  method?: string | null
  notes?: string | null
  verified: boolean
  recordedByName?: string | null
}
export interface ObservationComparison {
  windowFrom: string
  windowTo: string
  n: number
  usable: number
  meanErrorM: number | null // estimate minus observation (positive = estimate deeper than observed)
  maeM: number | null
  rmseM: number | null
  rows: { id: string; observedM: number; estimatedM: number | null; errorM: number | null }[]
  note: string
}

// ---- results ---------------------------------------------------------------------------------------------------------

export interface ScenarioSummary {
  areaKm2: number
  assessedAreaKm2: number
  floodedAreaKm2: number
  floodedFractionOfAssessed: number
  maxDepthM: number | null
  meanDepthM: number | null // over flooded cells only
  volumeM3: number | null
  bandAreasKm2: Record<string, number>
  cellSizeM: number | null
  cells: number | null
  unassessedFraction: number // share of the area with no terrain data
}

export interface ProvenanceNote {
  label: string
  value: string
}

export interface ScenarioResult {
  isEstimate: true
  isSimulation: true
  banner: string
  modelVersion: string
  computedAt: string
  kind: ScenarioKind
  tier: Tier
  area: { geometry: AreaGeometry; areaKm2: number; bbox: BBox; label: string; basis: string }
  inputs: unknown
  summary: ScenarioSummary
  exposure: {
    shelters: PointExposure
    hospitals: PointExposure
    roads: RoadExposure
    blockedRoadRegister: RoadExposure
    buildings: BuildingExposure
    resources: ResourceExposure
    incidents: IncidentContext
  }
  observations: { available: boolean; inArea: ObservationRecord[]; comparison: ObservationComparison | null }
  drainage: { available: boolean; featureCount: number | null; lengthKm: number | null; note: string }
  dataQuality: { reliability: 'illustrative' | 'screening' | 'model_output' | 'validated'; datasets: DatasetStatus[]; headline: string }
  assumptions: string[]
  limitations: string[]
  warnings: string[]
  provenance: ProvenanceNote[]
  disclaimer: string
}

export const DISCLAIMER =
  'ESTIMATE ONLY. This is a simulation produced by VYRA for planning and discussion. It is not a flood forecast, warning or official hazard map, it does not describe a real event, and it must not be used to decide that any place is safe. Follow instructions from the authorities and contact emergency services in an emergency.'

export const ESTIMATE_BANNER = 'ESTIMATE - simulation, not a real event'

/** Layers stored next to a scenario for drawing (kept out of `results` so listing scenarios stays light). */
export type ScenarioLayers =
  | { kind: 'uniform'; depthM: number }
  | { kind: 'grid'; grid: PackedGrid }
  | { kind: 'polygons'; features: DepthFeatureCollection }

export interface PackedGrid {
  bbox: BBox
  nx: number
  ny: number
  cellWM: number
  cellHM: number
  encoding: 'u16-cm+deflate+base64'
  /** 0..65534 = depth in centimetres, 65535 = not assessed (outside the area or no terrain data). Row 0 is the north row. */
  data: string
}

export interface DepthFeatureCollection {
  type: 'FeatureCollection'
  features: { type: 'Feature'; properties: { depth_m: number }; geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown } }[]
}

export class FloodError extends Error {
  constructor(public code: string, public status: number, message: string, public hint?: string) {
    super(message)
    this.name = 'FloodError'
  }
}
