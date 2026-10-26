// VYRA internal risk ESTIMATES from Open-Meteo model forecasts (https://open-meteo.com/).
// Used only where no official alert feed is configured for a place. Hard rules:
//   - origin is always "internal_estimate" and the UI labels it "VYRA estimate - not an official warning"
//   - severity is capped at "watch"; an estimate can never become a Warning or Emergency
//   - estimates never trigger push notifications (see ingest.ts)
// Thresholds below are illustrative defaults, NOT meteorological-service criteria. They are documented in
// docs/EARLY_WARNING.md and can be tuned per deployment with ALERT_ESTIMATE_THRESHOLDS (JSON).

import { slug, type AlertProvider, type ProviderContext, type ProviderResult, type RejectedItem } from './types'
import type { AlertCandidate, HazardType, Severity } from '../types'

export interface Thresholds {
  rainInfoMm: number // daily total
  rainWatchMm: number
  heatInfoC: number // daily maximum apparent temperature
  heatWatchC: number // reached on every one of the forecast days
  gustInfoKmh: number
  gustWatchKmh: number
}
export const DEFAULT_THRESHOLDS: Thresholds = { rainInfoMm: 50, rainWatchMm: 100, heatInfoC: 41, heatWatchC: 41, gustInfoKmh: 75, gustWatchKmh: 100 }

export interface MonitorPoint { name: string; lat: number; lng: number }
const CIRCLE_KM = 20 // the estimate describes the forecast cell around the point, not a street

interface Daily { time: string[]; precipitation_sum: (number | null)[]; apparent_temperature_max: (number | null)[]; wind_gusts_10m_max: (number | null)[] }

// Pure rule evaluation, exported for tests.
export function evaluateDaily(d: Daily, t: Thresholds): { hazard: HazardType; severity: Severity; peak: number; unit: string; lastDay: string; days: number }[] {
  const out: { hazard: HazardType; severity: Severity; peak: number; unit: string; lastDay: string; days: number }[] = []
  const pick = (vals: (number | null)[], min: number) => vals.map((v, i) => ({ v, i })).filter((x) => x.v != null && (x.v as number) >= min)

  const rain = pick(d.precipitation_sum, t.rainInfoMm)
  if (rain.length) {
    const peak = Math.max(...rain.map((x) => x.v as number))
    out.push({ hazard: 'heavy_rain', severity: peak >= t.rainWatchMm ? 'watch' : 'information', peak, unit: 'mm in a day', lastDay: d.time[rain[rain.length - 1].i], days: rain.length })
  }
  const heat = pick(d.apparent_temperature_max, t.heatInfoC)
  if (heat.length) {
    const peak = Math.max(...heat.map((x) => x.v as number))
    const allDays = heat.length === d.time.length && d.time.length >= 3
    out.push({ hazard: 'heatwave', severity: allDays && peak >= t.heatWatchC ? 'watch' : 'information', peak, unit: '°C feels-like maximum', lastDay: d.time[heat[heat.length - 1].i], days: heat.length })
  }
  const gust = pick(d.wind_gusts_10m_max, t.gustInfoKmh)
  if (gust.length) {
    const peak = Math.max(...gust.map((x) => x.v as number))
    out.push({ hazard: 'thunderstorm_wind', severity: peak >= t.gustWatchKmh ? 'watch' : 'information', peak, unit: 'km/h gusts', lastDay: d.time[gust[gust.length - 1].i], days: gust.length })
  }
  return out
}

function readPoints(env: Record<string, string | undefined>): MonitorPoint[] {
  try {
    const arr = JSON.parse(env.ALERT_MONITOR_POINTS || '[]')
    return (Array.isArray(arr) ? arr : []).filter((p) => p && typeof p.name === 'string' && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180).slice(0, 25)
  } catch { return [] }
}
function readThresholds(env: Record<string, string | undefined>): Thresholds {
  try { return { ...DEFAULT_THRESHOLDS, ...JSON.parse(env.ALERT_ESTIMATE_THRESHOLDS || '{}') } } catch { return DEFAULT_THRESHOLDS }
}

export function createOpenMeteoProvider(env: Record<string, string | undefined> = process.env): AlertProvider {
  const points = readPoints(env)
  const thresholds = readThresholds(env)
  const base = env.ALERT_OPEN_METEO_URL || 'https://api.open-meteo.com/v1/forecast'
  const enabled = env.ALERT_OPEN_METEO_ENABLED === 'true'
  const reason = !enabled ? 'Disabled. Set ALERT_OPEN_METEO_ENABLED=true to produce labelled forecast-based estimates.' : !points.length ? 'No monitor points: set ALERT_MONITOR_POINTS (JSON list of {name, lat, lng}).' : null
  return {
    id: 'open-meteo-estimates',
    name: 'VYRA forecast-based estimates (Open-Meteo)',
    origin: 'internal_estimate',
    minIntervalMinutes: 60,
    staleAfterMinutes: 240,
    snapshot: true,
    unconfiguredReason: reason,
    docs: {
      feedUrl: base,
      docsUrl: 'https://open-meteo.com/en/docs',
      coverage: 'Global model forecasts, evaluated only at the points you configure',
      hazards: ['heavy_rain', 'heatwave', 'thunderstorm_wind'],
      updateFrequency: 'Forecast models update several times a day; VYRA polls hourly',
      authentication: 'None for the free non-commercial API. Commercial use needs an Open-Meteo subscription key (set ALERT_OPEN_METEO_URL to the customer endpoint).',
      limitations: 'Model output is not an official forecast or warning. Point values can miss local extremes. Thresholds are illustrative defaults. Estimates are capped at "Watch", labelled as VYRA estimates, and never sent as push notifications.',
    },
    async fetchAlerts(ctx: ProviderContext): Promise<ProviderResult> {
      const q = new URLSearchParams({
        latitude: points.map((p) => p.lat).join(','),
        longitude: points.map((p) => p.lng).join(','),
        daily: 'precipitation_sum,apparent_temperature_max,wind_gusts_10m_max',
        forecast_days: '3',
        timezone: 'UTC',
      })
      const parsed = JSON.parse(await ctx.fetchText(`${base}?${q}`)) as unknown
      const results = (Array.isArray(parsed) ? parsed : [parsed]) as { daily?: Daily }[]
      if (results.length !== points.length) throw new Error('Forecast response did not match the requested points')
      const candidates: AlertCandidate[] = []
      const rejected: RejectedItem[] = []
      results.forEach((r, i) => {
        const pt = points[i]
        const d = r?.daily
        if (!d || !Array.isArray(d.time) || !d.time.length) { rejected.push({ kind: 'malformed', detail: `No daily data for ${pt.name}`, externalId: null }); return }
        for (const e of evaluateDaily(d, thresholds)) {
          const expires = new Date(`${e.lastDay}T23:59:00Z`)
          if (!Number.isFinite(expires.getTime())) { rejected.push({ kind: 'invalid_timestamp', detail: 'Bad forecast date', externalId: null }); continue }
          const nowIso = new Date(ctx.now).toISOString()
          const label = e.hazard === 'heavy_rain' ? 'Heavy rain' : e.hazard === 'heatwave' ? 'High heat' : 'Strong gusts'
          candidates.push({
            provider: 'open-meteo-estimates',
            external_alert_id: `${e.hazard}:${slug(pt.name)}`,
            origin: 'internal_estimate',
            hazard_type: e.hazard,
            severity: e.severity,
            status: 'active',
            title: `${label} possible near ${pt.name} (VYRA estimate)`,
            description: `VYRA's rule-based estimate from model forecast data suggests values up to about ${Math.round(e.peak)} ${e.unit} on ${e.days} of the next 3 days. This is NOT an official warning and may be wrong. Check your national weather service for official warnings.`,
            instruction: null,
            affected_area: `Around ${pt.name} (about ${CIRCLE_KM} km)`,
            areas: [{ description: `Around ${pt.name}`, geometry: [{ type: 'circle', center: [pt.lat, pt.lng], radiusKm: CIRCLE_KM }], geocodes: [] }],
            source_url: 'https://open-meteo.com/',
            source_name: 'VYRA estimate from Open-Meteo forecast data',
            issued_at: nowIso,
            starts_at: null,
            expires_at: expires.toISOString(),
            last_updated_at: nowIso,
            source_severity: null,
            raw_source_metadata: { peak: e.peak, unit: e.unit, thresholds },
            limitations: ['Internal estimate from model data, not an official forecast.', 'Severity is capped at Watch by design.'],
            created_by: null,
          })
        }
      })
      return { candidates, rejected }
    },
  }
}
