// Minimal PNG writer (RGBA, 8 bit) on node:zlib, plus renderers for the previews and the change overlay.
import { deflateSync } from 'node:zlib'
import { CLASS, CLASS_COLORS } from '../types'

const crcTable = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 }
  return t
})()
const crc32 = (buf: Uint8Array) => { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  Buffer.from(data.buffer, data.byteOffset, data.length).copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

export function encodePng(rgba: Uint8Array, width: number, height: number): Buffer {
  if (rgba.length !== width * height * 4) throw new Error('PNG buffer size does not match the dimensions')
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) { raw[y * (width * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1) }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array(0))])
}

const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]

/** Transparent where nothing changed; grey where there was no usable data, so unknown is never drawn as "no change". */
export function renderChangePng(classes: Uint8Array, width: number, height: number, inside: Uint8Array): Buffer {
  const rgba = new Uint8Array(width * height * 4)
  for (let i = 0; i < classes.length; i++) {
    if (!inside[i]) continue
    const c = classes[i]
    if (c === CLASS.STABLE_LAND || c === CLASS.STABLE_WATER) continue
    const [r, g, b] = hex(CLASS_COLORS[c])
    rgba.set([r, g, b, c === CLASS.MASKED ? 70 : 215], i * 4)
  }
  return encodePng(rgba, width, height)
}

const clamp8 = (v: number) => Math.max(0, Math.min(255, Math.round(v)))
/** Natural-colour preview. Clouds stay visible on purpose; only missing data is transparent. */
export function renderOpticalPng(r: Float32Array, g: Float32Array, b: Float32Array | undefined, width: number, height: number, inside: Uint8Array): Buffer {
  const rgba = new Uint8Array(width * height * 4)
  const s = (v: number) => clamp8(255 * Math.pow(Math.max(0, v) / 0.3, 1 / 1.8))
  for (let i = 0; i < r.length; i++) {
    if (!inside[i] || !Number.isFinite(r[i]) || !Number.isFinite(g[i])) continue
    rgba.set([s(r[i]), s(g[i]), s(b && Number.isFinite(b[i]) ? b[i] : g[i]), 255], i * 4)
  }
  return encodePng(rgba, width, height)
}
/** Grey backscatter preview in dB (-25 dB dark ... 0 dB bright). */
export function renderSarPng(db: Float32Array, width: number, height: number, inside: Uint8Array): Buffer {
  const rgba = new Uint8Array(width * height * 4)
  for (let i = 0; i < db.length; i++) {
    if (!inside[i] || !Number.isFinite(db[i])) continue
    const v = clamp8(((db[i] + 25) / 25) * 255)
    rgba.set([v, v, v, 255], i * 4)
  }
  return encodePng(rgba, width, height)
}
