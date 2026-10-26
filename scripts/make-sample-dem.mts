// Writes a SYNTHETIC terrain file so the flood simulator can be tried without real data.
//   npx tsx scripts/make-sample-dem.mts [outDir]        (default ./data/flood)
// The terrain is an invented tilted plain with a shallow channel and two closed basins near Clifton. IT IS NOT KARACHI.
// The sidecar file marks it synthetic, so every scenario that uses it says "SYNTHETIC terrain" in its data-quality panel and report.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { encodeGeoTiffF32 } from '../src/lib/flood/devtools/geotiffWriter'

const out = process.argv[2] || './data/flood'
const west = 66.95, north = 24.95, px = 0.0009 // about 100 m
const width = Math.round((67.15 - west) / px), height = Math.round((north - 24.75) / px)
const z = new Float32Array(width * height)
for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) {
  const lng = west + (c + 0.5) * px, lat = north - (r + 0.5) * px
  let h = 2 + (lat - 24.75) * 60 + (lng - west) * 10 // rises to the north-east
  h -= 2.5 * Math.exp(-(((lng - 67.03) / 0.004) ** 2)) * (lat < 24.86 ? 1 : 0) // a channel running north-south
  h -= 3 * Math.exp(-(((lng - 67.06) ** 2 + (lat - 24.83) ** 2) / 0.00006)) // closed basin
  h -= 2 * Math.exp(-(((lng - 67.09) ** 2 + (lat - 24.86) ** 2) / 0.00004)) // closed basin
  z[r * width + c] = h
}
mkdirSync(out, { recursive: true })
const path = join(out, 'SYNTHETIC-sample-dem.tif')
writeFileSync(path, encodeGeoTiffF32({ width, height, data: z, west, north, pixelDegX: px, pixelDegY: px }))
writeFileSync(`${path}.meta.json`, JSON.stringify({ name: 'SYNTHETIC SAMPLE TERRAIN (not real)', synthetic: true, vintage: 'invented', datum: 'none', verticalErrorM: null }, null, 2))
console.log(`Wrote ${path} (${width}x${height}). Use it with FLOOD_DEM_PATH=${path}. It is invented data for trying the tool only.`)
