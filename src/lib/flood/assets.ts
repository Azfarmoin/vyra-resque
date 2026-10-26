// Asset loaders. Each returns Loaded<T>: the data (or null) plus an honest DatasetStatus. A loader that fails, is not configured
// or hits its cap says so; the caller then reports "unknown", never "0 affected".
import { readFile, stat } from 'node:fs/promises'
import { bboxesIntersect, isLatLng, padBBox } from './geo'
import { ProviderError } from './elevation'
import type { FloodConfig } from './config'
import type { BBox, BuildingAsset, DatasetStatus, IncidentPoint, LatLng, Loaded, PointAsset, ResourceAsset, RoadAsset, TeamAsset } from './types'

const DAY = 86_400_000
const MAX = { roads: 30_000, buildings: 80_000, hospitals: 2_000, drainage: 20_000 }

export function status(p: Partial<DatasetStatus> & Pick<DatasetStatus, 'id' | 'label' | 'group'>): DatasetStatus {
  return { state: 'ok', level: 'fair', source: null, asOf: null, ageDays: null, resolutionM: null, count: null, notes: [], ...p }
}
const ageDays = (asOf: string | null, now = Date.now()) => (asOf && !Number.isNaN(Date.parse(asOf)) ? Math.max(0, Math.round((now - Date.parse(asOf)) / DAY)) : null)

export interface AssetProviders {
  shelters(bbox: BBox): Promise<Loaded<PointAsset[]>>
  teams(bbox: BBox): Promise<Loaded<TeamAsset[]>>
  resources(): Promise<Loaded<ResourceAsset[]>>
  blockedRoads(bbox: BBox): Promise<Loaded<RoadAsset[]>>
  incidents(bbox: BBox): Promise<Loaded<IncidentPoint[]>>
  hospitals(bbox: BBox): Promise<Loaded<PointAsset[]>>
  roads(bbox: BBox): Promise<Loaded<RoadAsset[]>>
  buildings(bbox: BBox): Promise<Loaded<BuildingAsset[]>>
  drainage(bbox: BBox): Promise<Loaded<RoadAsset[]>>
}

const failed = <T,>(id: string, label: string, group: DatasetStatus['group'], err: unknown): Loaded<T> => ({
  data: null,
  status: status({ id, label, group, state: 'failed', level: 'missing', error: err instanceof Error ? err.message.slice(0, 200) : 'unknown error', notes: ['The data could not be loaded, so counts for it are unknown (not zero).'] }),
})
const notConfigured = <T,>(id: string, label: string, group: DatasetStatus['group'], how: string): Loaded<T> => ({
  data: null,
  status: status({ id, label, group, state: 'not_configured', level: 'missing', notes: [`No ${label.toLowerCase()} dataset is configured, so affected counts are unknown (not zero).`, how] }),
})

// ---- GeoJSON files ---------------------------------------------------------------------------------------------------

interface FileMeta { name?: string; source?: string; asOf?: string; license?: string }
interface Feat { geometry: { type: string; coordinates: unknown } | null; properties: Record<string, unknown> | null }
interface FileData { feats: Feat[]; meta: FileMeta; mtime: number; skipped: number }
const cache = new Map<string, FileData>()

async function readGeoJson(path: string): Promise<FileData> {
  const st = await stat(path)
  const hit = cache.get(path)
  if (hit && hit.mtime === st.mtimeMs) return hit
  if (st.size > 150 * 1024 * 1024) throw new Error('The data file is larger than 150 MB. Split it or clip it to Karachi.')
  const json = JSON.parse(await readFile(path, 'utf8')) as { type?: string; features?: Feat[]; vyra_meta?: FileMeta }
  if (json?.type !== 'FeatureCollection' || !Array.isArray(json.features)) throw new Error('The file is not a GeoJSON FeatureCollection.')
  let side: FileMeta = {}
  try { side = JSON.parse(await readFile(`${path}.meta.json`, 'utf8')) as FileMeta } catch { /* optional */ }
  const data: FileData = { feats: json.features, meta: { ...(json.vyra_meta ?? {}), ...side }, mtime: st.mtimeMs, skipped: 0 }
  cache.set(path, data)
  return data
}
export const clearAssetCache = () => cache.clear()

const ll = (c: unknown): LatLng | null => (Array.isArray(c) && typeof c[0] === 'number' && typeof c[1] === 'number' && isLatLng([c[1], c[0]]) ? [c[1] as number, c[0] as number] : null)
const line = (c: unknown): LatLng[] | null => {
  if (!Array.isArray(c)) return null
  const out = c.map(ll)
  return out.every((p) => p) && out.length >= 2 ? (out as LatLng[]) : null
}
const meanPoint = (ring: LatLng[]): LatLng => [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length]
const prop = (f: Feat, ...keys: string[]) => { for (const k of keys) { const v = f.properties?.[k]; if (typeof v === 'string' && v.trim()) return v.trim() } return null }

function fileStatus(id: string, label: string, group: DatasetStatus['group'], d: FileData, count: number, cfg: FloodConfig, extra: Partial<DatasetStatus> = {}): DatasetStatus {
  const age = ageDays(d.meta.asOf ?? null)
  const notes: string[] = []
  let state: DatasetStatus['state'] = count === 0 ? 'empty' : 'ok'
  let level: DatasetStatus['level'] = 'good'
  if (!d.meta.asOf) { notes.push('The file does not say when the data was collected (add an "asOf" date in a .meta.json file next to it).'); level = 'fair' }
  else if (age != null && age > cfg.assetStaleDays) { state = 'stale'; level = 'poor'; notes.push(`The data is ${age} days old (limit ${cfg.assetStaleDays}). New buildings, roads or facilities may be missing.`) }
  if (d.skipped) { state = state === 'ok' ? 'partial' : state; level = level === 'good' ? 'fair' : level; notes.push(`${d.skipped} feature(s) in the file were unusable and skipped.`) }
  if (count === 0) { level = 'poor'; notes.push('The file has no features in this area; that may mean the dataset does not cover it, not that none exist.') }
  return status({ id, label, group, state, level, source: d.meta.name || d.meta.source || 'Local file', asOf: d.meta.asOf ?? null, ageDays: age, count, notes, ...extra })
}

async function fromFileLines(id: string, label: string, group: DatasetStatus['group'], path: string, bbox: BBox, cfg: FloodConfig, cap: number, source: string): Promise<Loaded<RoadAsset[]>> {
  try {
    const d = await readFile0(path)
    const out: RoadAsset[] = []
    let skipped = 0
    let truncated = false
    d.feats.forEach((f, i) => {
      const g = f.geometry
      const parts = g?.type === 'LineString' ? [g.coordinates] : g?.type === 'MultiLineString' ? (g.coordinates as unknown[]) : null
      if (!parts) { skipped++; return }
      for (const part of parts) {
        const p = line(part)
        if (!p) { skipped++; continue }
        let w = 180, s = 90, e = -180, n = -90
        for (const [la, ln] of p) { if (ln < w) w = ln; if (ln > e) e = ln; if (la < s) s = la; if (la > n) n = la }
        if (!bboxesIntersect([w, s, e, n], bbox)) continue
        if (out.length >= cap) { truncated = true; return }
        out.push({ id: String(f.properties?.id ?? f.properties?.osm_id ?? `${id}-${i}`), name: prop(f, 'name', 'Name') ?? 'Unnamed', roadClass: prop(f, 'highway', 'class', 'type'), source, path: p })
      }
    })
    d.skipped = skipped
    const st = fileStatus(id, label, group, d, out.length, cfg)
    if (truncated) { st.state = 'truncated'; st.level = 'poor'; st.notes.push(`More than ${cap} features in the area: only the first ${cap} were used, so lengths and counts are lower bounds.`) }
    return { data: out, status: st }
  } catch (e) {
    return failed(id, label, group, e)
  }
}
const readFile0 = readGeoJson

async function fromFilePoints(id: string, label: string, group: DatasetStatus['group'], path: string, bbox: BBox, cfg: FloodConfig, cap: number): Promise<Loaded<PointAsset[]>> {
  try {
    const d = await readGeoJson(path)
    const out: PointAsset[] = []
    let skipped = 0
    d.feats.forEach((f, i) => {
      const g = f.geometry
      let p: LatLng | null = null
      if (g?.type === 'Point') p = ll(g.coordinates)
      else if (g?.type === 'Polygon') { const r = line((g.coordinates as unknown[])?.[0]); p = r ? meanPoint(r) : null }
      else if (g?.type === 'MultiPolygon') { const r = line(((g.coordinates as unknown[][])?.[0] as unknown[])?.[0]); p = r ? meanPoint(r) : null }
      if (!p) { skipped++; return }
      if (p[1] < bbox[0] || p[1] > bbox[2] || p[0] < bbox[1] || p[0] > bbox[3] || out.length >= cap) return
      out.push({ id: String(f.properties?.id ?? f.properties?.osm_id ?? `${id}-${i}`), name: prop(f, 'name', 'Name') ?? 'Unnamed', lat: p[0], lng: p[1] })
    })
    d.skipped = skipped
    return { data: out, status: fileStatus(id, label, group, d, out.length, cfg) }
  } catch (e) {
    return failed(id, label, group, e)
  }
}

async function fromFileBuildings(path: string, bbox: BBox, cfg: FloodConfig): Promise<Loaded<BuildingAsset[]>> {
  const id = 'buildings'
  const label = 'Buildings'
  try {
    const d = await readGeoJson(path)
    const out: BuildingAsset[] = []
    let skipped = 0
    let truncated = false
    d.feats.forEach((f, i) => {
      const g = f.geometry
      let ring: LatLng[] | null = null
      let p: LatLng | null = null
      if (g?.type === 'Point') p = ll(g.coordinates)
      else if (g?.type === 'Polygon') ring = line((g.coordinates as unknown[])?.[0])
      else if (g?.type === 'MultiPolygon') ring = line(((g.coordinates as unknown[][])?.[0] as unknown[])?.[0])
      if (ring) p = meanPoint(ring)
      if (!p) { skipped++; return }
      if (p[1] < bbox[0] || p[1] > bbox[2] || p[0] < bbox[1] || p[0] > bbox[3]) return
      if (out.length >= MAX.buildings) { truncated = true; return }
      out.push({ id: String(f.properties?.id ?? f.properties?.osm_id ?? `b-${i}`), name: prop(f, 'name', 'Name'), lat: p[0], lng: p[1], ring: ring ?? undefined })
    })
    d.skipped = skipped
    const st = fileStatus(id, label, 'assets', d, out.length, cfg)
    if (truncated) { st.state = 'truncated'; st.level = 'poor'; st.notes.push(`More than ${MAX.buildings} buildings in the area: the count is a lower bound.`) }
    return { data: out, status: st }
  } catch (e) {
    return failed(id, label, 'assets', e)
  }
}

// ---- Overpass (OpenStreetMap), optional ------------------------------------------------------------------------------

type FetchLike = (input: string, init?: { method?: string; body?: string; headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>
interface OverpassEl { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; geometry?: { lat: number; lon: number }[]; tags?: Record<string, string> }

async function overpass(cfg: FloodConfig, fetchImpl: FetchLike, body: string): Promise<OverpassEl[]> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), Math.max(cfg.providerTimeoutMs, 30_000))
  try {
    const res = await fetchImpl(cfg.overpassUrl, { method: 'POST', body: `data=${encodeURIComponent(body)}`, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: ctl.signal })
    if (!res.ok) throw new ProviderError('overpass_failed', `OpenStreetMap service answered HTTP ${res.status}.`)
    const json = (await res.json()) as { elements?: OverpassEl[]; remark?: string }
    if (!Array.isArray(json.elements)) throw new ProviderError('overpass_failed', 'OpenStreetMap service returned an unexpected answer.')
    if (json.remark && /runtime error|timed out|out of memory/i.test(json.remark)) throw new ProviderError('overpass_failed', `OpenStreetMap service gave up: ${json.remark.slice(0, 120)}`)
    return json.elements
  } catch (e) {
    if (e instanceof ProviderError) throw e
    throw new ProviderError('overpass_failed', `OpenStreetMap service could not be reached (${(e as Error).name === 'AbortError' ? 'timed out' : (e as Error).message}).`)
  } finally {
    clearTimeout(timer)
  }
}
const osmStatus = (id: string, label: string, count: number, extra: string[] = []): DatasetStatus =>
  status({ id, label, group: 'assets', state: count ? 'ok' : 'empty', level: 'fair', source: 'OpenStreetMap via Overpass (live)', asOf: new Date().toISOString(), ageDays: 0, count, notes: ['Community-mapped data: completeness and positional accuracy vary and are not measured here.', 'Data (c) OpenStreetMap contributors, ODbL.', ...extra] })
const bboxQl = (b: BBox) => `${b[1]},${b[0]},${b[3]},${b[2]}`

// ---- the default providers -------------------------------------------------------------------------------------------

export interface OperationalSource {
  shelters(): Promise<PointAsset[]>
  teams(): Promise<TeamAsset[]>
  resources(): Promise<ResourceAsset[]>
  blockedRoads(): Promise<RoadAsset[]>
  incidents(bbox: BBox): Promise<IncidentPoint[]>
}

export function buildProviders(cfg: FloodConfig, ops: OperationalSource, fetchImpl: FetchLike = fetch as unknown as FetchLike): AssetProviders {
  const reg = (id: string, label: string, p: () => Promise<unknown[]>, note: string, group: DatasetStatus['group'] = 'assets') => async <T,>(filter: (x: unknown) => boolean = () => true): Promise<Loaded<T[]>> => {
    try {
      const all = (await p()).filter(filter)
      return { data: all as T[], status: status({ id, label, group, level: 'fair', source: 'VYRA operational register', count: all.length, state: all.length ? 'ok' : 'empty', notes: [note] }) }
    } catch (e) {
      return failed<T[]>(id, label, group, e)
    }
  }
  const inBox = (b: BBox) => (x: unknown) => { const a = x as { lat: number; lng: number }; return a.lng >= b[0] && a.lng <= b[2] && a.lat >= b[1] && a.lat <= b[3] }
  const pad = (b: BBox) => padBBox(b, 200)

  return {
    shelters: (bbox) => reg('shelters', 'Shelters', ops.shelters, 'Verified shelters only. Occupancy and status are as last entered by staff; a shelter marker never means the area around it is safe.')<PointAsset>(inBox(pad(bbox))),
    teams: (bbox) => reg('teams', 'Rescue teams', ops.teams, 'Team positions are as last recorded and change constantly.')<TeamAsset>(inBox(pad(bbox))),
    resources: () => reg('resources', 'Supplies and equipment', ops.resources, 'The register has no coordinates for supplies; a supply is placed where its holding team is. Supplies not assigned to a team cannot be placed.')<ResourceAsset>(),
    blockedRoads: async (bbox) => {
      const r = await reg('blocked_roads', 'Reported blocked roads', ops.blockedRoads, 'Verified reports of blocked roads. This is a register of reports, not a road network.')<RoadAsset>((x) => {
        const p = (x as RoadAsset).path
        return p.some(([la, ln]) => ln >= bbox[0] - 0.01 && ln <= bbox[2] + 0.01 && la >= bbox[1] - 0.01 && la <= bbox[3] + 0.01)
      })
      return r
    },
    incidents: async (bbox) => {
      try {
        const rows = await ops.incidents(bbox)
        return { data: rows, status: status({ id: 'incidents', label: 'Open incident reports (read-only context)', group: 'context', level: 'fair', source: 'VYRA incident reports', count: rows.length, state: rows.length ? 'ok' : 'empty', notes: ['Read only. Simulations never change an incident, its priority or any dispatch.'] }) }
      } catch (e) {
        return failed('incidents', 'Open incident reports (read-only context)', 'context', e)
      }
    },
    hospitals: async (bbox) => {
      if (cfg.hospitalsPath) return fromFilePoints('hospitals', 'Hospitals', 'assets', cfg.hospitalsPath, padBBox(bbox, 200), cfg, MAX.hospitals)
      if (!cfg.overpassEnabled) return notConfigured('hospitals', 'Hospitals', 'assets', 'Set FLOOD_HOSPITALS_PATH to a GeoJSON file of hospitals, or enable FLOOD_OVERPASS_ENABLED=true.')
      try {
        const els = await overpass(cfg, fetchImpl, `[out:json][timeout:25];(node["amenity"="hospital"](${bboxQl(bbox)});way["amenity"="hospital"](${bboxQl(bbox)});relation["amenity"="hospital"](${bboxQl(bbox)}););out center tags ${MAX.hospitals};`)
        const data: PointAsset[] = []
        for (const e of els) {
          const lat = e.lat ?? e.center?.lat
          const lng = e.lon ?? e.center?.lon
          if (typeof lat === 'number' && typeof lng === 'number') data.push({ id: `osm-${e.type}-${e.id}`, name: e.tags?.name || 'Unnamed hospital', lat, lng })
        }
        return { data, status: osmStatus('hospitals', 'Hospitals', data.length) }
      } catch (e) { return failed('hospitals', 'Hospitals', 'assets', e) }
    },
    roads: async (bbox) => {
      if (cfg.roadsPath) return fromFileLines('roads', 'Road network', 'assets', cfg.roadsPath, bbox, cfg, MAX.roads, 'Road network file')
      if (!cfg.overpassEnabled) return notConfigured('roads', 'Road network', 'assets', 'Set FLOOD_ROADS_PATH to a GeoJSON file of roads, or enable FLOOD_OVERPASS_ENABLED=true.')
      try {
        const els = await overpass(cfg, fetchImpl, `[out:json][timeout:25];way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"](${bboxQl(bbox)});out geom ${MAX.roads + 1};`)
        const data: RoadAsset[] = []
        for (const e of els) {
          if (e.type !== 'way' || !e.geometry || e.geometry.length < 2) continue
          data.push({ id: `osm-way-${e.id}`, name: e.tags?.name || 'Unnamed road', roadClass: e.tags?.highway ?? null, source: 'OpenStreetMap', path: e.geometry.map((g) => [g.lat, g.lon] as LatLng) })
        }
        const st = osmStatus('roads', 'Road network', Math.min(data.length, MAX.roads))
        if (data.length > MAX.roads) { data.length = MAX.roads; st.state = 'truncated'; st.level = 'poor'; st.notes.push(`More than ${MAX.roads} road segments in the area: lengths and counts are lower bounds.`) }
        return { data, status: st }
      } catch (e) { return failed('roads', 'Road network', 'assets', e) }
    },
    buildings: async (bbox) => {
      if (cfg.buildingsPath) return fromFileBuildings(cfg.buildingsPath, bbox, cfg)
      if (!cfg.overpassEnabled) return notConfigured('buildings', 'Buildings', 'assets', 'Set FLOOD_BUILDINGS_PATH to a GeoJSON file of building footprints, or enable FLOOD_OVERPASS_ENABLED=true.')
      try {
        const els = await overpass(cfg, fetchImpl, `[out:json][timeout:60];way["building"](${bboxQl(bbox)});out center ${MAX.buildings + 1};`)
        const data: BuildingAsset[] = []
        for (const e of els) if (e.center) data.push({ id: `osm-way-${e.id}`, name: e.tags?.name ?? null, lat: e.center.lat, lng: e.center.lon })
        const st = osmStatus('buildings', 'Buildings', Math.min(data.length, MAX.buildings), ['Buildings are located by centre point only; footprints are not tested.'])
        if (data.length > MAX.buildings) { data.length = MAX.buildings; st.state = 'truncated'; st.level = 'poor'; st.notes.push(`More than ${MAX.buildings} buildings in the area: the count is a lower bound.`) }
        return { data, status: st }
      } catch (e) { return failed('buildings', 'Buildings', 'assets', e) }
    },
    drainage: async (bbox) => {
      if (!cfg.drainagePath) return notConfigured('drainage', 'Drainage network (drains, nullahs)', 'context', 'Set FLOOD_DRAINAGE_PATH to a GeoJSON file of drains and nullahs from the water authority. VYRA does not ship or invent one.')
      return fromFileLines('drainage', 'Drainage network (drains, nullahs)', 'context', cfg.drainagePath, bbox, cfg, MAX.drainage, 'Drainage file')
    },
  }
}

export { failed as failedLoad, notConfigured as notConfiguredLoad }
