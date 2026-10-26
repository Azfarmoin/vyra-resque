// User-supplied imagery: two GeoTIFFs the analyst already has the right to use (a licensed commercial scene, a drone mosaic,
// a partner agency product). VYRA cannot verify date, platform or sensor type, so those are recorded as "declared by uploader".
// The licence confirmation is mandatory. The files themselves are NOT stored; only their metadata and SHA-256 are kept.
import { createHash } from 'node:crypto'
import { FLAG, type BandName, type SceneMeta } from '../types'
import type { LoadedScene } from '../analysis/engine'
import type { Grid } from '../raster/grid'
import { describeTiff, openBuffer, readBandOnGrid } from '../raster/geotiffIo'
import { AnalysisError } from '../quality'
import { parseDay } from '../validation'
import { ProviderError, type ImageryProvider, type ProviderStatus } from './types'

export interface UploadDeclaration {
  kind: 'optical' | 'sar'; platform: string; acquiredAt: string; bands: BandName[]
  sarUnit?: 'linear' | 'db'; scale?: number; offset?: number; noData?: number | null; epsg?: number | null
  licenseConfirmed: boolean; source?: string
}
const OPTICAL = new Set<BandName>(['blue', 'green', 'red', 'nir', 'swir']), SAR = new Set<BandName>(['vv', 'vh'])

export async function describeUpload(buf: ArrayBuffer, d: UploadDeclaration, filename: string, now = Date.now()): Promise<SceneMeta> {
  if (d.licenseConfirmed !== true) throw new AnalysisError('license_not_confirmed', 'Confirm that you are licensed to use this imagery in VYRA before uploading it.', 400)
  if (d.kind !== 'optical' && d.kind !== 'sar') throw new AnalysisError('bad_declaration', 'Say whether the image is optical or radar.', 400)
  const platform = (d.platform || '').trim().slice(0, 80)
  if (!platform) throw new AnalysisError('bad_declaration', 'Name the platform or sensor of the image (for example "PlanetScope" or "Sentinel-2B").', 400)
  const day = parseDay(String(d.acquiredAt || '').slice(0, 10)), t = day == null ? NaN : Date.parse(String(d.acquiredAt).length > 10 ? String(d.acquiredAt) : `${d.acquiredAt}T12:00:00Z`)
  if (day == null || !Number.isFinite(t)) throw new AnalysisError('bad_declaration', 'The acquisition date must be a real date (YYYY-MM-DD).', 400)
  if (t > now) throw new AnalysisError('bad_declaration', 'The acquisition date is in the future.', 400)
  const allowed = d.kind === 'optical' ? OPTICAL : SAR
  if (!Array.isArray(d.bands) || !d.bands.length || d.bands.some((b) => !allowed.has(b)) || new Set(d.bands).size !== d.bands.length) throw new AnalysisError('bad_declaration', `Band order must list each ${d.kind} band once (${[...allowed].join(', ')}).`, 400)
  let tiff
  try { tiff = await openBuffer(buf) } catch { throw new AnalysisError('unreadable_image', 'The file could not be read as a GeoTIFF.', 400) }
  const info = await describeTiff(tiff, d.epsg)
  if (info.bands !== d.bands.length) throw new AnalysisError('bad_declaration', `The file has ${info.bands} band(s) but ${d.bands.length} were declared.`, 400)
  const sha = createHash('sha256').update(Buffer.from(buf)).digest('hex')
  return {
    id: `upload-${sha.slice(0, 16)}`, provider: 'user-upload', collection: d.kind === 'optical' ? 'user-optical' : 'user-sar', kind: d.kind, platform, acquiredAt: new Date(t).toISOString(),
    resolutionM: Math.round(info.resolutionM * 10) / 10, cloudCover: null, orbitDirection: null, relativeOrbit: null, crs: `EPSG:${info.epsg}`, footprintBbox: info.bboxWgs84,
    license: 'User-supplied. The uploader confirmed they hold the rights to use it here; check the source licence before sharing results.', attribution: d.source?.trim().slice(0, 200) || 'User-supplied imagery',
    original: { filename: filename.slice(0, 200), bytes: buf.byteLength, sha256: sha, width: info.width, height: info.height, bandCount: info.bands, epsg: info.epsg, declared: { ...d, platform, source: d.source ?? null } },
    declaredByUser: true, access: { buffer: buf, decl: d },
  }
}

export function uploadProvider(): ImageryProvider {
  const no = () => { throw new ProviderError('unsupported', 'User-supplied imagery has no catalogue. Upload a before and an after file instead.', 400) }
  return {
    id: 'user-upload',
    status(): ProviderStatus { return { id: 'user-upload', name: 'Your own imagery (GeoTIFF upload)', description: 'Upload two georeferenced GeoTIFFs you are licensed to use. WGS84 or UTM, north-up.', state: 'ready', missing: [], message: 'Ready. You must confirm you hold the licence.', collections: ['user-optical', 'user-sar'], license: 'Set by the uploader', attribution: 'As declared by the uploader', upload: true } },
    search: async () => no(), getScene: async () => no(),
    async load(scene: SceneMeta, grid: Grid): Promise<LoadedScene> {
      const buf = scene.access?.buffer as ArrayBuffer | undefined, d = scene.access?.decl as UploadDeclaration | undefined
      if (!buf || !d) throw new AnalysisError('upload_missing', 'The uploaded image is no longer available. Upload it again.', 400)
      const tiff = await openBuffer(buf), n = grid.width * grid.height, bands: LoadedScene['bands'] = {}, flags = new Uint8Array(n)
      for (let i = 0; i < d.bands.length; i++) {
        const name = d.bands[i]
        const arr = await readBandOnGrid(tiff, grid, { sample: i, resample: 'bilinear', scale: d.scale ?? 1, offset: d.offset ?? 0, noData: d.noData, epsg: d.epsg })
        if (d.kind === 'sar' && d.sarUnit === 'db') for (let k = 0; k < n; k++) arr[k] = Math.pow(10, arr[k] / 10) // the engine works in linear power
        bands[name] = arr
        for (let k = 0; k < n; k++) if (!Number.isFinite(arr[k])) flags[k] |= FLAG.NODATA
      }
      return { bands, flags, maskAvailable: false }
    },
  }
}
