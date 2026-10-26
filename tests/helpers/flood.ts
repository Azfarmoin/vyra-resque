// Shared fixtures for the flood tests. ALL terrain here is SYNTHETIC and exists only to exercise the code.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { encodeGeoTiffF32 } from '../../src/lib/flood/devtools/geotiffWriter'
import { floodConfig, type FloodConfig } from '../../src/lib/flood/config'
import { StaticElevationProvider } from '../../src/lib/flood/elevation'
import { failedLoad, status, type AssetProviders } from '../../src/lib/flood/assets'
import type { FloodDeps } from '../../src/lib/flood/scenario'
import type { BBox, BuildingAsset, Loaded, PointAsset, RoadAsset, TeamAsset } from '../../src/lib/flood/types'

/** A valley: ground rises from 0 m (south-west) up to ~10 m (north-east), with a closed pit at (pitLng, pitLat). */
export const valley = (spec: { bbox: BBox; nx: number; ny: number }, pit?: { lat: number; lng: number; depth: number; radiusDeg: number }) => {
  const z = new Float32Array(spec.nx * spec.ny)
  const [w, s, e, n] = spec.bbox
  for (let r = 0; r < spec.ny; r++) for (let c = 0; c < spec.nx; c++) {
    const lng = w + ((c + 0.5) / spec.nx) * (e - w)
    const lat = n - ((r + 0.5) / spec.ny) * (n - s)
    let h = ((lng - w) / (e - w)) * 5 + ((lat - s) / (n - s)) * 5
    if (pit && Math.hypot(lng - pit.lng, lat - pit.lat) < pit.radiusDeg) h -= pit.depth
    z[r * spec.nx + c] = h
  }
  return z
}

export const cfg = (over: Partial<FloodConfig> = {}): FloodConfig => ({ ...floodConfig({}), ...over })

export const okLoaded = <T,>(id: string, label: string, data: T[], group: 'assets' | 'context' = 'assets'): Loaded<T[]> => ({ data, status: status({ id, label, group, count: data.length, state: data.length ? 'ok' : 'empty' }) })

export interface FakeAssets {
  shelters?: PointAsset[]; hospitals?: PointAsset[]; roads?: RoadAsset[]; blocked?: RoadAsset[]; buildings?: BuildingAsset[]; teams?: TeamAsset[]
  failing?: string[]
}
export function fakeProviders(a: FakeAssets = {}): AssetProviders {
  const f = a.failing ?? []
  const pick = <T,>(id: string, label: string, data: T[] | undefined, group: 'assets' | 'context' = 'assets'): Promise<Loaded<T[]>> =>
    Promise.resolve(f.includes(id) ? failedLoad<T[]>(id, label, group, new Error('simulated provider failure')) : data ? okLoaded(id, label, data, group) : { data: null, status: status({ id, label, group, state: 'not_configured', level: 'missing' }) })
  return {
    shelters: () => pick('shelters', 'Shelters', a.shelters),
    hospitals: () => pick('hospitals', 'Hospitals', a.hospitals),
    roads: () => pick('roads', 'Road network', a.roads),
    blockedRoads: () => pick('blocked_roads', 'Reported blocked roads', a.blocked),
    buildings: () => pick('buildings', 'Buildings', a.buildings),
    teams: () => pick('teams', 'Rescue teams', a.teams),
    resources: () => pick('resources', 'Supplies', []),
    incidents: () => pick('incidents', 'Incidents', [], 'context'),
    drainage: () => pick('drainage', 'Drainage', undefined, 'context'),
  }
}

export function fakeDeps(over: Omit<Partial<FloodDeps>, 'assets'> & { assets?: FakeAssets } = {}): FloodDeps {
  const { assets, ...rest } = over
  return {
    config: cfg(),
    assets: fakeProviders(assets),
    elevation: { geotiff: new StaticElevationProvider((s) => valley(s)), openMeteo: null },
    rainfall: null,
    observations: async () => [],
    resolveZone: async () => null,
    now: () => new Date('2026-10-25T08:00:00Z'),
    ...rest,
  }
}

/** Writes a synthetic GeoTIFF to a temp dir; returns its path. */
export function writeTestTiff(opts: { west: number; north: number; width: number; height: number; px: number; fill: (c: number, r: number) => number; nodata?: number; synthetic?: boolean }): string {
  const dir = mkdtempSync(join(tmpdir(), 'vyra-dem-'))
  const path = join(dir, 'test.tif')
  const data = new Float32Array(opts.width * opts.height)
  for (let r = 0; r < opts.height; r++) for (let c = 0; c < opts.width; c++) data[r * opts.width + c] = opts.fill(c, r)
  writeFileSync(path, encodeGeoTiffF32({ width: opts.width, height: opts.height, data, west: opts.west, north: opts.north, pixelDegX: opts.px, pixelDegY: opts.px, nodata: opts.nodata }))
  if (opts.synthetic !== false) writeFileSync(`${path}.meta.json`, JSON.stringify({ name: 'SYNTHETIC TEST TERRAIN', synthetic: true, verticalErrorM: 0.5, vintage: '2026', datum: 'test' }))
  return path
}

export const CLIFTON_BOX: BBox = [67.01, 24.80, 67.05, 24.84]
