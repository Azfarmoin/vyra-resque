// Microsoft Planetary Computer: a public STAC API over Sentinel-2 L2A, Sentinel-1 RTC and Landsat Collection 2 Level 2.
// Searching and reading need no account; assets are read with a short-lived SAS token from the provider's token endpoint.
// An optional PC_SUBSCRIPTION_KEY raises rate limits. Licences: Sentinel data is free and open (Copernicus); Landsat is public domain (USGS);
// Sentinel-1 RTC is a Microsoft/Catalyst product under CC BY 4.0. Keep the attribution shown in the app.
import { FLAG, COLLECTION_KIND, type Bbox, type CollectionId, type SceneMeta } from '../types'
import type { LoadedScene } from '../analysis/engine'
import type { Grid } from '../raster/grid'
import { readBandOnGrid } from '../raster/geotiffIo'
import { AnalysisError } from '../quality'
import { capOriginal, httpJson, isBbox, isObj, ProviderError, type ImageryProvider, type ProviderDeps, type ProviderStatus, type SearchRequest, type SearchResult } from './types'

const PC_COLLECTION: Record<string, string> = { 'sentinel-2-l2a': 'sentinel-2-l2a', 'sentinel-1': 'sentinel-1-rtc', 'landsat-c2-l2': 'landsat-c2-l2' }
const NATIVE_RES: Record<string, number> = { 'sentinel-2-l2a': 10, 'sentinel-1': 10, 'landsat-c2-l2': 30 }
const ASSETS: Record<string, string[]> = {
  'sentinel-2-l2a': ['B03', 'B04', 'B08', 'B11', 'SCL'], // B02 (blue) is optional, preview only
  'landsat-c2-l2': ['green', 'red', 'nir08', 'swir16', 'qa_pixel'],
  'sentinel-1': [],
}
const LICENSE: Record<string, { license: string; attribution: string }> = {
  'sentinel-2-l2a': { license: 'Free and open (Copernicus Sentinel data terms)', attribution: 'Contains modified Copernicus Sentinel data, via Microsoft Planetary Computer' },
  'sentinel-1': { license: 'CC BY 4.0 (Sentinel-1 RTC, Catalyst/Microsoft)', attribution: 'Contains modified Copernicus Sentinel-1 data, radiometrically terrain corrected by Catalyst; Microsoft Planetary Computer' },
  'landsat-c2-l2': { license: 'Public domain (USGS)', attribution: 'Landsat Collection 2 courtesy of the U.S. Geological Survey, via Microsoft Planetary Computer' },
}

/** Sentinel-2 SCL classes -> flags. 0/1 no data or saturated, 3 shadow, 8/9 cloud, 10 thin cirrus, 11 snow. */
export function sclToFlags(v: number): number {
  if (!Number.isFinite(v)) return FLAG.NODATA
  switch (Math.round(v)) { case 0: case 1: return FLAG.NODATA; case 3: return FLAG.SHADOW; case 8: case 9: return FLAG.CLOUD; case 10: return FLAG.CIRRUS; case 11: return FLAG.SNOW; default: return 0 }
}
/** Landsat QA_PIXEL bits: 0 fill, 1 dilated cloud, 2 cirrus, 3 cloud, 4 shadow, 5 snow. */
export function landsatQaToFlags(v: number): number {
  if (!Number.isFinite(v)) return FLAG.NODATA
  const n = Math.round(v)
  return (n & 1 ? FLAG.NODATA : 0) | (n & 0b1010 ? FLAG.CLOUD : 0) | (n & 0b100 ? FLAG.CIRRUS : 0) | (n & 0b10000 ? FLAG.SHADOW : 0) | (n & 0b100000 ? FLAG.SNOW : 0)
}

export function planetaryComputer(deps: ProviderDeps, env: NodeJS.ProcessEnv = process.env): ImageryProvider {
  const stac = (env.PC_STAC_URL || 'https://planetarycomputer.microsoft.com/api/stac/v1').replace(/\/$/, '')
  const sas = (env.PC_SAS_URL || 'https://planetarycomputer.microsoft.com/api/sas/v1').replace(/\/$/, '')
  const key = env.PC_SUBSCRIPTION_KEY
  const headers: Record<string, string> = { 'content-type': 'application/json', 'user-agent': `VYRA/1.0 ${env.ALERT_CONTACT || ''}`.trim(), ...(key ? { 'Ocp-Apim-Subscription-Key': key } : {}) }
  const tokens = new Map<string, { token: string; until: number }>()

  function normalise(item: unknown, collection: CollectionId): SceneMeta | null {
    if (!isObj(item) || typeof item.id !== 'string' || !isObj(item.properties) || !isObj(item.assets)) return null
    const p = item.properties, a = item.assets
    const t = typeof p.datetime === 'string' ? Date.parse(p.datetime) : NaN
    if (!Number.isFinite(t)) return null
    const kind = COLLECTION_KIND[collection]
    let cloud: number | null = null
    if (kind === 'optical') {
      const c = p['eo:cloud_cover']
      if (c !== undefined && c !== null) { if (typeof c !== 'number' || !Number.isFinite(c) || c < 0 || c > 100) return null; cloud = c }
    }
    const need = collection === 'sentinel-1' ? ['vv'] : ASSETS[collection]
    if (collection === 'sentinel-1' ? !isObj(a.vv) && !isObj(a.vh) : need.some((k) => !isObj(a[k]) || typeof (a[k] as Record<string, unknown>).href !== 'string')) return null
    const access: Record<string, unknown> = { assets: {} as Record<string, unknown>, baseline: p['s2:processing_baseline'] }
    for (const [k, v] of Object.entries(a)) if (isObj(v) && typeof v.href === 'string') {
      const rb = Array.isArray(v['raster:bands']) && isObj(v['raster:bands'][0]) ? (v['raster:bands'][0] as Record<string, unknown>) : {}
      ;(access.assets as Record<string, unknown>)[k] = { href: v.href, scale: typeof rb.scale === 'number' ? rb.scale : null, offset: typeof rb.offset === 'number' ? rb.offset : null, nodata: typeof rb.nodata === 'number' ? rb.nodata : null }
    }
    const epsg = typeof p['proj:epsg'] === 'number' ? `EPSG:${p['proj:epsg']}` : typeof p['proj:code'] === 'string' ? p['proj:code'] : null
    const pols = Array.isArray(p['sar:polarizations']) ? (p['sar:polarizations'] as unknown[]).filter((x): x is string => typeof x === 'string') : undefined
    const orbit = p['sat:orbit_state']
    return {
      id: item.id, provider: 'planetary-computer', collection, kind,
      platform: typeof p.platform === 'string' ? p.platform : collection,
      acquiredAt: new Date(t).toISOString(), resolutionM: NATIVE_RES[collection], cloudCover: cloud,
      orbitDirection: orbit === 'ascending' || orbit === 'descending' ? orbit : null,
      relativeOrbit: typeof p['sat:relative_orbit'] === 'number' ? p['sat:relative_orbit'] : null,
      polarizations: pols, crs: epsg, footprintBbox: isBbox(item.bbox) ? ([item.bbox[0], item.bbox[1], item.bbox[2], item.bbox[3]] as Bbox) : null,
      ...LICENSE[collection], original: capOriginal({ stac_collection: PC_COLLECTION[collection], stac_item_id: item.id, bbox: item.bbox ?? null, properties: p }), access,
    }
  }

  async function token(collection: CollectionId): Promise<string> {
    const c = PC_COLLECTION[collection], hit = tokens.get(c)
    if (hit && hit.until > deps.now() + 60_000) return hit.token
    const r = await httpJson(deps, `${sas}/token/${c}`, { headers })
    if (!isObj(r) || typeof r.token !== 'string' || !r.token) throw new ProviderError('invalid_response', 'The provider returned no access token for the imagery.')
    const exp = typeof r['msft:expiry'] === 'string' ? Date.parse(r['msft:expiry']) : NaN
    tokens.set(c, { token: r.token, until: Number.isFinite(exp) ? exp : deps.now() + 10 * 60_000 })
    return r.token
  }

  return {
    id: 'planetary-computer',
    status(): ProviderStatus {
      return { id: 'planetary-computer', name: 'Microsoft Planetary Computer (STAC)', description: 'Public catalogue of Sentinel-2, Sentinel-1 RTC and Landsat. No account needed; anonymous access is rate limited.', state: 'ready', missing: [], message: key ? 'Ready (using your subscription key).' : 'Ready (anonymous access; set PC_SUBSCRIPTION_KEY for higher limits).', collections: ['sentinel-2-l2a', 'sentinel-1', 'landsat-c2-l2'], license: 'Per collection: Sentinel free and open, Landsat public domain, Sentinel-1 RTC CC BY 4.0', attribution: 'Microsoft Planetary Computer' }
    },
    async search(req: SearchRequest): Promise<SearchResult> {
      const body: Record<string, unknown> = {
        collections: [PC_COLLECTION[req.collection]], bbox: req.bbox, datetime: `${req.start}T00:00:00Z/${req.end}T23:59:59Z`, limit: 100,
        sortby: [{ field: 'properties.datetime', direction: 'asc' }],
      }
      const query: Record<string, unknown> = {}
      if (COLLECTION_KIND[req.collection] === 'optical' && req.maxCloud != null) query['eo:cloud_cover'] = { lte: req.maxCloud }
      if (req.collection === 'landsat-c2-l2') query.platform = { in: ['landsat-8', 'landsat-9'] }
      if (Object.keys(query).length) body.query = query
      const r = await httpJson(deps, `${stac}/search`, { method: 'POST', headers, body: JSON.stringify(body) })
      if (!isObj(r) || !Array.isArray(r.features)) throw new ProviderError('invalid_response', 'The imagery provider answered, but not with a list of scenes.')
      const lo = Date.parse(`${req.start}T00:00:00Z`), hi = Date.parse(`${req.end}T23:59:59Z`)
      const scenes: SceneMeta[] = [], notes: string[] = []
      let skipped = 0, outside = 0
      for (const f of r.features) {
        const s = normalise(f, req.collection)
        if (!s) { skipped++; continue }
        const t = Date.parse(s.acquiredAt)
        if (t < lo || t > hi) { outside++; continue } // never trust a provider to honour the date filter
        scenes.push(s)
      }
      if (skipped) notes.push(`${skipped} item(s) from the provider were unusable (missing date, bands or an invalid cloud value) and were left out.`)
      if (outside) notes.push(`${outside} item(s) were outside the requested dates and were ignored.`)
      return { scenes, skipped, notes }
    },
    async getScene(collection, id) {
      const r = await httpJson(deps, `${stac}/collections/${PC_COLLECTION[collection]}/items/${encodeURIComponent(id)}`, { headers })
      const s = normalise(r, collection)
      if (!s) throw new ProviderError('invalid_response', 'The provider returned a scene record that is missing required information.')
      return s
    },
    async load(scene: SceneMeta, grid: Grid): Promise<LoadedScene> {
      const assets = (scene.access?.assets ?? {}) as Record<string, { href: string; scale: number | null; offset: number | null; nodata: number | null }>
      const tk = await token(scene.collection)
      const read = async (name: string, o: { categorical?: boolean; zeroIsNoData?: boolean; reflectance?: boolean } = {}) => {
        const a = assets[name]
        if (!a) return undefined
        let tiff
        try { tiff = await deps.openTiff(`${a.href}${a.href.includes('?') ? '&' : '?'}${tk}`) } catch (e) {
          if (e instanceof AnalysisError || e instanceof ProviderError) throw e
          throw new ProviderError('unavailable', `Could not read the ${name} image data from the provider.`, 503)
        }
        let scale = a.scale ?? 1, offset = a.offset ?? 0
        if (o.reflectance && a.scale == null) {
          if (scene.collection === 'landsat-c2-l2') { scale = 2.75e-5; offset = -0.2 } else { scale = 1e-4; offset = parseFloat(String(scene.access?.baseline ?? '5')) >= 4 ? -0.1 : 0 }
        }
        return readBandOnGrid(tiff, grid, { resample: o.categorical ? 'nearest' : 'bilinear', scale: o.categorical ? 1 : scale, offset: o.categorical ? 0 : offset, noData: a.nodata, zeroIsNoData: o.zeroIsNoData })
      }
      const n = grid.width * grid.height, flags = new Uint8Array(n)
      if (scene.kind === 'sar') {
        const vv = await read('vv', { zeroIsNoData: true }), vh = await read('vh', { zeroIsNoData: true })
        if (!vv && !vh) throw new ProviderError('invalid_response', 'The radar scene has no VV or VH data.')
        for (const b of [vv, vh]) if (b) for (let i = 0; i < n; i++) if (!(b[i] > 0)) flags[i] |= FLAG.NODATA
        return { bands: { vv, vh }, flags, maskAvailable: true }
      }
      const s2 = scene.collection === 'sentinel-2-l2a'
      const refl = { reflectance: true, zeroIsNoData: s2 }
      const [green, red, nir, swir, blue] = await Promise.all([read(s2 ? 'B03' : 'green', refl), read(s2 ? 'B04' : 'red', refl), read(s2 ? 'B08' : 'nir08', refl), read(s2 ? 'B11' : 'swir16', refl), read(s2 ? 'B02' : 'blue', refl)])
      const qa = await read(s2 ? 'SCL' : 'qa_pixel', { categorical: true })
      if (!green || !red || !nir || !swir || !qa) throw new ProviderError('invalid_response', 'The scene is missing bands needed for analysis.')
      for (let i = 0; i < n; i++) flags[i] = (s2 ? sclToFlags(qa[i]) : landsatQaToFlags(qa[i])) | (Number.isFinite(green[i]) && Number.isFinite(nir[i]) ? 0 : FLAG.NODATA)
      return { bands: { green, red, nir, swir, blue }, flags, maskAvailable: true }
    },
  }
}
export type { Bbox }
