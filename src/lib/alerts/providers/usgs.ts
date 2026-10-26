// USGS earthquake feed (GeoJSON). These are RECORDS of earthquakes that have already happened.
// They are never presented as predictions or early warnings, and are always "Information" level.
// Public feed documentation: https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php

import type { AlertCandidate } from '../types'
import type { AlertProvider, ProviderContext, ProviderResult, RejectedItem } from './types'

export const DEFAULT_USGS_FEED = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson'

// Display heuristic only: how far from an epicentre a person is shown the record. It is NOT a shaking-intensity model.
export function quakeDisplayRadiusKm(mag: number): number {
  if (mag >= 7) return 500
  if (mag >= 6) return 300
  if (mag >= 5) return 150
  return 50
}

const DISPLAY_WINDOW_MS = 24 * 3600 * 1000

export function createUsgsProvider(env: Record<string, string | undefined> = process.env): AlertProvider {
  const enabled = env.ALERT_USGS_ENABLED === 'true'
  const url = env.ALERT_USGS_FEED_URL || DEFAULT_USGS_FEED
  return {
    id: 'usgs-earthquakes',
    name: 'USGS earthquake records',
    origin: 'observation',
    minIntervalMinutes: 15,
    staleAfterMinutes: 60,
    unconfiguredReason: enabled ? null : 'Disabled. Set ALERT_USGS_ENABLED=true to show recorded earthquakes.',
    docs: {
      feedUrl: url,
      docsUrl: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php',
      coverage: 'Global (magnitude 4.5+ in the default feed)',
      hazards: ['earthquake'],
      updateFrequency: 'Feed is refreshed about every minute by USGS; VYRA polls every 15 minutes',
      authentication: 'None',
      limitations: 'Reports earthquakes AFTER they occur, with automatic magnitudes that may be revised. It is not an earthquake early-warning system and cannot predict when or where an earthquake will happen.',
    },
    async fetchAlerts(ctx: ProviderContext): Promise<ProviderResult> {
      const body = JSON.parse(await ctx.fetchText(url, { headers: { Accept: 'application/geo+json, application/json' } })) as { features?: unknown }
      if (!Array.isArray(body.features)) throw new Error('Unexpected feed format (no features array)')
      const candidates: AlertCandidate[] = []
      const rejected: RejectedItem[] = []
      for (const f of body.features as Record<string, any>[]) {
        const id = typeof f?.id === 'string' ? f.id : null
        const p = f?.properties
        const c = f?.geometry?.coordinates
        const mag = p?.mag == null ? NaN : Number(p.mag)
        if (!id || !p || !Array.isArray(c) || !Number.isFinite(mag) || p.type !== 'earthquake') { rejected.push({ kind: 'malformed', detail: 'Feature missing id, magnitude or coordinates', externalId: id }); continue }
        const lng = Number(c[0]), lat = Number(c[1])
        const t = Number(p.time), upd = Number(p.updated)
        if (!(lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) || !Number.isFinite(t)) { rejected.push({ kind: 'invalid_timestamp', detail: 'Bad coordinates or time', externalId: id }); continue }
        if (t > ctx.now + 3600_000) { rejected.push({ kind: 'invalid_timestamp', detail: 'Event time is in the future', externalId: id }); continue }
        const place = String(p.place || 'unknown location').slice(0, 200)
        const issued = new Date(t).toISOString()
        candidates.push({
          provider: 'usgs-earthquakes',
          external_alert_id: id,
          origin: 'observation',
          hazard_type: 'earthquake',
          severity: 'information',
          status: 'active',
          title: `M${mag.toFixed(1)} earthquake recorded: ${place}`,
          description: `USGS recorded a magnitude ${mag.toFixed(1)} earthquake (${p.status === 'reviewed' ? 'reviewed' : 'automatic'} solution). This is a record of an earthquake that has already happened. It is not a prediction and not an early warning.${p.tsunami === 1 ? ' USGS flags that tsunami information may be available; follow your national tsunami authority.' : ''}`,
          instruction: null,
          affected_area: place,
          areas: [{ description: place, geometry: [{ type: 'point', center: [lat, lng], displayRadiusKm: quakeDisplayRadiusKm(mag) }], geocodes: [] }],
          source_url: typeof p.url === 'string' ? p.url : null,
          source_name: 'USGS Earthquake Hazards Program',
          issued_at: issued,
          starts_at: issued,
          expires_at: new Date(t + DISPLAY_WINDOW_MS).toISOString(), // VYRA's display window, not a USGS expiry
          last_updated_at: Number.isFinite(upd) ? new Date(upd).toISOString() : issued,
          source_severity: null,
          raw_source_metadata: { mag, magType: p.magType ?? null, status: p.status ?? null, depthKm: Number(c[2]) || null, pagerAlert: p.alert ?? null, tsunami: p.tsunami ?? null },
          limitations: ['Recorded after the event. "Near you" uses a display radius that depends on magnitude, not a shaking map.', 'Shown for 24 hours after the event.'],
          created_by: null,
        })
      }
      return { candidates, rejected }
    },
  }
}
