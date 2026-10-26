// The common analysis grid. Both dates are resampled onto this one WGS84 grid, so pixels line up by
// geographic position (not by array index) even when the source scenes differ in CRS or resolution.
import type { Bbox } from '../types'

export interface Grid { bbox: Bbox; width: number; height: number; cellM: number; dLng: number; dLat: number }

const M_PER_DEG_LAT = 111_320

/** Cell size = the coarser of the sources' nominal resolution and what keeps the grid within maxDim. */
export function makeGrid(bbox: Bbox, nativeResM: number, maxDim: number): Grid {
  const midLat = ((bbox[1] + bbox[3]) / 2) * (Math.PI / 180)
  const widthM = (bbox[2] - bbox[0]) * M_PER_DEG_LAT * Math.cos(midLat)
  const heightM = (bbox[3] - bbox[1]) * M_PER_DEG_LAT
  const cellM = Math.max(nativeResM, Math.max(widthM, heightM) / maxDim)
  const width = Math.max(1, Math.ceil(widthM / cellM)), height = Math.max(1, Math.ceil(heightM / cellM))
  return { bbox, width, height, cellM, dLng: (bbox[2] - bbox[0]) / width, dLat: (bbox[3] - bbox[1]) / height }
}

/** Centre of cell (col,row); row 0 is the northern edge. */
export const cellCenter = (g: Grid, col: number, row: number): [number, number] => [g.bbox[0] + (col + 0.5) * g.dLng, g.bbox[3] - (row + 0.5) * g.dLat]

function inRing(x: number, y: number, ring: number[][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** 1 where the cell centre lies inside the polygon (even-odd across rings, so holes work); all 1 for a plain box. */
export function insideMask(g: Grid, polygon: number[][][] | null): Uint8Array {
  const m = new Uint8Array(g.width * g.height)
  if (!polygon) return m.fill(1)
  for (let r = 0; r < g.height; r++)
    for (let c = 0; c < g.width; c++) {
      const [x, y] = cellCenter(g, c, r)
      let inside = false
      for (const ring of polygon) if (inRing(x, y, ring)) inside = !inside
      if (inside) m[r * g.width + c] = 1
    }
  return m
}

/** Area of one cell in km² (cells are square-ish at this scale). */
export const cellAreaKm2 = (g: Grid) => (g.cellM * g.cellM) / 1e6
