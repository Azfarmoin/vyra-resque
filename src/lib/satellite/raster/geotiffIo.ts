// Reading GeoTIFF / Cloud-Optimised GeoTIFF windows onto the analysis grid.
// Supported georeferencing: north-up rasters in WGS84 (EPSG:4326) or WGS84/UTM (EPSG:326xx / 327xx). Anything else
// (rotated rasters, other projections) is refused with a clear message rather than being silently misplaced.
import { fromArrayBuffer, fromUrl, type GeoTIFF, type GeoTIFFImage } from 'geotiff'
import proj4 from 'proj4'
import { AnalysisError } from '../quality'
import type { Bbox } from '../types'
import type { Grid } from './grid'

export type Xf = { fwd: (lng: number, lat: number) => [number, number]; inv: (x: number, y: number) => [number, number]; degrees: boolean }

export function transformFor(epsg: number): Xf | null {
  if (epsg === 4326) return { fwd: (x, y) => [x, y], inv: (x, y) => [x, y], degrees: true }
  const zone = epsg >= 32601 && epsg <= 32660 ? epsg - 32600 : epsg >= 32701 && epsg <= 32760 ? epsg - 32700 : 0
  if (!zone) return null
  const def = `+proj=utm +zone=${zone} ${epsg >= 32701 ? '+south ' : ''}+datum=WGS84 +units=m +no_defs`
  const p = proj4('EPSG:4326', def)
  return { fwd: (x, y) => p.forward([x, y]) as [number, number], inv: (x, y) => p.inverse([x, y]) as [number, number], degrees: false }
}

export const openUrl = (url: string): Promise<GeoTIFF> => fromUrl(url, { allowFullFile: false } as never)
export const openBuffer = (buf: ArrayBuffer): Promise<GeoTIFF> => fromArrayBuffer(buf)

export function epsgOf(image: GeoTIFFImage, override?: number | null): number {
  if (override) return override
  const k = image.getGeoKeys() as Record<string, number> | null
  const code = k?.ProjectedCSTypeGeoKey || k?.GeographicTypeGeoKey
  if (!code || code === 32767) throw new AnalysisError('unsupported_crs', 'The image has no usable coordinate reference system.')
  return code
}

export interface TiffInfo { epsg: number; width: number; height: number; bands: number; resolutionM: number; bboxWgs84: Bbox; noData: number | null }

export async function describeTiff(tiff: GeoTIFF, epsgOverride?: number | null): Promise<TiffInfo> {
  const img = await tiff.getImage(0)
  const dir = img.getFileDirectory() as unknown as Record<string, unknown>
  const mt = dir.ModelTransformation as number[] | undefined
  if (mt && (Math.abs(mt[1]) > 1e-12 || Math.abs(mt[4]) > 1e-12)) throw new AnalysisError('unsupported_raster', 'Rotated or sheared rasters are not supported. Reproject the image to a north-up GeoTIFF.')
  let epsg: number
  try { epsg = epsgOf(img, epsgOverride) } catch (e) { throw e }
  const xf = transformFor(epsg)
  if (!xf) throw new AnalysisError('unsupported_crs', `Coordinate system EPSG:${epsg} is not supported. Use WGS84 (EPSG:4326) or a WGS84 UTM zone.`)
  let box: number[]
  try { box = img.getBoundingBox() } catch { throw new AnalysisError('unsupported_raster', 'The image has no georeferencing (not a GeoTIFF).') }
  const [x0, y0, x1, y1] = box
  const [w0, s0] = xf.inv(x0, y0), [w1, n1] = xf.inv(x1, y1)
  const [w2, n2] = xf.inv(x0, y1), [w3, s3] = xf.inv(x1, y0)
  const res = Math.abs(img.getResolution()[0])
  const nd = img.getGDALNoData()
  return { epsg, width: img.getWidth(), height: img.getHeight(), bands: img.getSamplesPerPixel(), resolutionM: xf.degrees ? res * 111_320 * Math.cos(((s0 + n1) / 2) * (Math.PI / 180)) : res, bboxWgs84: [Math.min(w0, w1, w2, w3), Math.min(s0, n1, n2, s3), Math.max(w0, w1, w2, w3), Math.max(s0, n1, n2, s3)], noData: nd == null || Number.isNaN(nd) ? null : nd }
}

export interface ReadOpts { sample?: number; resample?: 'bilinear' | 'nearest'; scale?: number; offset?: number; noData?: number | null; zeroIsNoData?: boolean; epsg?: number | null }

/** One band resampled onto the grid. NaN where the raster has no data or does not cover the cell. */
export async function readBandOnGrid(tiff: GeoTIFF, g: Grid, o: ReadOpts = {}): Promise<Float32Array> {
  const info = await describeTiff(tiff, o.epsg)
  const xf = transformFor(info.epsg)!
  const count = await tiff.getImageCount()
  const base = await tiff.getImage(0)
  const [minX, minY, maxX, maxY] = base.getBoundingBox()
  // the AOI in the raster's CRS (edges sampled, since UTM is not axis-aligned with lon/lat)
  let ax0 = Infinity, ay0 = Infinity, ax1 = -Infinity, ay1 = -Infinity
  for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) {
    const [x, y] = xf.fwd(g.bbox[0] + ((g.bbox[2] - g.bbox[0]) * i) / 8, g.bbox[1] + ((g.bbox[3] - g.bbox[1]) * j) / 8)
    ax0 = Math.min(ax0, x); ay0 = Math.min(ay0, y); ax1 = Math.max(ax1, x); ay1 = Math.max(ay1, y)
  }
  if (ax1 < minX || ax0 > maxX || ay1 < minY || ay0 > maxY) throw new AnalysisError('outside_footprint', 'The area of interest is outside this image.')
  // the coarsest overview that is still at least as fine as the analysis cell
  const toM = (res: number) => (xf.degrees ? res * 111_320 : res)
  let pick = 0
  for (let i = count - 1; i >= 0; i--) { const im = await tiff.getImage(i); if (toM(Math.abs(im.getResolution(base)[0])) <= g.cellM) { pick = i; break } }
  const img = await tiff.getImage(pick)
  const W = img.getWidth(), H = img.getHeight(), pw = (maxX - minX) / W, ph = (maxY - minY) / H
  const c0 = Math.max(0, Math.floor((ax0 - minX) / pw) - 1), c1 = Math.min(W, Math.ceil((ax1 - minX) / pw) + 1)
  const r0 = Math.max(0, Math.floor((maxY - ay1) / ph) - 1), r1 = Math.min(H, Math.ceil((maxY - ay0) / ph) + 1)
  if (c1 <= c0 || r1 <= r0) throw new AnalysisError('outside_footprint', 'The area of interest is outside this image.')
  const ww = c1 - c0, hh = r1 - r0
  const rasters = (await img.readRasters({ window: [c0, r0, c1, r1], samples: [o.sample ?? 0], interleave: false })) as unknown as ArrayLike<number>[]
  const data = rasters[0]
  const nd = o.noData !== undefined ? o.noData : info.noData
  const bad = (v: number) => !Number.isFinite(v) || (nd != null && v === nd) || (o.zeroIsNoData === true && v === 0)
  const scale = o.scale ?? 1, offset = o.offset ?? 0, out = new Float32Array(g.width * g.height).fill(NaN)
  const at = (c: number, r: number) => (c < 0 || r < 0 || c >= ww || r >= hh ? NaN : data[r * ww + c])
  for (let row = 0; row < g.height; row++)
    for (let col = 0; col < g.width; col++) {
      const lng = g.bbox[0] + (col + 0.5) * g.dLng, lat = g.bbox[3] - (row + 0.5) * g.dLat
      const [x, y] = xf.fwd(lng, lat)
      const fx = (x - minX) / pw - c0, fy = (maxY - y) / ph - r0 // continuous pixel coordinates (pixel i spans [i, i+1))
      if (fx < 0 || fy < 0 || fx >= ww || fy >= hh) continue
      const nearest = at(Math.floor(fx), Math.floor(fy))
      if (bad(nearest)) continue
      let v = nearest
      if (o.resample !== 'nearest') {
        const gx = fx - 0.5, gy = fy - 0.5, x0 = Math.floor(gx), y0 = Math.floor(gy), tx = gx - x0, ty = gy - y0
        const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1)
        if (!bad(a) && !bad(b) && !bad(c) && !bad(d)) v = a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty
      }
      out[row * g.width + col] = v * scale + offset
    }
  return out
}

/** Reads every sample of a small raster that already matches the grid exactly (provider-rendered output). */
export async function readAlignedSamples(tiff: GeoTIFF, g: Grid): Promise<Float32Array[]> {
  const img = await tiff.getImage(0)
  if (img.getWidth() !== g.width || img.getHeight() !== g.height) throw new AnalysisError('invalid_provider_response', `The provider returned a ${img.getWidth()}×${img.getHeight()} image, but ${g.width}×${g.height} was requested.`, 502)
  const r = (await img.readRasters({ interleave: false })) as unknown as ArrayLike<number>[]
  return r.map((a) => Float32Array.from(a as ArrayLike<number>))
}
