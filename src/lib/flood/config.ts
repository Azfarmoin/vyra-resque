// Flood simulator configuration, read from environment variables. Nothing is configured by default: with no DEM and no data
// files the simulator still offers the hypothetical overlay and says plainly what else is missing.
export interface FloodConfig {
  enabled: boolean
  demPath: string | null
  demName: string | null
  demKind: 'dtm' | 'dsm' | 'dem' | 'unknown'
  demVintage: string | null
  demVerticalErrorM: number | null
  demDatum: string | null
  openMeteoEnabled: boolean
  openMeteoElevationUrl: string
  openMeteoForecastUrl: string
  overpassEnabled: boolean
  overpassUrl: string
  roadsPath: string | null
  buildingsPath: string | null
  hospitalsPath: string | null
  drainagePath: string | null
  assetStaleDays: number
  allowAnyRegion: boolean
  maxAreaKm2: number
  maxCells: number
  providerTimeoutMs: number
}

type Env = Record<string, string | undefined>
const num = (v: string | undefined): number | null => {
  if (v == null || v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const str = (v: string | undefined) => (v && v.trim() ? v.trim() : null)
const flag = (v: string | undefined, dflt: boolean) => (v == null || v.trim() === '' ? dflt : /^(1|true|yes|on)$/i.test(v.trim()))

export function floodConfig(env: Env = process.env): FloodConfig {
  const kind = (str(env.FLOOD_DEM_KIND) || 'unknown').toLowerCase()
  return {
    enabled: flag(env.FLOOD_SIMULATOR_ENABLED, true),
    demPath: str(env.FLOOD_DEM_PATH),
    demName: str(env.FLOOD_DEM_NAME),
    demKind: kind === 'dtm' || kind === 'dsm' || kind === 'dem' ? kind : 'unknown',
    demVintage: str(env.FLOOD_DEM_VINTAGE),
    demVerticalErrorM: num(env.FLOOD_DEM_VERTICAL_ERROR_M),
    demDatum: str(env.FLOOD_DEM_DATUM),
    // Opt-in: the free Open-Meteo API is for non-commercial use and sends coordinates to a third party.
    openMeteoEnabled: flag(env.FLOOD_OPEN_METEO_ENABLED, false),
    openMeteoElevationUrl: str(env.FLOOD_OPEN_METEO_ELEVATION_URL) || 'https://api.open-meteo.com/v1/elevation',
    openMeteoForecastUrl: str(env.FLOOD_OPEN_METEO_FORECAST_URL) || 'https://api.open-meteo.com/v1/forecast',
    overpassEnabled: flag(env.FLOOD_OVERPASS_ENABLED, false),
    overpassUrl: str(env.FLOOD_OVERPASS_URL) || 'https://overpass-api.de/api/interpreter',
    roadsPath: str(env.FLOOD_ROADS_PATH),
    buildingsPath: str(env.FLOOD_BUILDINGS_PATH),
    hospitalsPath: str(env.FLOOD_HOSPITALS_PATH),
    drainagePath: str(env.FLOOD_DRAINAGE_PATH),
    assetStaleDays: Math.max(1, num(env.FLOOD_ASSET_STALE_DAYS) ?? 365),
    allowAnyRegion: flag(env.FLOOD_ALLOW_ANY_REGION, false),
    maxAreaKm2: Math.max(1, num(env.FLOOD_MAX_AREA_KM2) ?? 300),
    maxCells: Math.min(400_000, Math.max(1000, num(env.FLOOD_MAX_CELLS) ?? 160_000)),
    providerTimeoutMs: Math.max(1000, num(env.FLOOD_PROVIDER_TIMEOUT_MS) ?? 15_000),
  }
}

// Karachi division, with a generous margin. The operational areas, datasets and data-quality notes in VYRA are Karachi specific.
export const KARACHI_BBOX: [number, number, number, number] = [66.6, 24.7, 67.6, 25.6]
