// Common Alerting Protocol (CAP 1.2) parsing for official alerting-authority feeds.
// CAP is the format the WMO Register of Alerting Authorities uses, so one parser serves any national
// meteorological service or disaster authority that publishes CAP.

import { childrenOf, descendants, parseXml, textOf, type XmlNode } from './xml'
import type { AlertArea, AlertCandidate, AlertGeometry, HazardType, LatLng, Severity, SourceSeverity } from './types'

export class AlertValidationError extends Error {
  constructor(public kind: 'malformed' | 'invalid_timestamp', message: string, public externalId: string | null = null) {
    super(message)
  }
}

// --- Severity ---------------------------------------------------------------------------------
// Rules (documented in docs/EARLY_WARNING.md). The source's own words always win; this only maps them
// onto VYRA's four levels and never raises a level above what the source states.
//   emergency  CAP severity Extreme with urgency Immediate/Expected, OR a Severe/Extreme alert whose responseType
//              directs Evacuate or Shelter and whose urgency is Immediate.
//   warning    CAP severity Severe or Extreme, with certainty Observed/Likely (or unstated).
//   watch      Moderate severity; or Severe/Extreme with certainty Possible/Unlikely ("could become hazardous").
//   information everything else (Minor, Unknown, unstated).
export function mapCapSeverity(s: SourceSeverity): Severity {
  const sev = (s.severity || '').toLowerCase()
  const urg = (s.urgency || '').toLowerCase()
  const cert = (s.certainty || '').toLowerCase()
  const resp = (s.responseType || []).map((r) => r.toLowerCase())
  const uncertain = cert === 'possible' || cert === 'unlikely'
  const high = sev === 'severe' || sev === 'extreme'

  if (sev === 'extreme' && (urg === 'immediate' || urg === 'expected') && !uncertain) return 'emergency'
  if (high && urg === 'immediate' && !uncertain && resp.some((r) => r === 'evacuate' || r === 'shelter')) return 'emergency'
  if (high && !uncertain) return 'warning'
  if (high && uncertain) return 'watch'
  if (sev === 'moderate') return 'watch'
  return 'information'
}

// --- Hazard classification ---------------------------------------------------------------------
export function classifyHazard(text: string): HazardType {
  const t = text.toLowerCase()
  if (/earthquake|seismic|tremor/.test(t)) return 'earthquake'
  if (/cyclone|hurricane|typhoon|tropical (storm|depression)|storm surge/.test(t)) return 'cyclone'
  if (/heat ?wave|extreme heat|heat advisory|excessive heat|hot weather|high temperature/.test(t)) return 'heatwave'
  if (/landslide|mudslide|debris flow|rock ?fall|slope failure/.test(t)) return 'landslide'
  if (/wild ?fire|forest fire|bush ?fire|brush fire/.test(t)) return 'wildfire'
  if (/flood/.test(t) && /river|riverine|barrage|reservoir|dam\b|discharge|gauge|stage/.test(t)) return 'river_flood'
  if (/flood|heavy rain|rainfall|downpour|precipitation|cloudburst|monsoon/.test(t)) return 'heavy_rain'
  if (/thunder|lightning|hail|gale|squall|severe wind|strong wind|high wind|wind storm|dust ?storm|storm/.test(t)) return 'thunderstorm_wind'
  return 'other'
}

// --- Timestamps ---------------------------------------------------------------------------------
const MAX_FUTURE_SKEW_MS = 60 * 60 * 1000 // a "sent" time more than an hour ahead of now is not credible
export function parseTime(value: string | undefined | null, field: string, externalId: string | null): string | null {
  if (!value) return null
  const v = value.trim()
  // CAP requires an explicit offset; a bare local time is ambiguous in a safety message, so reject it.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(v)) {
    throw new AlertValidationError('invalid_timestamp', `${field} "${v.slice(0, 40)}" is not an ISO-8601 time with a UTC offset`, externalId)
  }
  const ms = Date.parse(v.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'))
  if (!Number.isFinite(ms)) throw new AlertValidationError('invalid_timestamp', `${field} "${v.slice(0, 40)}" is not a real time`, externalId)
  return new Date(ms).toISOString()
}

// --- Geometry -----------------------------------------------------------------------------------
const validLat = (n: number) => Number.isFinite(n) && n >= -90 && n <= 90
const validLng = (n: number) => Number.isFinite(n) && n >= -180 && n <= 180

export function parsePolygon(text: string): LatLng[] | null {
  const pts: LatLng[] = []
  for (const pair of text.trim().split(/\s+/)) {
    const [a, b] = pair.split(',').map(Number)
    if (!validLat(a) || !validLng(b)) return null
    pts.push([a, b])
  }
  return pts.length >= 4 ? pts : null // CAP polygons are closed: first point repeated, so at least 4 points
}

export function parseCircle(text: string): AlertGeometry | null {
  const m = text.trim().match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)$/)
  if (!m) return null
  const lat = Number(m[1])
  const lng = Number(m[2])
  const radiusKm = Number(m[3]) // CAP circle radius is in kilometres
  if (!validLat(lat) || !validLng(lng) || !(radiusKm >= 0) || radiusKm > 5000) return null
  return { type: 'circle', center: [lat, lng], radiusKm }
}

function parseArea(node: XmlNode): AlertArea {
  const geometry: AlertGeometry[] = []
  const rings: LatLng[][] = []
  for (const p of childrenOf(node, 'polygon')) {
    const ring = parsePolygon(p.text)
    if (ring) rings.push(ring)
  }
  if (rings.length) geometry.push({ type: 'polygon', rings })
  for (const c of childrenOf(node, 'circle')) {
    const g = parseCircle(c.text)
    if (g) geometry.push(g)
  }
  const geocodes = childrenOf(node, 'geocode').map((g) => ({ name: textOf(g, 'valueName'), value: textOf(g, 'value') })).filter((g) => g.name || g.value)
  return { description: textOf(node, 'areaDesc'), geometry, geocodes }
}

// --- Alert --------------------------------------------------------------------------------------
export interface CapParseOptions {
  provider: string
  sourceName: string
  now?: number
  preferredLanguage?: string
  sourceUrl?: string | null
}

// Returns zero or more candidates (one per usable <info> block). Throws AlertValidationError for a
// message that is structurally unusable; returns [] for test/exercise/draft messages.
export function parseCapAlert(root: XmlNode, opts: CapParseOptions): AlertCandidate[] {
  if (root.name !== 'alert') throw new AlertValidationError('malformed', 'Root element is not <alert>')
  const identifier = textOf(root, 'identifier')
  if (!identifier) throw new AlertValidationError('malformed', 'CAP message has no identifier')
  const sender = textOf(root, 'sender')
  const status = textOf(root, 'status').toLowerCase()
  const msgType = textOf(root, 'msgType').toLowerCase()
  if (status && status !== 'actual') return [] // Exercise, System, Test, Draft are never shown to the public
  if (!['alert', 'update', 'cancel', 'ack', 'error'].includes(msgType)) throw new AlertValidationError('malformed', `Unknown msgType "${msgType}"`, identifier)
  const scope = textOf(root, 'scope').toLowerCase()
  if (scope && scope !== 'public') return [] // restricted / private messages are not for general display

  const sent = parseTime(textOf(root, 'sent'), 'sent', identifier)
  if (!sent) throw new AlertValidationError('malformed', 'CAP message has no sent time', identifier)
  const now = opts.now ?? Date.now()
  if (Date.parse(sent) > now + MAX_FUTURE_SKEW_MS) throw new AlertValidationError('invalid_timestamp', 'sent time is in the future', identifier)

  // <references> is "sender,identifier,sent" tuples separated by spaces.
  const supersedes = textOf(root, 'references')
    .split(/\s+/)
    .map((r) => r.split(',')[1])
    .filter((x): x is string => !!x)

  const infos = childrenOf(root, 'info')
  if (msgType === 'cancel' && infos.length === 0) {
    // A bare cancellation: nothing to display, but it must still withdraw what it references.
    return [{
      provider: opts.provider, external_alert_id: identifier, origin: 'official', hazard_type: 'other', severity: 'information',
      status: 'cancelled', title: 'Cancelled alert', description: '', instruction: null, affected_area: '', areas: [],
      source_url: opts.sourceUrl ?? null, source_name: opts.sourceName, issued_at: sent, starts_at: null, expires_at: null,
      last_updated_at: sent, source_severity: null, raw_source_metadata: { sender, msgType }, limitations: [], created_by: null, supersedes,
    }]
  }
  if (infos.length === 0) throw new AlertValidationError('malformed', 'CAP message has no <info> block', identifier)

  // Prefer the configured language; otherwise the first block. One candidate per distinct event in that language.
  const wanted = (opts.preferredLanguage || 'en').toLowerCase()
  const langOf = (n: XmlNode) => (textOf(n, 'language') || 'en').toLowerCase()
  const inLang = infos.filter((i) => langOf(i).startsWith(wanted))
  const chosen = inLang.length ? inLang : [infos[0]]

  return chosen.map((info, idx) => {
    const externalId = chosen.length > 1 ? `${identifier}#${idx + 1}` : identifier
    const event = textOf(info, 'event')
    const headline = textOf(info, 'headline')
    const description = textOf(info, 'description')
    const instruction = textOf(info, 'instruction')
    const effective = parseTime(textOf(info, 'effective'), 'effective', externalId)
    const onset = parseTime(textOf(info, 'onset'), 'onset', externalId)
    const expires = parseTime(textOf(info, 'expires'), 'expires', externalId)
    const starts = onset || effective
    if (expires && Date.parse(expires) < Date.parse(sent)) throw new AlertValidationError('invalid_timestamp', 'expires is earlier than sent', externalId)
    if (starts && expires && Date.parse(expires) < Date.parse(starts)) throw new AlertValidationError('invalid_timestamp', 'expires is earlier than the start time', externalId)

    const src: SourceSeverity = {
      severity: textOf(info, 'severity'),
      urgency: textOf(info, 'urgency'),
      certainty: textOf(info, 'certainty'),
      responseType: childrenOf(info, 'responseType').map((r) => r.text),
    }
    const areas = childrenOf(info, 'area').map(parseArea)
    const categories = childrenOf(info, 'category').map((c) => c.text)
    const hazard = classifyHazard(`${event} ${headline}`) !== 'other' ? classifyHazard(`${event} ${headline}`) : classifyHazard(description)
    const web = textOf(info, 'web') || opts.sourceUrl || null
    const title = headline || event || 'Alert'
    const limitations: string[] = []
    if (!areas.some((a) => a.geometry.length)) limitations.push('The source gave place names but no boundary, so location matching is approximate.')
    if (!expires) limitations.push('The source did not give an expiry time.')

    return {
      provider: opts.provider,
      external_alert_id: externalId,
      origin: 'official' as const,
      hazard_type: hazard,
      severity: mapCapSeverity(src),
      status: msgType === 'cancel' ? ('cancelled' as const) : ('active' as const),
      title: title.slice(0, 300),
      description: description.slice(0, 8000),
      instruction: instruction ? instruction.slice(0, 4000) : null,
      affected_area: areas.map((a) => a.description).filter(Boolean).join('; ').slice(0, 1000),
      areas,
      source_url: web,
      source_name: textOf(info, 'senderName') || opts.sourceName,
      issued_at: sent,
      starts_at: starts,
      expires_at: expires,
      last_updated_at: sent,
      source_severity: src,
      raw_source_metadata: { sender, msgType, categories, event, scope: scope || null },
      limitations,
      created_by: null,
      supersedes: msgType === 'update' || msgType === 'cancel' ? supersedes : [],
    }
  })
}

export function parseCapDocument(xml: string, opts: CapParseOptions): AlertCandidate[] {
  return parseCapAlert(parseXml(xml), opts)
}

// Extracts links to individual CAP messages (or inline <alert> elements) from an RSS / Atom feed.
export function readFeedEntries(xml: string): { links: string[]; inline: XmlNode[] } {
  const root = parseXml(xml)
  if (root.name === 'alert') return { links: [], inline: [root] }
  const links: string[] = []
  const inline: XmlNode[] = []
  const items = [...descendants(root, 'item'), ...descendants(root, 'entry')]
  for (const it of items) {
    const embedded = descendants(it, 'alert')
    if (embedded.length) {
      inline.push(...embedded) // the message is inside the entry; no need to follow a link
      continue
    }
    const linkNodes = childrenOf(it, 'link')
    // Atom: <link rel="alternate|related" href=...>; prefer a link typed as CAP; RSS: <link>text</link>
    const cap = linkNodes.find((l) => /cap/i.test(l.attrs.type || ''))
    const href = cap?.attrs.href || linkNodes.find((l) => l.attrs.href)?.attrs.href || linkNodes.find((l) => l.text)?.text || textOf(it, 'guid')
    if (href && /^https?:\/\//i.test(href)) links.push(href)
  }
  return { links: Array.from(new Set(links)), inline }
}
