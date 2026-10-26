import { NextRequest, NextResponse } from 'next/server'
import { AREAS } from '@/lib/constants'
import { floodConfig, KARACHI_BBOX } from '@/lib/flood/config'
import { DEPTH_BANDS, TIERS } from '@/lib/flood/types'
import { guard } from '@/lib/flood/http'

export const dynamic = 'force-dynamic'

// GET /api/flood/config - what the simulator can and cannot do on THIS server, so the UI never offers what is not configured.
export async function GET(request: NextRequest) {
  const g = await guard(request)
  if (!g.ok) return g.res
  const c = floodConfig()
  const terrain = !!c.demPath || c.openMeteoEnabled
  return NextResponse.json({
    isEstimate: true,
    role: g.user.role,
    tiers: TIERS,
    bands: DEPTH_BANDS,
    areas: AREAS,
    region: { bbox: KARACHI_BBOX, anyRegionAllowed: c.allowAnyRegion },
    limits: { maxAreaKm2: c.maxAreaKm2, maxCells: c.maxCells },
    capabilities: {
      hypothetical_overlay: { available: true },
      terrain_bathtub: { available: terrain, reason: terrain ? null : 'No elevation data is configured (FLOOD_DEM_PATH or FLOOD_OPEN_METEO_ENABLED).' },
      terrain_rainfall: { available: terrain, reason: terrain ? null : 'No elevation data is configured (FLOOD_DEM_PATH or FLOOD_OPEN_METEO_ENABLED).' },
      imported_hydraulic: { available: g.user.role === 'admin', reason: g.user.role === 'admin' ? null : 'Only administrators can import hydraulic model output.' },
    },
    sources: {
      elevation: c.demPath ? 'local GeoTIFF' : c.openMeteoEnabled ? 'Open-Meteo (Copernicus 90 m)' : null,
      elevationApi: c.openMeteoEnabled,
      rainfallApi: c.openMeteoEnabled,
      roads: c.roadsPath ? 'file' : c.overpassEnabled ? 'OpenStreetMap (live)' : null,
      buildings: c.buildingsPath ? 'file' : c.overpassEnabled ? 'OpenStreetMap (live)' : null,
      hospitals: c.hospitalsPath ? 'file' : c.overpassEnabled ? 'OpenStreetMap (live)' : null,
      drainage: c.drainagePath ? 'file' : null,
    },
  }, { headers: { 'Cache-Control': 'no-store' } })
}
