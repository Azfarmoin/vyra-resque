// Minimal Float32 GeoTIFF encoder (uncompressed, one strip, EPSG:4326) for TESTS and the sample-terrain script only.
// geotiff.js can read GeoTIFFs but its writer only handles 8-bit data, which is useless for elevations.
export interface F32Raster {
  width: number
  height: number
  data: Float32Array
  west: number
  north: number
  pixelDegX: number
  pixelDegY: number
  nodata?: number
}

export function encodeGeoTiffF32(r: F32Raster): Uint8Array {
  const entries: { tag: number; type: number; count: number; value: number[] | string }[] = []
  const SHORT = 3, LONG = 4, DOUBLE = 12, ASCII = 2
  const geoKeys = [1, 1, 0, 3, 1024, 0, 1, 2, 1025, 0, 1, 1, 2048, 0, 1, 4326]
  const stripBytes = r.data.byteLength
  const nodataStr = r.nodata != null ? `${r.nodata}\0` : null
  const defs: [number, number, number, number[] | string][] = [
    [256, LONG, 1, [r.width]], [257, LONG, 1, [r.height]], [258, SHORT, 1, [32]], [259, SHORT, 1, [1]], [262, SHORT, 1, [1]],
    [273, LONG, 1, [0]], // strip offset patched below
    [277, SHORT, 1, [1]], [278, LONG, 1, [r.height]], [279, LONG, 1, [stripBytes]], [339, SHORT, 1, [3]],
    [33550, DOUBLE, 3, [r.pixelDegX, r.pixelDegY, 0]], [33922, DOUBLE, 6, [0, 0, 0, r.west, r.north, 0]], [34735, SHORT, geoKeys.length, geoKeys],
  ]
  if (nodataStr) defs.push([42113, ASCII, nodataStr.length, nodataStr])
  defs.sort((a, b) => a[0] - b[0])
  for (const [tag, type, count, value] of defs) entries.push({ tag, type, count, value })
  const size = (t: number) => (t === SHORT ? 2 : t === LONG ? 4 : t === DOUBLE ? 8 : 1)
  const ifdSize = 2 + entries.length * 12 + 4
  let extra = 8 + ifdSize
  const extraOffsets = entries.map((e) => { const n = size(e.type) * e.count; if (n <= 4) return -1; const off = extra; extra += n + (n % 2); return off })
  const stripOffset = Math.ceil(extra / 4) * 4 // Float32 data must start on a 4-byte boundary
  const buf = new ArrayBuffer(stripOffset + stripBytes)
  const dv = new DataView(buf)
  dv.setUint16(0, 0x4949, true); dv.setUint16(2, 42, true); dv.setUint32(4, 8, true)
  dv.setUint16(8, entries.length, true)
  const write = (off: number, e: (typeof entries)[number]) => {
    if (typeof e.value === 'string') { for (let i = 0; i < e.value.length; i++) dv.setUint8(off + i, e.value.charCodeAt(i)); return }
    e.value.forEach((v, i) => {
      if (e.type === SHORT) dv.setUint16(off + i * 2, v, true)
      else if (e.type === LONG) dv.setUint32(off + i * 4, v, true)
      else dv.setFloat64(off + i * 8, v, true)
    })
  }
  entries.forEach((e, i) => {
    const o = 10 + i * 12
    dv.setUint16(o, e.tag, true); dv.setUint16(o + 2, e.type, true); dv.setUint32(o + 4, e.count, true)
    if (e.tag === 273) e.value = [stripOffset]
    if (extraOffsets[i] >= 0) { dv.setUint32(o + 8, extraOffsets[i], true); write(extraOffsets[i], e) } else write(o + 8, e)
  })
  dv.setUint32(10 + entries.length * 12, 0, true)
  new Float32Array(buf, stripOffset, r.data.length).set(r.data)
  return new Uint8Array(buf)
}
