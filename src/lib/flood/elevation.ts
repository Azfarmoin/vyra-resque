// Terrain (elevation) providers. A provider returns a regular grid of ground heights for the requested bounding box, or throws a
// ProviderError that says exactly why it could not. It never returns a partly filled grid presented as complete.
import { cellCenter, M_PER_DEG_LAT, mPerDegLng, type GridSpec } from './geo'
import { FloodError, type BBox } from './types'
import type { FloodConfig } from './config'

export class ProviderError extends FloodError {
  constructor(code: string, message: string, hint?: string, status = 502) {
    super(code, status, message, hint)
    this.name = 'ProviderError'
  }
}

export interface ElevationMeta {
  id: 'geotiff' | 'open_meteo' | 'test'
  name: string
  kind: 'dtm' | 'dsm' | 'dem' | 'unknown'
  nativeResolutionM: number | null
  verticalErrorM: number | null
  verticalDatum: string | null
  vintage: string | null
  synthetic: boolean
  license: string | null
  notes: string[]
}

export interface ElevationGrid {
  spec: GridSpec
  /** Row-major, row 0 = north. NaN = no data. */
  z: Float32Array
  meta: ElevationMeta
}

export interface ElevationProvider {
  describe(): ElevationMeta
  /** true / false when it can tell cheaply; the provider may still fail when asked for the grid. */
  covers(bbox: BBox): Promise<boolean>
  /** The grid cell size this provider can honestly deliver (metres), used to pick the working grid. */
  targetCellM(): number
  maxCells(): number
  fetchGrid(spec: GridSpec): Promise<ElevationGrid>
}

const PLAUSIBLE_MIN = -500
const PLAUSIBLE_MAX = 9000
const clean = (v: number, nodata: number | null) => (!Number.isFinite(v) || (nodata != null && v === nodata) || v < PLAUSIBLE_MIN || v > PLAUSIBLE_MAX ? NaN : v)

// ---- local GeoTIFF ---------------------------------------------------------------------------------------------------

interface SidecarMeta { name?: string; kind?: string; vintage?: string; verticalErrorM?: number; datum?: string; synthetic?: boolean; license?: string; notes?: string[] }

async function readSidecar(path: string): Promise<SidecarMeta> {
  try {
    const { readFile } = await import('node:fs/promises')
    return JSON.parse(await readFile(`${path}.meta.json`, 'utf8')) as SidecarMeta
  } catch {
    return {}
  }
}

type TiffImage = {
  getWidth(): number
  getHeight(): number
  getBoundingBox(): number[]
  getResolution(): number[]
  getGeoKeys(): Record<string, unknown> | null
  getGDALNoData(): number | null
  readRasters(o: Record<string, unknown>): Promise<ArrayLike<number>[]>
}

export class GeoTiffElevationProvider implements ElevationProvider {
  private image: Promise<TiffImage> | null = null
  private metaCache: ElevationMeta | null = null
  constructor(private path: string, private cfg: Pick<FloodConfig, 'demName' | 'demKind' | 'demVintage' | 'demVerticalErrorM' | 'demDatum' | 'maxCells'>) {}

  private open(): Promise<TiffImage> {
    if (!this.image) {
      this.image = (async () => {
        let image: TiffImage
        try {
          const { fromFile } = await import('geotiff')
          const tiff = await fromFile(this.path)
          image = (await tiff.getImage()) as unknown as TiffImage
        } catch (e) {
          throw new ProviderError('dem_unreadable', `The elevation file could not be read (${(e as Error).message.slice(0, 120)}).`, 'Check FLOOD_DEM_PATH points to a valid GeoTIFF.', 503)
        }
        const keys = image.getGeoKeys() || {}
        const hasProjected = keys.ProjectedCSTypeGeoKey != null && keys.ProjectedCSTypeGeoKey !== 32767
        if (hasProjected || (keys.GeographicTypeGeoKey != null && keys.GeographicTypeGeoKey !== 4326)) {
          throw new ProviderError('dem_unsupported_crs', 'The elevation file is not in geographic WGS 84 (EPSG:4326).', 'Reproject it first, for example: gdalwarp -t_srs EPSG:4326 in.tif out.tif', 503)
        }
        return image
      })()
      this.image.catch(() => { this.image = null }) // do not cache a failure: the file may be fixed while the server runs
    }
    return this.image
  }

  describe(): ElevationMeta {
    if (this.metaCache) return this.metaCache
    return { id: 'geotiff', name: this.cfg.demName || 'Local elevation file', kind: this.cfg.demKind, nativeResolutionM: null, verticalErrorM: this.cfg.demVerticalErrorM, verticalDatum: this.cfg.demDatum, vintage: this.cfg.demVintage, synthetic: false, license: null, notes: [] }
  }

  private async loadMeta(image: TiffImage): Promise<ElevationMeta> {
    if (this.metaCache) return this.metaCache
    const side = await readSidecar(this.path)
    const [rx, ry] = image.getResolution()
    const bb = image.getBoundingBox()
    const lat = (bb[1] + bb[3]) / 2
    const nativeM = (Math.abs(rx) * mPerDegLng(lat) + Math.abs(ry) * M_PER_DEG_LAT) / 2
    const kind = (this.cfg.demKind !== 'unknown' ? this.cfg.demKind : (['dtm', 'dsm', 'dem'].includes(side.kind || '') ? side.kind : 'unknown')) as ElevationMeta['kind']
    this.metaCache = {
      id: 'geotiff',
      name: this.cfg.demName || side.name || 'Local elevation file',
      kind,
      nativeResolutionM: Math.round(nativeM * 10) / 10,
      verticalErrorM: this.cfg.demVerticalErrorM ?? side.verticalErrorM ?? null,
      verticalDatum: this.cfg.demDatum || side.datum || null,
      vintage: this.cfg.demVintage || side.vintage || null,
      synthetic: side.synthetic === true,
      license: side.license || null,
      notes: side.notes ?? [],
    }
    return this.metaCache
  }

  async covers(bbox: BBox): Promise<boolean> {
    try {
      const bb = (await this.open()).getBoundingBox()
      return bbox[0] >= bb[0] && bbox[2] <= bb[2] && bbox[1] >= bb[1] && bbox[3] <= bb[3]
    } catch {
      return false
    }
  }

  targetCellM(): number {
    return this.metaCache?.nativeResolutionM ?? 30
  }
  maxCells(): number {
    return this.cfg.maxCells
  }

  async prepare(): Promise<ElevationMeta> {
    return this.loadMeta(await this.open())
  }

  async fetchGrid(spec: GridSpec): Promise<ElevationGrid> {
    const image = await this.open()
    const meta = await this.loadMeta(image)
    const bb = image.getBoundingBox()
    const [w, s, e, n] = spec.bbox
    if (w < bb[0] - 1e-9 || e > bb[2] + 1e-9 || s < bb[1] - 1e-9 || n > bb[3] + 1e-9) {
      throw new ProviderError('dem_coverage', `The elevation file covers ${bb[0].toFixed(3)} to ${bb[2].toFixed(3)} E, ${bb[1].toFixed(3)} to ${bb[3].toFixed(3)} N and does not fully contain the selected area.`, 'Choose an area inside the file, or supply a DEM that covers it.', 422)
    }
    const [rx, ry] = image.getResolution()
    const x0 = Math.max(0, Math.floor((w - bb[0]) / Math.abs(rx)))
    const x1 = Math.min(image.getWidth(), Math.ceil((e - bb[0]) / Math.abs(rx)))
    const y0 = Math.max(0, Math.floor((bb[3] - n) / Math.abs(ry)))
    const y1 = Math.min(image.getHeight(), Math.ceil((bb[3] - s) / Math.abs(ry)))
    if (x1 <= x0 || y1 <= y0) throw new ProviderError('dem_coverage', 'The selected area does not overlap the elevation file.', undefined, 422)
    const downsample = x1 - x0 > spec.nx || y1 - y0 > spec.ny
    let raster: ArrayLike<number>
    try {
      const out = await image.readRasters({ window: [x0, y0, x1, y1], width: spec.nx, height: spec.ny, samples: [0], resampleMethod: downsample ? 'bilinear' : 'nearest' })
      raster = out[0]
    } catch (err) {
      throw new ProviderError('dem_unreadable', `The elevation file could not be read for this area (${(err as Error).message.slice(0, 120)}).`, undefined, 503)
    }
    const nodata = image.getGDALNoData()
    const z = new Float32Array(spec.nx * spec.ny)
    for (let i = 0; i < z.length; i++) z[i] = clean(raster[i], nodata)
    return { spec, z, meta }
  }
}

// ---- Open-Meteo elevation API (Copernicus GLO-90) --------------------------------------------------------------------

type FetchLike = (input: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

export class OpenMeteoElevationProvider implements ElevationProvider {
  static readonly BATCH = 100
  static readonly MAX_POINTS = 2500
  constructor(private cfg: Pick<FloodConfig, 'openMeteoElevationUrl' | 'providerTimeoutMs'>, private fetchImpl: FetchLike = fetch as unknown as FetchLike) {}

  describe(): ElevationMeta {
    return {
      id: 'open_meteo',
      name: 'Open-Meteo elevation API (Copernicus DEM, 90 m)',
      kind: 'dsm',
      nativeResolutionM: 90,
      // Published absolute vertical accuracy specification for the Copernicus DEM; real error is larger on built-up ground.
      verticalErrorM: 4,
      verticalDatum: 'geoid-referenced (see the Copernicus DEM product documentation)',
      vintage: null,
      synthetic: false,
      license: 'Open-Meteo free API: non-commercial use only; Copernicus DEM licence applies',
      notes: ['Surface model including buildings and trees, not bare earth.', 'Coordinates of the area are sent to api.open-meteo.com.'],
    }
  }
  async covers(): Promise<boolean> {
    return true // global coverage
  }
  targetCellM(): number {
    return 90
  }
  maxCells(): number {
    return OpenMeteoElevationProvider.MAX_POINTS
  }

  private async fetchBatch(lats: number[], lngs: number[]): Promise<number[]> {
    const url = `${this.cfg.openMeteoElevationUrl}?latitude=${lats.map((v) => v.toFixed(5)).join(',')}&longitude=${lngs.map((v) => v.toFixed(5)).join(',')}`
    let lastErr = 'unknown error'
    for (let attempt = 0; attempt < 2; attempt++) {
      const ctl = new AbortController()
      const timer = setTimeout(() => ctl.abort(), this.cfg.providerTimeoutMs)
      try {
        const res = await this.fetchImpl(url, { signal: ctl.signal })
        if (res.status === 429 || res.status >= 500) { lastErr = `HTTP ${res.status}`; continue }
        if (!res.ok) throw new ProviderError('elevation_provider_failed', `The elevation service refused the request (HTTP ${res.status}).`, 'Try again later, or configure a local DEM (FLOOD_DEM_PATH).')
        const body = (await res.json()) as { elevation?: unknown }
        const el = body?.elevation
        if (!Array.isArray(el) || el.length !== lats.length) throw new ProviderError('elevation_provider_failed', 'The elevation service returned an unexpected answer.', 'Try again later, or configure a local DEM (FLOOD_DEM_PATH).')
        return el.map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN))
      } catch (e) {
        if (e instanceof ProviderError) throw e
        lastErr = (e as Error).name === 'AbortError' ? 'timed out' : (e as Error).message
      } finally {
        clearTimeout(timer)
      }
    }
    throw new ProviderError('elevation_provider_failed', `The elevation service could not be reached (${lastErr}).`, 'Try again later, use the hypothetical overlay, or configure a local DEM (FLOOD_DEM_PATH).')
  }

  async fetchGrid(spec: GridSpec): Promise<ElevationGrid> {
    const total = spec.nx * spec.ny
    if (total > OpenMeteoElevationProvider.MAX_POINTS) throw new ProviderError('elevation_too_many_points', `The elevation service can supply at most ${OpenMeteoElevationProvider.MAX_POINTS} points per scenario.`, undefined, 422)
    const lats: number[] = new Array(total)
    const lngs: number[] = new Array(total)
    for (let r = 0; r < spec.ny; r++) for (let c = 0; c < spec.nx; c++) { const [la, ln] = cellCenter(spec, c, r); lats[r * spec.nx + c] = la; lngs[r * spec.nx + c] = ln }
    const batches: [number, number][] = []
    for (let i = 0; i < total; i += OpenMeteoElevationProvider.BATCH) batches.push([i, Math.min(total, i + OpenMeteoElevationProvider.BATCH)])
    const z = new Float32Array(total)
    // Three requests at a time: polite to a free service and fast enough (25 requests at most).
    for (let b = 0; b < batches.length; b += 3) {
      const group = batches.slice(b, b + 3)
      const results = await Promise.all(group.map(([a, e]) => this.fetchBatch(lats.slice(a, e), lngs.slice(a, e))))
      group.forEach(([a], k) => results[k].forEach((v, j) => { z[a + j] = clean(v, null) }))
    }
    return { spec, z, meta: this.describe() }
  }
}

/** Test and tooling helper: serves a grid built in memory (clearly labelled synthetic wherever it is used). */
export class StaticElevationProvider implements ElevationProvider {
  constructor(private builder: (spec: GridSpec) => Float32Array, private meta: Partial<ElevationMeta> = {}, private cell = 30) {}
  describe(): ElevationMeta {
    return { id: 'test', name: 'In-memory test terrain', kind: 'dem', nativeResolutionM: this.cell, verticalErrorM: 1, verticalDatum: null, vintage: null, synthetic: true, license: null, notes: [], ...this.meta }
  }
  async covers() { return true }
  targetCellM() { return this.cell }
  maxCells() { return 160_000 }
  async fetchGrid(spec: GridSpec): Promise<ElevationGrid> { return { spec, z: this.builder(spec), meta: this.describe() } }
}

export type ElevationChoice = 'auto' | 'geotiff' | 'open_meteo'

/** Picks a provider for the area, or throws a 503 that says how to configure one. */
export async function chooseElevationProvider(cfg: FloodConfig, bbox: BBox, choice: ElevationChoice, injected?: { geotiff?: ElevationProvider | null; openMeteo?: ElevationProvider | null }): Promise<ElevationProvider> {
  const geotiff = injected && 'geotiff' in injected ? injected.geotiff ?? null : cfg.demPath ? new GeoTiffElevationProvider(cfg.demPath, cfg) : null
  const openMeteo = injected && 'openMeteo' in injected ? injected.openMeteo ?? null : cfg.openMeteoEnabled ? new OpenMeteoElevationProvider(cfg) : null
  const prep = async (p: ElevationProvider) => { if (p instanceof GeoTiffElevationProvider) await p.prepare(); return p }
  if (choice === 'geotiff') {
    if (!geotiff) throw new ProviderError('elevation_not_configured', 'No local elevation file is configured.', 'Set FLOOD_DEM_PATH to a GeoTIFF that covers Karachi. See FLOOD_SIMULATOR.md.', 503)
    return prep(geotiff)
  }
  if (choice === 'open_meteo') {
    if (!openMeteo) throw new ProviderError('elevation_not_configured', 'The Open-Meteo elevation service is not enabled.', 'Set FLOOD_OPEN_METEO_ENABLED=true (non-commercial use only) or configure FLOOD_DEM_PATH.', 503)
    return openMeteo
  }
  if (geotiff) {
    const p = await prep(geotiff)
    if (await p.covers(bbox)) return p
    if (!openMeteo) throw new ProviderError('dem_coverage', 'The configured elevation file does not cover the selected area.', 'Choose an area inside the file, or supply a DEM that covers it.', 422)
  }
  if (openMeteo) return openMeteo
  throw new ProviderError('elevation_not_configured', 'No elevation data is configured, so a terrain-based estimate cannot be made.', 'Configure FLOOD_DEM_PATH (a GeoTIFF DEM) or enable FLOOD_OPEN_METEO_ENABLED=true. The hypothetical overlay does not need terrain.', 503)
}
