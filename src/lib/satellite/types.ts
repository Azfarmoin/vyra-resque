// Satellite imagery comparison and change detection: shared types and constants.
// Pure (no React / Next / Supabase imports) so the same rules run in the browser, the API and the tests.

export const REVIEW_STATES = ['needs_review', 'confirmed_by_reviewer', 'not_disaster_related', 'inconclusive'] as const
export type ReviewState = (typeof REVIEW_STATES)[number]
export const REVIEW_LABELS: Record<ReviewState, string> = {
  needs_review: 'Needs Review',
  confirmed_by_reviewer: 'Confirmed by Reviewer',
  not_disaster_related: 'Not Disaster-Related',
  inconclusive: 'Inconclusive',
}

export const PROVIDER_IDS = ['planetary-computer', 'cdse-sentinelhub', 'user-upload', 'demo'] as const
export type ProviderId = (typeof PROVIDER_IDS)[number]

export const COLLECTIONS = ['sentinel-2-l2a', 'sentinel-1', 'landsat-c2-l2', 'user-optical', 'user-sar'] as const
export type CollectionId = (typeof COLLECTIONS)[number]
export type SensorKind = 'optical' | 'sar'
export const COLLECTION_KIND: Record<CollectionId, SensorKind> = { 'sentinel-2-l2a': 'optical', 'sentinel-1': 'sar', 'landsat-c2-l2': 'optical', 'user-optical': 'optical', 'user-sar': 'sar' }
export const COLLECTION_LABELS: Record<CollectionId, string> = {
  'sentinel-2-l2a': 'Sentinel-2 optical (L2A surface reflectance)',
  'sentinel-1': 'Sentinel-1 SAR (radar backscatter)',
  'landsat-c2-l2': 'Landsat 8/9 optical (Collection 2 Level 2)',
  'user-optical': 'Your own optical GeoTIFFs',
  'user-sar': 'Your own radar GeoTIFFs',
}
/** Earliest date each collection can reasonably cover (mission start). */
export const COLLECTION_EARLIEST: Record<CollectionId, string> = { 'sentinel-2-l2a': '2015-06-23', 'sentinel-1': '2014-10-03', 'landsat-c2-l2': '2013-03-18', 'user-optical': '1972-07-23', 'user-sar': '1978-06-27' }

export type Bbox = [number, number, number, number] // minLng, minLat, maxLng, maxLat (WGS84)
export type AoiInput = { type: 'bbox'; bbox: Bbox } | { type: 'Polygon'; coordinates: number[][][] }
export interface DateRange { start: string; end: string } // YYYY-MM-DD, UTC days, inclusive

export type BandName = 'blue' | 'green' | 'red' | 'nir' | 'swir' | 'vv' | 'vh'

/** Bit flags in a per-pixel mask. 0 = usable. */
export const FLAG = { NODATA: 1, CLOUD: 2, SHADOW: 4, CIRRUS: 8, SNOW: 16 } as const

export interface SceneMeta {
  id: string // provider's identifier for the scene
  provider: ProviderId
  collection: CollectionId
  kind: SensorKind
  platform: string // e.g. SENTINEL-2A, landsat-8, or the user's declared platform
  acquiredAt: string // ISO 8601 (UTC)
  resolutionM: number // nominal ground sampling distance of the bands used
  cloudCover: number | null // scene-level percent; null where the sensor has none (SAR) or the provider does not say
  orbitDirection?: 'ascending' | 'descending' | null
  relativeOrbit?: number | null
  polarizations?: string[]
  crs?: string | null
  footprintBbox: Bbox | null
  license: string
  attribution: string
  /** Everything the provider told us, kept as received (size-capped). Never rewritten after saving. */
  original: Record<string, unknown>
  declaredByUser?: boolean // user-supplied imagery: metadata is as declared by the uploader
  synthetic?: boolean // demonstration data
  /** Internal: how the provider can fetch bands (asset links etc.). Removed before saving. */
  access?: Record<string, unknown>
}

export type QualityRating = 'good' | 'fair' | 'poor' | 'unusable'
export interface QualityCheck { code: string; severity: 'info' | 'warning' | 'blocking'; message: string; value?: number | string | null }

// Classification codes of the change grid.
export const CLASS = { MASKED: 0, STABLE_LAND: 1, STABLE_WATER: 2, NEW_WATER: 3, WATER_LOSS: 4, VEG_LOSS: 5, VEG_GAIN: 6, BACKSCATTER_UP: 7 } as const
export const CLASS_LABELS: Record<number, string> = {
  0: 'No usable data (cloud, shadow, no coverage)',
  1: 'Unchanged land',
  2: 'Unchanged water',
  3: 'Possible new surface water',
  4: 'Possible loss of surface water',
  5: 'Possible vegetation loss',
  6: 'Possible vegetation gain',
  7: 'Backscatter increase (ambiguous)',
}
export const CLASS_COLORS: Record<number, string> = { 0: '#8A8A8A', 3: '#0B5FFF', 4: '#E69F00', 5: '#CC3399', 6: '#009E73', 7: '#7B3FBF' }

export const METHODS = ['optical_water_index_v1', 'sar_backscatter_change_v1'] as const
export type MethodId = (typeof METHODS)[number]

export interface OpticalParams { index: 'mndwi' | 'ndwi'; waterThreshold: number; ndviDrop: number; minClusterPixels: number }
export interface SarParams { polarization: 'VV' | 'VH'; waterThresholdDb: number; changeDb: number; speckleWindow: number; minClusterPixels: number }
export const DEFAULT_OPTICAL_PARAMS: OpticalParams = { index: 'mndwi', waterThreshold: 0.0, ndviDrop: 0.25, minClusterPixels: 4 }
export const DEFAULT_SAR_PARAMS: SarParams = { polarization: 'VV', waterThresholdDb: -18, changeDb: 3, speckleWindow: 3, minClusterPixels: 4 }

export interface ClassStat { code: number; label: string; pixels: number; areaKm2: number }
export interface AnalysisStats {
  gridWidth: number; gridHeight: number; cellSizeM: number
  insideAoiPixels: number; validPixels: number; validFraction: number
  maskedFractionBefore: number; maskedFractionAfter: number
  classes: ClassStat[]
  waterAreaBeforeKm2: number | null; waterAreaAfterKm2: number | null
  changedFractionOfValid: number
  correlation: number | null
}

export type AnalysisStatus = 'completed' | 'failed'
export interface AnalysisRecord {
  id: string
  createdAt: string
  createdBy: string
  createdByName: string
  status: AnalysisStatus
  error: string | null
  provider: ProviderId
  collection: CollectionId
  synthetic: boolean // demonstration data: can never be confirmed
  aoi: { bbox: Bbox; polygon: number[][][] | null; areaKm2: number }
  beforeRange: DateRange; afterRange: DateRange
  before: SceneMeta | null; after: SceneMeta | null
  method: MethodId | null
  parameters: OpticalParams | SarParams | null
  quality: { rating: QualityRating; checks: QualityCheck[] } | null
  stats: AnalysisStats | null
  findings: string[] // plain-language summary, always worded as possible change
  limitations: string[]
  processingMs: number | null
  overlayBounds: Bbox | null
  hasImages: boolean
  uploadFingerprints?: { before?: string; after?: string } // sha256 of user-supplied files (the files themselves are not kept)
}

export type ReviewEntry = { id: string; analysisId: string; state: ReviewState; note: string | null; acknowledgedLimitations: boolean; reviewedBy: string; reviewedByName: string; createdAt: string }
export const LINK_TARGETS = ['report', 'hazard', 'zone'] as const
export type LinkTarget = (typeof LINK_TARGETS)[number]
export const LINK_TARGET_LABELS: Record<LinkTarget, string> = { report: 'Incident report', hazard: 'Hazard', zone: 'Zone / flood scenario' }
export type LinkEntry = { id: string; analysisId: string; targetType: LinkTarget; targetId: string; note: string | null; linkedBy: string; linkedByName: string; createdAt: string }

export type AnalysisView = AnalysisRecord & { reviewState: ReviewState; reviews: ReviewEntry[]; links: LinkEntry[] }
export type ImageKind = 'before' | 'after' | 'change'
export const IMAGE_KINDS: readonly ImageKind[] = ['before', 'after', 'change']

export const ADVISORY =
  'Satellite findings are advisory. A detected change is not proof of a disaster or of a current emergency: clouds, shadows, seasons, sensor differences, tides, irrigation and misalignment all produce look-alike changes. Nothing here confirms an incident, closes a road, dispatches a team or changes a triage priority; people decide that.'
