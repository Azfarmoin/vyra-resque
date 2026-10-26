// Marker clustering and label collision avoidance for the map. Pure, so they are unit-tested.

export interface ClusterPoint { id: string; lat: number; lng: number }
export interface Cluster { lat: number; lng: number; count: number; ids: string[] }

const worldPx = (zoom: number) => 256 * 2 ** zoom
function project(lat: number, lng: number, zoom: number): [number, number] {
  const s = Math.sin((Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180)
  return [((lng + 180) / 360) * worldPx(zoom), (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * worldPx(zoom)]
}

/**
 * Grid clustering in screen space. Points that share a `cellPx` square at this zoom collapse into one
 * cluster. Below `minToCluster` points, or at a close zoom, nothing is clustered so single markers stay tappable.
 */
export function clusterPoints(points: ClusterPoint[], zoom: number, { cellPx = 56, minToCluster = 40, maxZoom = 15 } = {}): { singles: ClusterPoint[]; clusters: Cluster[] } {
  if (points.length < minToCluster || zoom >= maxZoom) return { singles: points, clusters: [] }
  const cells = new Map<string, ClusterPoint[]>()
  for (const p of points) {
    const [x, y] = project(p.lat, p.lng, zoom)
    const key = `${Math.floor(x / cellPx)}:${Math.floor(y / cellPx)}`
    const cell = cells.get(key)
    if (cell) cell.push(p)
    else cells.set(key, [p])
  }
  const singles: ClusterPoint[] = []
  const clusters: Cluster[] = []
  for (const cell of cells.values()) {
    if (cell.length === 1) singles.push(cell[0])
    else clusters.push({ lat: cell.reduce((s, p) => s + p.lat, 0) / cell.length, lng: cell.reduce((s, p) => s + p.lng, 0) / cell.length, count: cell.length, ids: cell.map((p) => p.id) })
  }
  return { singles, clusters }
}

export interface LabelCandidate { id: string; x: number; y: number; w: number; h: number; priority: number }

/** Greedy label placement: highest priority first, skip any label that would overlap one already placed. */
export function placeLabels(candidates: LabelCandidate[], gap = 4): Set<string> {
  const placed: LabelCandidate[] = []
  const shown = new Set<string>()
  for (const c of [...candidates].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))) {
    const overlaps = placed.some((p) => Math.abs(c.x - p.x) * 2 < c.w + p.w + gap && Math.abs(c.y - p.y) * 2 < c.h + p.h + gap)
    if (!overlaps) { placed.push(c); shown.add(c.id) }
  }
  return shown
}

/** Higher = more important to label. Danger and official information win ties. */
export const labelPriority = (zoneType: string, verification: string, severity: string) =>
  ({ danger: 60, evacuation: 50, restricted: 30, elevated: 40, caution: 20, shelter: 35 }[zoneType] ?? 0) +
  ({ official: 8, human_verified: 4, unverified: 0, ai_suggested: 0 }[verification] ?? 0) +
  ({ extreme: 4, high: 3, moderate: 2, low: 1, unknown: 0 }[severity] ?? 0)
