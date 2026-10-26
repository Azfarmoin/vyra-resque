// Server side of the constrained channels: turns a short emergency message received by a gateway (radio bridge,
// SMS provider, Bluetooth relay, manual import) into a "partial" report, idempotently.
import { ZodError } from 'zod'
import { RESOURCE_LABEL, decodeCompact } from '../delivery/compact'
import { createReport } from '../reportService'
import { createReportSchema } from '../validation'

export type GatewayChannel = 'radio' | 'sms' | 'bluetooth' | 'manual'
export const GATEWAY_CHANNELS: GatewayChannel[] = ['radio', 'sms', 'bluetooth', 'manual']

export type IngestResult =
  | { ok: true; incident: string; report_id: string; duplicate: boolean; ack: string }
  | { ok: false; incident?: string; error: string }

export async function ingestCompact(raw: string, meta: { channel: GatewayChannel; gatewayId: string; fallbackCallback?: string | null }): Promise<IngestResult> {
  const parsed = decodeCompact(raw)
  if (!parsed.ok) return { ok: false, error: parsed.reason }
  const c = parsed.value
  const resources = c.resources.map((r) => RESOURCE_LABEL[r]).join(', ') || 'none stated'
  const fallback = meta.fallbackCallback && /^\+?[0-9]{3,15}$/.test(meta.fallbackCallback.replace(/[ ()-]/g, '')) ? meta.fallbackCallback.replace(/[ ()-]/g, '') : null
  try {
    const input = createReportSchema.parse({
      client_id: c.clientId,
      reporter_id: null,
      location_lat: c.lat,
      location_lng: c.lng,
      // The short message cannot say whether the point came from GPS or a map tap, so it is never labelled "gps".
      location_source: 'manual',
      location_address: c.lat != null ? null : c.place ?? 'Location not stated. Use the callback number.',
      incident_time: c.incidentTime,
      reporter_urgency: c.urgency,
      submitted_offline: true,
      people_count: c.people,
      dangers: c.dangers.length ? c.dangers : ['other'],
      danger_details: `Short ${meta.channel} message. Resources requested: ${resources}. Full details and photos are pending.`,
      injury_severity: c.injury,
      contact_phone: c.callback ?? fallback,
    })
    const { report, duplicate } = await createReport(input, null, { ingest: { channel: meta.channel, gatewayId: meta.gatewayId } })
    return { ok: true, incident: c.incident, report_id: report.id, duplicate, ack: `ACK|${c.incident}|${meta.gatewayId}` }
  } catch (e) {
    if (e instanceof ZodError) return { ok: false, incident: c.incident, error: `Message did not pass validation: ${e.issues.map((i) => i.message).join('; ')}` }
    throw e
  }
}
