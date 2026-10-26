// Rainfall input. Two sources: a number a person typed in, or Open-Meteo hourly precipitation for a window.
// Open-Meteo values are weather-MODEL output (analysis for the past, forecast for the future) sampled at ONE point. They are
// not rain-gauge observations and they do not capture street-scale storm cells. The result says so.
import { ProviderError } from './elevation'
import type { FloodConfig } from './config'
import type { LatLng } from './types'

export interface RainfallResult {
  totalMm: number
  durationHours: number
  kind: 'manual' | 'model_gridded'
  sourceName: string
  windowStart: string | null
  windowEnd: string | null
  asOf: string | null
  notes: string[]
}

export interface RainfallProvider {
  total(point: LatLng, start: Date, end: Date): Promise<RainfallResult>
}

type FetchLike = (input: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

export class OpenMeteoRainfallProvider implements RainfallProvider {
  constructor(private cfg: Pick<FloodConfig, 'openMeteoForecastUrl' | 'providerTimeoutMs'>, private fetchImpl: FetchLike = fetch as unknown as FetchLike, private now: () => Date = () => new Date()) {}

  async total(point: LatLng, start: Date, end: Date): Promise<RainfallResult> {
    const hours = (end.getTime() - start.getTime()) / 3_600_000
    if (!(hours >= 1)) throw new ProviderError('rainfall_window', 'The rainfall window must be at least one hour long.', undefined, 400)
    if (hours > 24 * 14) throw new ProviderError('rainfall_window', 'The rainfall window can be at most 14 days.', undefined, 400)
    const now = this.now()
    if (start.getTime() < now.getTime() - 92 * 86_400_000) throw new ProviderError('rainfall_window', 'Open-Meteo can supply the last 92 days only. For an older event, type in the rainfall total from a documented source.', undefined, 400)
    if (end.getTime() > now.getTime() + 15 * 86_400_000) throw new ProviderError('rainfall_window', 'Open-Meteo forecasts reach 15 days ahead at most.', undefined, 400)
    const day = (d: Date) => d.toISOString().slice(0, 10)
    const url = `${this.cfg.openMeteoForecastUrl}?latitude=${point[0].toFixed(4)}&longitude=${point[1].toFixed(4)}&hourly=precipitation&timezone=UTC&start_date=${day(start)}&end_date=${day(end)}`
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), this.cfg.providerTimeoutMs)
    let body: { hourly?: { time?: unknown; precipitation?: unknown } }
    try {
      const res = await this.fetchImpl(url, { signal: ctl.signal })
      if (!res.ok) throw new ProviderError('rainfall_provider_failed', `The rainfall service refused the request (HTTP ${res.status}).`, 'Try again later, or type in a rainfall total.')
      body = (await res.json()) as typeof body
    } catch (e) {
      if (e instanceof ProviderError) throw e
      throw new ProviderError('rainfall_provider_failed', `The rainfall service could not be reached (${(e as Error).name === 'AbortError' ? 'timed out' : (e as Error).message}).`, 'Try again later, or type in a rainfall total from a documented source.')
    } finally {
      clearTimeout(timer)
    }
    const times = body?.hourly?.time
    const values = body?.hourly?.precipitation
    if (!Array.isArray(times) || !Array.isArray(values) || times.length !== values.length || !times.length) {
      throw new ProviderError('rainfall_provider_failed', 'The rainfall service returned an unexpected answer.', 'Try again later, or type in a rainfall total.')
    }
    let sum = 0
    let used = 0
    let missing = 0
    for (let i = 0; i < times.length; i++) {
      const t = Date.parse(`${String(times[i])}Z`)
      if (!(t >= start.getTime() && t < end.getTime())) continue
      const v = values[i]
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) { sum += v; used++ } else missing++
    }
    if (used === 0) throw new ProviderError('rainfall_no_data', 'The rainfall service had no values for that window.', 'Pick a different window or type in a rainfall total.', 422)
    if (missing / (used + missing) > 0.1) throw new ProviderError('rainfall_incomplete', `The rainfall service is missing ${missing} of ${used + missing} hours in that window, so a total would be an under-estimate.`, 'Pick a different window or type in a rainfall total.', 422)
    return {
      totalMm: Math.round(sum * 10) / 10,
      durationHours: used,
      kind: 'model_gridded',
      sourceName: 'Open-Meteo hourly precipitation (weather-model grid, one point)',
      windowStart: start.toISOString(),
      windowEnd: end.toISOString(),
      asOf: now.toISOString(),
      notes: ['Model-derived precipitation at one grid point, not a rain-gauge observation.', 'Local storm cells can deliver far more or less than a model grid cell suggests.', 'Coordinates of the area are sent to api.open-meteo.com.'],
    }
  }
}
