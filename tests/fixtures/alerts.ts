// Mocked feeds for the early-warning tests. Nothing here talks to a real service and nothing is a real alert.
import type { AlertRecord, SavedLocation } from '../../src/lib/alerts/types'

export const NOW = Date.parse('2026-10-24T10:00:00Z')
export const SENT = '2026-10-24T09:30:00Z'
export const EXPIRES = '2026-10-24T18:00:00Z'

// A rectangle around Clifton, Karachi (lat 24.78-24.86, lng 66.98-67.08), closed as CAP requires.
export const CLIFTON_POLYGON = '24.78,66.98 24.86,66.98 24.86,67.08 24.78,67.08 24.78,66.98'

export interface CapOpts {
  id?: string
  sender?: string
  sent?: string
  status?: string
  msgType?: string
  scope?: string
  references?: string
  event?: string
  headline?: string
  description?: string
  instruction?: string
  severity?: string
  urgency?: string
  certainty?: string
  responseType?: string
  effective?: string
  expires?: string | null
  areaDesc?: string
  polygon?: string | null
  circle?: string | null
  web?: string
  language?: string
  noInfo?: boolean
}

export function cap(o: CapOpts = {}): string {
  const id = o.id ?? 'TEST-1'
  const info = o.noInfo ? '' : `
  <info>
    <language>${o.language ?? 'en-US'}</language>
    <category>Met</category>
    <event>${o.event ?? 'Heavy Rain'}</event>
    <responseType>${o.responseType ?? 'Prepare'}</responseType>
    <urgency>${o.urgency ?? 'Expected'}</urgency>
    <severity>${o.severity ?? 'Severe'}</severity>
    <certainty>${o.certainty ?? 'Likely'}</certainty>
    <effective>${o.effective ?? SENT}</effective>
    ${o.expires === null ? '' : `<expires>${o.expires ?? EXPIRES}</expires>`}
    <senderName>Test Met Service</senderName>
    <headline>${o.headline ?? 'Heavy rain warning for Karachi'}</headline>
    <description>${o.description ?? 'Heavy rainfall of 80 mm is expected. Urban flooding is possible.'}</description>
    <instruction>${o.instruction ?? 'Avoid low-lying roads.'}</instruction>
    <web>${o.web ?? 'https://met.example.test/alerts/' + id}</web>
    <area>
      <areaDesc>${o.areaDesc ?? 'Clifton, Karachi'}</areaDesc>
      ${o.polygon === null ? '' : `<polygon>${o.polygon ?? CLIFTON_POLYGON}</polygon>`}
      ${o.circle ? `<circle>${o.circle}</circle>` : ''}
    </area>
  </info>`
  return `<?xml version="1.0" encoding="UTF-8"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <identifier>${id}</identifier>
  <sender>${o.sender ?? 'met@example.test'}</sender>
  <sent>${o.sent ?? SENT}</sent>
  <status>${o.status ?? 'Actual'}</status>
  <msgType>${o.msgType ?? 'Alert'}</msgType>
  <scope>${o.scope ?? 'Public'}</scope>
  ${o.references ? `<references>${o.references}</references>` : ''}${info}
</alert>`
}

export const rss = (links: string[]) => `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>${links.map((l) => `<item><title>x</title><link>${l}</link></item>`).join('')}</channel></rss>`

// fetch mock: map of URL -> body string, Error to throw, or {status} for an HTTP error. Records every call.
export function mockFetch(routes: Record<string, string | Error | { status: number }>) {
  const calls: string[] = []
  const fn = (async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    const r = routes[url]
    if (r === undefined) return new Response('not found', { status: 404 })
    if (r instanceof Error) throw r
    if (typeof r === 'object') return new Response('error', { status: r.status })
    return new Response(r, { status: 200 })
  }) as unknown as typeof fetch
  return { fn, calls }
}

export const clifton: SavedLocation = { id: 'a', label: 'Clifton', lat: 24.82, lng: 67.03, source: 'manual_point', accuracyM: 50 }
export const lahore: SavedLocation = { id: 'b', label: 'Lahore', lat: 31.5204, lng: 74.3587, source: 'area_centre', accuracyM: null }

export function sampleAlert(over: Partial<AlertRecord> = {}): AlertRecord {
  return {
    id: 'alert-1', provider: 'p1', external_alert_id: 'x1', origin: 'official', hazard_type: 'heavy_rain', severity: 'warning', status: 'active',
    title: 'Heavy rain warning for Karachi', description: 'Heavy rainfall of 80 mm is expected. Urban flooding is possible.', instruction: 'Avoid low-lying roads.',
    affected_area: 'Clifton, Karachi', areas: [{ description: 'Clifton, Karachi', geometry: [{ type: 'polygon', rings: [[[24.78, 66.98], [24.86, 66.98], [24.86, 67.08], [24.78, 67.08], [24.78, 66.98]]] }], geocodes: [] }],
    source_url: 'https://met.example.test/a', source_name: 'Test Met Service', issued_at: SENT, starts_at: SENT, expires_at: EXPIRES, last_updated_at: SENT,
    first_seen_at: SENT, last_seen_at: SENT, revision: 1, content_hash: 'h', source_severity: null, ai_summary: null, review_flags: [], raw_source_metadata: null, limitations: [], created_by: null,
    ...over,
  }
}
