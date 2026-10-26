// Shared helpers for the satellite tests. The rasters built here are SYNTHETIC TEST FIXTURES used only to check the maths and
// the plumbing; they are not presented as imagery anywhere.
import { NextRequest } from 'next/server'
import { writeArrayBuffer } from 'geotiff'
import { setStore } from '../src/lib/db'
import { createMemoryStore } from '../src/lib/db/memoryStore'
import { setSatelliteProviders } from '../src/lib/satellite/providers/registry'
import { _satMemory, setSatelliteRepo } from '../src/lib/satellite/repo'
import { resetRateLimits } from '../src/lib/routing/rateLimit'
import { setRoutingDeps } from '../src/lib/routing/deps'
import { FLAG, type SceneMeta } from '../src/lib/satellite/types'
import type { ImageryProvider, ProviderStatus } from '../src/lib/satellite/providers/types'
import type { LoadedScene } from '../src/lib/satellite/analysis/engine'
import type { Grid } from '../src/lib/satellite/raster/grid'

export const RESPONDER = 'dispatcher@demo.vyra', ADMIN = 'admin@demo.vyra', CITIZEN = 'citizen@demo.vyra'
export const NOW = Date.parse('2026-10-25T12:00:00Z')
export const AOI = { type: 'bbox', bbox: [67.0, 24.8, 67.04, 24.84] }

export function reset() {
  setStore(createMemoryStore())
  setSatelliteRepo(null)
  _satMemory.reset()
  resetRateLimits()
  setRoutingDeps(null)
  setSatelliteProviders(null)
}

export const call = (path: string, o: { method?: string; body?: unknown; as?: string; raw?: BodyInit; headers?: Record<string, string> } = {}) =>
  new NextRequest(`http://localhost${path}`, { method: o.method || 'GET', body: o.raw ?? (o.body ? JSON.stringify(o.body) : undefined), headers: { ...(o.raw ? {} : { 'content-type': 'application/json' }), ...(o.as ? { 'x-demo-user': o.as } : {}), ...(o.headers || {}) } })
export const ctx = (id: string, kind?: string) => ({ params: { id, kind: kind as string } })

export const scene = (over: Partial<SceneMeta> = {}): SceneMeta => ({
  id: 'S-1', provider: 'planetary-computer', collection: 'sentinel-2-l2a', kind: 'optical', platform: 'Sentinel-2A', acquiredAt: '2026-09-01T05:30:00.000Z', resolutionM: 10, cloudCover: 5,
  footprintBbox: [66.9, 24.7, 67.2, 25.0], license: 'Free and open', attribution: 'Test', original: { stac: 'fixture' }, ...over,
})

/** A scripted provider: no network. `fields` decide the pixel values, so tests can check exact outcomes. */
export function fakeProvider(opts: { scenes?: SceneMeta[]; state?: ProviderStatus['state']; missing?: string[]; load?: (s: SceneMeta, g: Grid) => LoadedScene | Promise<LoadedScene>; searchError?: Error; getSceneError?: Error } = {}): ImageryProvider & { loads: string[] } {
  const loads: string[] = []
  const scenes = opts.scenes ?? [scene({ id: 'B-1', acquiredAt: '2026-08-10T05:30:00.000Z' }), scene({ id: 'A-1', acquiredAt: '2026-09-20T05:30:00.000Z' })]
  return {
    id: 'planetary-computer', loads,
    status: () => ({ id: 'planetary-computer', name: 'Fake', description: '', state: opts.state ?? 'ready', missing: opts.missing ?? [], message: opts.state === 'missing_credentials' ? 'missing' : 'ok', collections: ['sentinel-2-l2a', 'sentinel-1'], license: 'x', attribution: 'x' }),
    async search(req) { if (opts.searchError) throw opts.searchError; const lo = Date.parse(`${req.start}T00:00:00Z`), hi = Date.parse(`${req.end}T23:59:59Z`); return { scenes: scenes.filter((s) => Date.parse(s.acquiredAt) >= lo && Date.parse(s.acquiredAt) <= hi), skipped: 0, notes: [] } },
    async getScene(_c, id) { if (opts.getSceneError) throw opts.getSceneError; const s = scenes.find((x) => x.id === id); if (!s) throw Object.assign(new Error('nope'), {}); return { ...s, access: { secret: 'internal-href' } } },
    async load(s, g) { loads.push(s.id); return opts.load ? opts.load(s, g) : floodPair(s, g) },
  }
}

/** Optical fixture: a square lake exists "after" but not "before" (new water), plus a cloud patch after. */
export function floodPair(s: SceneMeta, g: Grid): LoadedScene {
  const n = g.width * g.height, role = s.access?.role as string | undefined
  const mk = () => new Float32Array(n), b = { blue: mk(), green: mk(), red: mk(), nir: mk(), swir: mk() }, flags = new Uint8Array(n)
  for (let r = 0; r < g.height; r++) for (let c = 0; c < g.width; c++) {
    const i = r * g.width + c, u = c / g.width, v = r / g.height
    const lake = role === 'after' && u > 0.3 && u < 0.6 && v > 0.3 && v < 0.6
    const cloud = role === 'after' && u < 0.15 && v < 0.15
    const noise = ((i * 2654435761) % 1000) / 1000 * 0.02
    if (lake) Object.assign({}, 0), (b.blue[i] = 0.07, b.green[i] = 0.08 + noise, b.red[i] = 0.05, b.nir[i] = 0.03 + noise, b.swir[i] = 0.02)
    else (b.blue[i] = 0.05, b.green[i] = 0.1 + noise, b.red[i] = 0.09, b.nir[i] = 0.36 + noise, b.swir[i] = 0.22)
    if (cloud) { flags[i] |= FLAG.CLOUD; b.green[i] = b.nir[i] = b.swir[i] = b.red[i] = 0.7 }
  }
  return { bands: b, flags, maskAvailable: true }
}

export function analysisBody(over: Record<string, unknown> = {}) {
  return { provider: 'planetary-computer', collection: 'sentinel-2-l2a', aoi: AOI, beforeRange: { start: '2026-08-01', end: '2026-08-20' }, afterRange: { start: '2026-09-10', end: '2026-09-30' }, beforeSceneId: 'B-1', afterSceneId: 'A-1', ...over }
}

/** Builds a real GeoTIFF in memory (WGS84, north-up) so the actual read path is exercised. */
export async function makeTiff(bbox: [number, number, number, number], w: number, h: number, bands: Float32Array[] | Uint16Array[], opts: { epsg?: number; nodata?: number } = {}): Promise<ArrayBuffer> {
  const interleaved = new (bands[0].constructor as new (n: number) => Float32Array)(w * h * bands.length)
  for (let i = 0; i < w * h; i++) for (let b = 0; b < bands.length; b++) interleaved[i * bands.length + b] = bands[b][i]
  const meta: Record<string, unknown> = {
    height: h, width: w, SamplesPerPixel: bands.length, PlanarConfiguration: 1, BitsPerSample: new Array(bands.length).fill(bands[0] instanceof Float32Array ? 32 : 16), SampleFormat: new Array(bands.length).fill(bands[0] instanceof Float32Array ? 3 : 1),
    ModelPixelScale: [(bbox[2] - bbox[0]) / w, (bbox[3] - bbox[1]) / h, 0], ModelTiepoint: [0, 0, 0, bbox[0], bbox[3], 0],
    GeographicTypeGeoKey: opts.epsg ?? 4326, GTModelTypeGeoKey: 2, GTRasterTypeGeoKey: 1,
  }
  if (opts.nodata !== undefined) meta.GDAL_NODATA = String(opts.nodata)
  return writeArrayBuffer(interleaved as never, meta as never) as ArrayBuffer
}
