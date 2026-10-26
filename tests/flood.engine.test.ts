// Geographic calculations and the engine: grids, polygons, bathtub connectivity, ponding volume, GeoTIFF reading, packing.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bathtub, rainfallPonding, summarise, uniformOverlay } from '../src/lib/flood/engine'
import { GeoTiffElevationProvider } from '../src/lib/flood/elevation'
import { GridField, gridToBandRects, packGrid, unpackGrid } from '../src/lib/flood/field'
import { cellOf, circlePolygon, makeGridSpec, rasterizeArea, rectanglePolygon, samplePolyline, simplifyPath, validateArea, polylineLengthM, distanceM } from '../src/lib/flood/geo'
import { bandIndexFor } from '../src/lib/flood/types'
import { cfg, writeTestTiff } from './helpers/flood'

const accept = { maxAreaKm2: 300, allowAnyRegion: false }

test('grid: cells tile the box exactly and the cell size honours the cell cap', () => {
  const s = makeGridSpec([67.0, 24.8, 67.1, 24.9], 30, 160_000)
  assert.ok(s.nx * s.ny <= 160_000 * 1.05)
  assert.ok(Math.abs(s.bbox[0] + s.nx * s.dxDeg - s.bbox[2]) < 1e-9)
  const coarse = makeGridSpec([66.8, 24.6, 67.4, 25.2], 10, 2500)
  assert.ok(coarse.nx * coarse.ny <= 2600, 'cap forces a coarser cell')
  assert.ok(coarse.cellWM > 100)
  // 1 degree of latitude is ~111 km
  assert.ok(Math.abs(s.cellHM * s.ny - 11132) < 5)
})

test('rasterize: a circle covers pi r^2 within 3%, holes are excluded', () => {
  const centre: [number, number] = [24.86, 67.03]
  const poly = circlePolygon(centre, 2000)
  const spec = makeGridSpec([67.0, 24.83, 67.06, 24.89], 20, 160_000)
  const mask = rasterizeArea(poly, spec)
  const cells = mask.reduce((a, b) => a + b, 0)
  const area = cells * spec.cellWM * spec.cellHM
  assert.ok(Math.abs(area - Math.PI * 2000 ** 2) / (Math.PI * 2000 ** 2) < 0.03, `area ${area}`)
  type P = { coordinates: [number, number][][] }
  const withHole = { type: 'Polygon' as const, coordinates: [(poly as P).coordinates[0], (circlePolygon(centre, 1000) as P).coordinates[0].slice().reverse()] }
  const m2 = rasterizeArea(withHole, spec)
  const area2 = m2.reduce((a, b) => a + b, 0) * spec.cellWM * spec.cellHM
  assert.ok(Math.abs(area2 - Math.PI * (2000 ** 2 - 1000 ** 2)) / (Math.PI * 3000000) < 0.05)
})

test('geometry: distance, line length, sampling and simplification', () => {
  const a: [number, number] = [24.86, 67.0]
  const b: [number, number] = [24.86, 67.01]
  assert.ok(Math.abs(distanceM(a, b) - 1010) < 15, 'about 1 km east at this latitude')
  const path: [number, number][] = [a, b, [24.87, 67.01]]
  const len = polylineLengthM(path)
  const samples = samplePolyline(path, 25)
  assert.ok(Math.abs(samples.reduce((s, x) => s + x.segmentM, 0) - len) < 1e-6, 'sample lengths add up to the line length')
  assert.ok(samples.every((x) => x.segmentM <= 25.0001))
  const wiggly: [number, number][] = Array.from({ length: 50 }, (_, i) => [24.86 + i * 0.0001, 67.0 + (i % 2) * 0.000001])
  assert.ok(simplifyPath(wiggly, 5).length < 5)
})

test('invalid coordinates are rejected with a clear message', () => {
  const bad = (g: unknown) => assert.throws(() => validateArea(g, accept), (e: { code?: string }) => ['invalid_coordinates', 'invalid_area', 'outside_region', 'area_too_small', 'area_too_large'].includes(e.code ?? ''))
  bad(null)
  bad({ type: 'Point', coordinates: [67, 24.8] })
  bad({ type: 'Polygon', coordinates: [[[67, 95], [67.1, 95], [67.1, 96], [67, 95]]] }) // lat 95
  bad({ type: 'Polygon', coordinates: [[[200, 24.8], [201, 24.8], [201, 24.9], [200, 24.8]]] }) // lng 200
  bad({ type: 'Polygon', coordinates: [[[67, NaN], [67.1, 24.8], [67.1, 24.9], [67, NaN]]] })
  // swapped lat/lng is a valid latitude (67 N) but nowhere near Karachi: the region check catches it
  assert.throws(() => validateArea({ type: 'Polygon', coordinates: [[[24.8, 67], [24.9, 67], [24.9, 67.1], [24.8, 67]]] }, accept), /outside the Karachi region/)
  // ...and a swap that produces an impossible latitude gets the specific message
  assert.throws(() => validateArea({ type: 'Polygon', coordinates: [[[24.8, 167], [24.9, 167], [24.9, 167.1], [24.8, 167]]] }, accept), /Latitude 167 is outside -90 to 90/)
  // bow-tie
  assert.throws(() => validateArea({ type: 'Polygon', coordinates: [[[67.0, 24.80], [67.02, 24.82], [67.02, 24.80], [67.0, 24.82], [67.0, 24.80]]] }, accept), /not a valid polygon/)
  // far away
  assert.throws(() => validateArea(rectanglePolygon([-0.2, 51.4, -0.1, 51.5]), accept), (e: { code?: string }) => e.code === 'outside_region')
  assert.doesNotThrow(() => validateArea(rectanglePolygon([-0.2, 51.4, -0.1, 51.5]), { ...accept, allowAnyRegion: true }))
  // size limits
  assert.throws(() => validateArea(rectanglePolygon([67.0, 24.8, 67.0005, 24.8005]), accept), (e: { code?: string }) => e.code === 'area_too_small')
  assert.throws(() => validateArea(rectanglePolygon([66.7, 24.8, 67.5, 25.5]), accept), (e: { code?: string }) => e.code === 'area_too_large')
  // an open ring is closed for the user
  const v = validateArea({ type: 'Polygon', coordinates: [[[67.0, 24.80], [67.02, 24.80], [67.02, 24.82], [67.0, 24.82]]] }, accept)
  assert.deepEqual(v.area.coordinates[0][0], v.area.coordinates[0].at(-1))
})

test('uniform overlay: every cell inside the area has the typed depth, outside is not assessed', () => {
  const mask = new Uint8Array([1, 1, 0, 1])
  const r = uniformOverlay(mask, 0.6)
  assert.deepEqual([...r.depth.map((d) => (Number.isNaN(d) ? -1 : d))].map((x) => Math.round(x * 10) / 10), [0.6, 0.6, -1, 0.6])
})

// A 5x5 grid, 1 cell = ~100 m. Ground is 5 m everywhere except a 3x1 low channel (0 m) along row 2 and a separate pit at (0,0).
const tiny = () => {
  const spec = { bbox: [67, 24.8, 67.005, 24.805] as [number, number, number, number], nx: 5, ny: 5, dxDeg: 0.001, dyDeg: 0.001, cellWM: 100, cellHM: 100 }
  const z = new Float32Array(25).fill(5)
  for (let c = 0; c < 4; c++) z[2 * 5 + c] = 0 // channel from the west edge, row 2, cols 0..3
  z[0] = 0 // isolated pit in the north-west corner
  return { spec, z, mask: new Uint8Array(25).fill(1) }
}
const lat = (spec: { bbox: number[] }, row: number, ny = 5) => spec.bbox[3] - ((row + 0.5) * (spec.bbox[3] - spec.bbox[1])) / ny
const lng = (spec: { bbox: number[] }, col: number, nx = 5) => spec.bbox[0] + ((col + 0.5) * (spec.bbox[2] - spec.bbox[0])) / nx

test('bathtub: connectivity floods the channel but not the isolated pit; without it both flood', () => {
  const { spec, z, mask } = tiny()
  const seeded = bathtub(z, mask, spec, { waterLevelM: 1, connectivity: 'seeded', seeds: [[lat(spec, 2), lng(spec, 0)]] })
  assert.equal(seeded.depth[2 * 5 + 0], 1)
  assert.equal(seeded.depth[2 * 5 + 3], 1)
  assert.equal(seeded.depth[0], 0, 'the pit is lower than the water level but not connected to the source')
  assert.equal(seeded.depth[2 * 5 + 4], 0, 'higher ground stays dry')
  const free = bathtub(z, mask, spec, { waterLevelM: 1, connectivity: 'none', seeds: [] })
  assert.equal(free.depth[0], 1, 'no connectivity floods the pit as well')
})

test('bathtub: a source point on high ground or off the grid floods nothing and says why', () => {
  const { spec, z, mask } = tiny()
  const high = bathtub(z, mask, spec, { waterLevelM: 1, connectivity: 'seeded', seeds: [[lat(spec, 4), lng(spec, 4)]] })
  assert.ok(high.depth.every((d) => d === 0))
  assert.ok(high.warnings.some((w) => /not below the water level/.test(w)))
  const off = bathtub(z, mask, spec, { waterLevelM: 1, connectivity: 'seeded', seeds: [[10, 10]] })
  assert.ok(off.warnings.some((w) => /outside the working grid/.test(w)) && off.warnings.some((w) => /No usable source/.test(w)))
})

test('bathtub: terrain gaps are "not assessed", never dry', () => {
  const { spec, z, mask } = tiny()
  z[2 * 5 + 1] = NaN
  const r = bathtub(z, mask, spec, { waterLevelM: 1, connectivity: 'none', seeds: [] })
  assert.ok(Number.isNaN(r.depth[2 * 5 + 1]))
  const s = summarise(r.depth, spec, 25, 0.1)
  assert.equal(s.assessedCells, 24)
})

test('ponding: conserves volume exactly and fills the lowest ground first', () => {
  const { spec, z, mask } = tiny()
  // 25 cells x 100 m x 100 m. 20 mm effective over the area = 25 x 10000 x 0.02 = 5000 m3.
  const r = rainfallPonding(z, mask, spec, { rainfallMm: 25, runoffCoefficient: 1, drainageCapacityMm: 5, infiltrationMm: 0 })
  assert.equal(Math.round(r.info.effectiveMm), 20)
  let vol = 0
  for (const d of r.depth) vol += d * 100 * 100
  assert.ok(Math.abs(vol - 5000) < 1, `stored ${vol} m3`)
  assert.ok(r.depth[2 * 5 + 0] > r.depth[4 * 5 + 4], 'low cells hold the water')
  assert.equal(r.depth[4 * 5 + 4], 0)
})

test('ponding: drainage and infiltration that absorb all the rain leave nothing, with a warning', () => {
  const { spec, z, mask } = tiny()
  const r = rainfallPonding(z, mask, spec, { rainfallMm: 30, runoffCoefficient: 0.5, drainageCapacityMm: 20, infiltrationMm: 0 })
  assert.equal(r.info.effectiveMm, 0)
  assert.ok(r.depth.every((d) => d === 0))
  assert.ok(r.warnings.some((w) => /nothing floods/.test(w)))
})

test('summary: areas, depth statistics and volume agree with the cell counts', () => {
  const { spec, z, mask } = tiny()
  const r = bathtub(z, mask, spec, { waterLevelM: 1, connectivity: 'none', seeds: [] })
  const s = summarise(r.depth, spec, 25, 0.1)
  // 4 channel cells + 1 pit
  assert.equal(s.floodedAreaKm2, 0.05)
  assert.equal(s.maxDepthM, 1)
  assert.equal(s.volumeM3, 5 * 100 * 100 * 1)
  assert.equal(s.bandAreasKm2.b4, 0.05) // depth exactly 1.0 falls in the 1.0 to 2.0 band
  assert.equal(bandIndexFor(0.05), -1)
  assert.equal(bandIndexFor(0.1), 0)
  assert.equal(bandIndexFor(2.5), 4)
})

test('packing: depth grid round-trips to the centimetre and keeps "not assessed"', () => {
  const { spec, z, mask } = tiny()
  z[7] = NaN
  const r = bathtub(z, mask, spec, { waterLevelM: 1.234, connectivity: 'none', seeds: [] })
  const packed = packGrid(spec, r.depth)
  const back = unpackGrid(packed)
  assert.equal(back.depth.length, 25)
  assert.ok(Number.isNaN(back.depth[7]))
  assert.ok(Math.abs(back.depth[10] - 1.23) < 0.006)
  const f = new GridField(back.spec, back.depth)
  assert.equal(f.depthAt(lat(spec, 99 > 0 ? 2 : 0), lng(spec, 0)) !== null, true)
  assert.equal(f.depthAt(40, 67), null, 'outside the grid is unknown, not dry')
})

test('band rectangles: merged cells cover exactly the flooded cells', () => {
  const { spec, z, mask } = tiny()
  const r = bathtub(z, mask, spec, { waterLevelM: 1, connectivity: 'none', seeds: [] })
  const rects = gridToBandRects(spec, r.depth, (d) => bandIndexFor(d))
  const covered = rects.reduce((n, q) => n + (q.col1 - q.col0 + 1) * (q.row1 - q.row0 + 1), 0)
  assert.equal(covered, 5)
  assert.ok(rects.length <= 2)
})

test('GeoTIFF provider: reads a real file, returns heights, honours nodata and reports metadata', async () => {
  const path = writeTestTiff({ west: 67.0, north: 24.9, width: 100, height: 100, px: 0.001, fill: (c, r) => (c === 50 && r === 50 ? -9999 : c * 0.1), nodata: -9999 })
  const p = new GeoTiffElevationProvider(path, cfg())
  const meta = await p.prepare()
  assert.equal(meta.synthetic, true)
  assert.ok(meta.nativeResolutionM! > 100 && meta.nativeResolutionM! < 112, `native ${meta.nativeResolutionM}`)
  assert.equal(await p.covers([67.01, 24.81, 67.05, 24.85]), true)
  assert.equal(await p.covers([66.0, 24.81, 67.05, 24.85]), false)
  const spec = makeGridSpec([67.04, 24.84, 67.06, 24.86], 100, 160_000)
  const g = await p.fetchGrid(spec)
  assert.equal(g.z.length, spec.nx * spec.ny)
  assert.ok(Math.abs(g.z[0] - 4.0) < 0.6, `first cell ${g.z[0]}`)
  assert.ok(g.z.every((v) => Number.isFinite(v) || Number.isNaN(v)))
  // an area partly outside the file is refused, not silently padded
  await assert.rejects(() => p.fetchGrid(makeGridSpec([66.95, 24.84, 67.06, 24.86], 100, 160_000)), (e: { code?: string }) => e.code === 'dem_coverage')
  // nodata cell is NaN
  const specAll = makeGridSpec([67.049, 24.849, 67.051, 24.851], 50, 160_000)
  const gz = await p.fetchGrid(specAll)
  assert.ok([...gz.z].some((v) => Number.isNaN(v)), 'void becomes NaN')
})

test('GeoTIFF provider: missing or corrupt file is a clear, non-fatal provider error', async () => {
  const missing = new GeoTiffElevationProvider('/definitely/not/here.tif', cfg())
  await assert.rejects(() => missing.fetchGrid(makeGridSpec([67, 24.8, 67.1, 24.9], 100, 1000)), (e: { code?: string; status?: number }) => e.code === 'dem_unreadable' && e.status === 503)
  assert.equal(await missing.covers([67, 24.8, 67.1, 24.9]), false)
})
