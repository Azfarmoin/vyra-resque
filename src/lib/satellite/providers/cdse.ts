// Copernicus Data Space Ecosystem, Sentinel Hub APIs (https://dataspace.copernicus.eu). An AUTHORISED API: it needs an OAuth client
// (CDSE_CLIENT_ID / CDSE_CLIENT_SECRET) created in the CDSE dashboard. Without them this provider reports "credentials missing"
// and nothing is requested. Catalogue search finds scenes; the Process API returns the bands already cut to the analysis grid.
import { FLAG, COLLECTION_KIND, type Bbox, type CollectionId, type SceneMeta } from '../types'
import type { LoadedScene } from '../analysis/engine'
import type { Grid } from '../raster/grid'
import { readAlignedSamples } from '../raster/geotiffIo'
import { fromArrayBuffer } from 'geotiff'
import { capOriginal, httpJson, isBbox, isObj, ProviderError, type ImageryProvider, type ProviderDeps, type ProviderStatus, type SearchRequest, type SearchResult } from './types'
import { sclToFlags } from './planetaryComputer'

const CAT: Partial<Record<CollectionId, string>> = { 'sentinel-2-l2a': 'sentinel-2-l2a', 'sentinel-1': 'sentinel-1-grd' }
const LICENSE = { license: 'Free and open (Copernicus Sentinel data terms; CDSE terms of use apply to the account)', attribution: 'Contains modified Copernicus Sentinel data, via Copernicus Data Space Ecosystem' }
const S2_EVAL = `//VERSION=3
function setup(){return{input:[{bands:["B02","B03","B04","B08","B11","SCL","dataMask"]}],output:{bands:7,sampleType:"FLOAT32"}}}
function evaluatePixel(s){return [s.B02,s.B03,s.B04,s.B08,s.B11,s.SCL,s.dataMask]}`
const S1_EVAL = `//VERSION=3
function setup(){return{input:[{bands:["VV","VH","dataMask"]}],output:{bands:3,sampleType:"FLOAT32"}}}
function evaluatePixel(s){return [s.VV,s.VH,s.dataMask]}`

export function cdseSentinelHub(deps: ProviderDeps, env: NodeJS.ProcessEnv = process.env): ImageryProvider {
  const base = (env.CDSE_BASE_URL || 'https://sh.dataspace.copernicus.eu').replace(/\/$/, '')
  const tokenUrl = env.CDSE_TOKEN_URL || 'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token'
  let cached: { token: string; until: number } | null = null
  const missing = () => ['CDSE_CLIENT_ID', 'CDSE_CLIENT_SECRET'].filter((k) => !env[k])

  async function bearer(): Promise<string> {
    if (missing().length) throw new ProviderError('missing_credentials', `Copernicus Data Space credentials are not configured (${missing().join(', ')}).`, 503)
    if (cached && cached.until > deps.now() + 30_000) return cached.token
    const r = await httpJson(deps, tokenUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'client_credentials', client_id: env.CDSE_CLIENT_ID!, client_secret: env.CDSE_CLIENT_SECRET! }).toString() })
    if (!isObj(r) || typeof r.access_token !== 'string') throw new ProviderError('invalid_response', 'The sign-in service did not return an access token.')
    cached = { token: r.access_token, until: deps.now() + (typeof r.expires_in === 'number' ? r.expires_in : 300) * 1000 }
    return r.access_token
  }

  function normalise(f: unknown, collection: CollectionId): SceneMeta | null {
    if (!isObj(f) || typeof f.id !== 'string' || !isObj(f.properties)) return null
    const p = f.properties, t = typeof p.datetime === 'string' ? Date.parse(p.datetime) : NaN
    if (!Number.isFinite(t)) return null
    const kind = COLLECTION_KIND[collection]
    let cloud: number | null = null
    if (kind === 'optical' && p['eo:cloud_cover'] != null) { const c = p['eo:cloud_cover']; if (typeof c !== 'number' || !Number.isFinite(c) || c < 0 || c > 100) return null; cloud = c }
    const orbit = p['sat:orbit_state']
    return { id: f.id, provider: 'cdse-sentinelhub', collection, kind, platform: typeof p.platform === 'string' ? p.platform : collection, acquiredAt: new Date(t).toISOString(), resolutionM: 10, cloudCover: cloud, orbitDirection: orbit === 'ascending' || orbit === 'descending' ? orbit : null, relativeOrbit: typeof p['sat:relative_orbit'] === 'number' ? p['sat:relative_orbit'] : null, crs: null, footprintBbox: isBbox(f.bbox) ? ([f.bbox[0], f.bbox[1], f.bbox[2], f.bbox[3]] as Bbox) : null, ...LICENSE, original: capOriginal({ catalog_item_id: f.id, bbox: f.bbox ?? null, properties: p }), access: { datetime: new Date(t).toISOString() } }
  }

  return {
    id: 'cdse-sentinelhub',
    status(): ProviderStatus {
      const m = missing()
      return { id: 'cdse-sentinelhub', name: 'Copernicus Data Space (Sentinel Hub)', description: 'Sentinel-2 L2A and Sentinel-1 GRD through the authorised Sentinel Hub APIs.', state: m.length ? 'missing_credentials' : 'ready', missing: m, message: m.length ? `Credentials missing: set ${m.join(' and ')} on the server. See SATELLITE.md.` : 'Ready.', collections: ['sentinel-2-l2a', 'sentinel-1'], ...LICENSE }
    },
    async search(req: SearchRequest): Promise<SearchResult> {
      const cat = CAT[req.collection]
      if (!cat) throw new ProviderError('unsupported', 'This provider does not offer that collection.', 400)
      const tk = await bearer()
      const body: Record<string, unknown> = { collections: [cat], bbox: req.bbox, datetime: `${req.start}T00:00:00Z/${req.end}T23:59:59Z`, limit: 100 }
      if (COLLECTION_KIND[req.collection] === 'optical' && req.maxCloud != null) { body.filter = `eo:cloud_cover < ${Number(req.maxCloud)}`; body['filter-lang'] = 'cql2-text' }
      const r = await httpJson(deps, `${base}/api/v1/catalog/1.0.0/search`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tk}` }, body: JSON.stringify(body) })
      if (!isObj(r) || !Array.isArray(r.features)) throw new ProviderError('invalid_response', 'The imagery provider answered, but not with a list of scenes.')
      const lo = Date.parse(`${req.start}T00:00:00Z`), hi = Date.parse(`${req.end}T23:59:59Z`), scenes: SceneMeta[] = [], notes: string[] = []
      let skipped = 0, outside = 0
      for (const f of r.features) { const s = normalise(f, req.collection); if (!s) { skipped++; continue } const t = Date.parse(s.acquiredAt); if (t < lo || t > hi) { outside++; continue } scenes.push(s) }
      if (skipped) notes.push(`${skipped} item(s) from the provider were unusable and were left out.`)
      if (outside) notes.push(`${outside} item(s) were outside the requested dates and were ignored.`)
      return { scenes, skipped, notes }
    },
    async getScene(collection, id) {
      const cat = CAT[collection]
      if (!cat) throw new ProviderError('unsupported', 'This provider does not offer that collection.', 400)
      const tk = await bearer()
      const r = await httpJson(deps, `${base}/api/v1/catalog/1.0.0/collections/${cat}/items/${encodeURIComponent(id)}`, { headers: { authorization: `Bearer ${tk}` } })
      const s = normalise(r, collection)
      if (!s) throw new ProviderError('invalid_response', 'The provider returned a scene record that is missing required information.')
      return s
    },
    async load(scene: SceneMeta, grid: Grid): Promise<LoadedScene> {
      const tk = await bearer()
      const t = Date.parse(String(scene.access?.datetime ?? scene.acquiredAt))
      const sar = scene.kind === 'sar'
      const data: Record<string, unknown> = { type: sar ? 'sentinel-1-grd' : 'sentinel-2-l2a', dataFilter: { timeRange: { from: new Date(t - 30_000).toISOString(), to: new Date(t + 30_000).toISOString() }, ...(sar ? { acquisitionMode: 'IW', resolution: 'HIGH' } : { mosaickingOrder: 'leastCC' }) }, ...(sar ? { processing: { backCoeff: 'GAMMA0_TERRAIN', orthorectify: true, demInstance: 'COPERNICUS_30', speckleFilter: { type: 'NONE' } } } : {}) }
      const body = { input: { bounds: { bbox: grid.bbox, properties: { crs: 'http://www.opengis.net/def/crs/EPSG/0/4326' } }, data: [data] }, output: { width: grid.width, height: grid.height, responses: [{ identifier: 'default', format: { type: 'image/tiff' } }] }, evalscript: sar ? S1_EVAL : S2_EVAL }
      let res: Response
      try { res = await deps.fetch(`${base}/api/v1/process`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'image/tiff', authorization: `Bearer ${tk}` }, body: JSON.stringify(body) }) } catch { throw new ProviderError('unavailable', 'Could not reach the imagery provider.', 503) }
      if (res.status === 401 || res.status === 403) throw new ProviderError('auth_failed', `The imagery provider refused the credentials or access (HTTP ${res.status}).`)
      if (res.status === 429) throw new ProviderError('rate_limited', 'The imagery provider is rate limiting requests. Try again shortly.', 503)
      if (!res.ok) throw new ProviderError('unavailable', `The imagery provider returned HTTP ${res.status}.`, 503)
      let samples: Float32Array[]
      try { samples = await readAlignedSamples(await fromArrayBuffer(await res.arrayBuffer()), grid) } catch (e) {
        if (e instanceof ProviderError || (e as { code?: string }).code === 'invalid_provider_response') throw e
        throw new ProviderError('invalid_response', 'The imagery provider returned data that is not a readable GeoTIFF.')
      }
      const n = grid.width * grid.height, flags = new Uint8Array(n)
      if (sar) {
        if (samples.length !== 3) throw new ProviderError('invalid_response', 'The radar response did not have the expected bands.')
        const [vv, vh, mask] = samples
        for (let i = 0; i < n; i++) { if (!mask[i] || !(vv[i] > 0)) { flags[i] |= FLAG.NODATA; vv[i] = NaN; vh[i] = NaN } }
        return { bands: { vv, vh }, flags, maskAvailable: true }
      }
      if (samples.length !== 7) throw new ProviderError('invalid_response', 'The optical response did not have the expected bands.')
      const [blue, green, red, nir, swir, scl, mask] = samples
      for (let i = 0; i < n; i++) { flags[i] = sclToFlags(scl[i]) | (mask[i] ? 0 : FLAG.NODATA); if (flags[i] & FLAG.NODATA) { green[i] = NaN; red[i] = NaN; nir[i] = NaN; swir[i] = NaN } }
      return { bands: { blue, green, red, nir, swir }, flags, maskAvailable: true }
    },
  }
}
