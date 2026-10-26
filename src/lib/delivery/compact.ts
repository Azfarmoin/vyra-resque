// Compact emergency message for constrained channels (SMS, LoRa/radio mesh, Bluetooth, QR code).
//
//   V1|<incident>|<dangers>|<sev>|<where>|<people>|<resources>|<time>|<callback>|<crc>
//
//   incident   the report's client_id (a UUID) as 22 url-safe base64 characters. The same id is the
//              idempotency key of the full report, so a later internet sync merges into the same incident.
//   dangers    2-letter codes joined by "," (TR trapped, FI fire, ...). Life-threatening ones come first.
//   sev        <urgency><injury>: urgency L/M/H/C or "-", injury 0 none, 1 minor, 2 serious, 3 critical, 9 unknown.
//   where      "lat,lng" (5 decimals) or "@short place description". Never invented.
//   people     number of people needing help, or "-".
//   resources  rescue resources derived from the report: SAR, BOAT, FIRE, MED, EVAC, AID, ROAD joined by "+".
//   time       the ORIGINAL incident time, unix seconds in base 36 (kept even when the message arrives hours later).
//   callback   phone number the reporter gave, digits and a leading "+", or "-".
//   crc        CRC-16/CCITT-FALSE of everything before the last "|", 4 hex digits. A damaged message is rejected.
//
// ASCII only (fits one GSM-7 SMS and a LoRa payload), at most 160 characters. Photos never travel this way.
import type { Danger, EvacuationAbility, InjurySeverity, ReporterUrgency } from '../constants'
import { DANGERS } from '../constants'

export const COMPACT_VERSION = 'V1'
export const COMPACT_MAX_LEN = 160

const DANGER_CODE: Record<Danger, string> = {
  trapped: 'TR', drowning: 'DW', rising_water: 'RW', building_collapse: 'BC', fire: 'FI', electrocution: 'EL',
  landslide: 'LS', gas_leak: 'GL', extreme_heat: 'EH', stranded: 'ST', no_shelter: 'NS', no_food_water: 'NF',
  earthquake: 'EQ', blocked_road: 'BR', medical_emergency: 'ME', other: 'OT', none: 'NO',
}
const CODE_DANGER = Object.fromEntries(Object.entries(DANGER_CODE).map(([k, v]) => [v, k])) as Record<string, Danger>
// Most urgent first, so truncation (if ever needed) drops the least important codes.
const DANGER_ORDER: Danger[] = ['trapped', 'drowning', 'building_collapse', 'fire', 'electrocution', 'gas_leak', 'rising_water', 'landslide', 'earthquake', 'medical_emergency', 'extreme_heat', 'blocked_road', 'stranded', 'no_shelter', 'no_food_water', 'other', 'none']
const MAX_DANGER_CODES = 6

const URGENCY_CODE: Record<ReporterUrgency, string> = { low: 'L', medium: 'M', high: 'H', critical: 'C' }
const CODE_URGENCY: Record<string, ReporterUrgency> = { L: 'low', M: 'medium', H: 'high', C: 'critical' }
const INJURY_CODE: Record<InjurySeverity, string> = { none: '0', minor: '1', serious: '2', critical: '3', unknown: '9' }
const CODE_INJURY: Record<string, InjurySeverity> = { '0': 'none', '1': 'minor', '2': 'serious', '3': 'critical', '9': 'unknown' }

export const RESOURCE_LABEL: Record<string, string> = {
  SAR: 'Search and rescue', BOAT: 'Boat / water rescue', FIRE: 'Fire service', MED: 'Medical help',
  EVAC: 'Evacuation help', AID: 'Food, water or shelter', ROAD: 'Road clearing',
}

// ---------- incident id <-> client_id ----------
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

export function clientIdToIncident(clientId: string): string {
  if (!UUID.test(clientId)) return `x:${clientId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24)}`
  const hex = clientId.replace(/-/g, '')
  const bytes: number[] = []
  for (let i = 0; i < 32; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16))
  let out = ''
  for (let i = 0; i < 16; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63]
  }
  return out.slice(0, 22)
}

export function incidentToClientId(incident: string): string | null {
  if (incident.startsWith('x:')) return /^[A-Za-z0-9_-]{8,24}$/.test(incident.slice(2)) ? incident.slice(2) : null
  if (!/^[A-Za-z0-9_-]{22}$/.test(incident)) return null
  const padded = `${incident}AA`
  const bytes: number[] = []
  for (let i = 0; i < padded.length; i += 4) {
    const n = [...padded.slice(i, i + 4)].reduce((acc, ch) => (acc << 6) | B64.indexOf(ch), 0)
    bytes.push((n >> 16) & 255, (n >> 8) & 255, n & 255)
  }
  const hex = bytes.slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** Short reference people can read aloud ("VY-3F9A12BC"). Display only. */
export const incidentRef = (clientId: string) => `VY-${clientId.replace(/-/g, '').slice(0, 8).toUpperCase()}`

// ---------- checksum ----------
export function crc16(text: string): string {
  let crc = 0xffff
  for (let i = 0; i < text.length; i++) {
    crc ^= (text.charCodeAt(i) & 0xff) << 8
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

// ---------- encode ----------
export interface CompactSource {
  client_id: string
  dangers?: string[]
  reporter_urgency?: string | null
  injury_severity?: string | null
  location_lat?: number | null
  location_lng?: number | null
  location_address?: string | null
  area?: string | null
  people_count?: number | null
  medical_need_types?: string[]
  can_evacuate?: string | null
  incident_time?: string | null
  contact_phone?: string | null
}

export function deriveResources(s: CompactSource): string[] {
  const d = new Set(s.dangers ?? [])
  const out: string[] = []
  const has = (...k: string[]) => k.some((x) => d.has(x))
  if (has('trapped', 'building_collapse', 'landslide', 'earthquake')) out.push('SAR')
  if (has('drowning', 'rising_water')) out.push('BOAT')
  if (has('fire', 'gas_leak', 'electrocution')) out.push('FIRE')
  if (has('medical_emergency') || ['serious', 'critical'].includes(s.injury_severity ?? '') || (s.medical_need_types?.length ?? 0) > 0) out.push('MED')
  if ((s.can_evacuate as EvacuationAbility | null) === 'no') out.push('EVAC')
  if (has('no_food_water', 'no_shelter', 'extreme_heat', 'stranded')) out.push('AID')
  if (has('blocked_road')) out.push('ROAD')
  return out
}

const asciiPlace = (t: string, max: number) =>
  t.normalize('NFKD').replace(/[^A-Za-z0-9 .,/-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim()

export interface EncodedCompact { text: string; length: number; placeTruncated: boolean }

export function encodeCompact(s: CompactSource, maxLen = COMPACT_MAX_LEN): EncodedCompact {
  const known = (s.dangers ?? []).filter((x): x is Danger => x in DANGER_CODE)
  const dangers = DANGER_ORDER.filter((x) => known.includes(x)).slice(0, MAX_DANGER_CODES).map((x) => DANGER_CODE[x]).join(',') || '-'
  const sev = `${URGENCY_CODE[s.reporter_urgency as ReporterUrgency] ?? '-'}${INJURY_CODE[(s.injury_severity ?? 'unknown') as InjurySeverity] ?? '9'}`
  const hasCoords = typeof s.location_lat === 'number' && typeof s.location_lng === 'number'
  const placeText = asciiPlace(s.location_address || s.area || '', 60)
  const people = s.people_count != null && s.people_count > 0 ? String(Math.min(99999, Math.round(s.people_count))) : '-'
  const res = deriveResources(s).join('+') || '-'
  const t = s.incident_time ? Date.parse(s.incident_time) : NaN
  const time = Number.isNaN(t) ? '-' : Math.floor(t / 1000).toString(36)
  const cb = (s.contact_phone ?? '').replace(/[^0-9+]/g, '').replace(/(?!^)\+/g, '').slice(0, 15) || '-'
  const where = (placeMax: number) => (hasCoords ? `${s.location_lat!.toFixed(5)},${s.location_lng!.toFixed(5)}` : placeText ? `@${placeText.slice(0, placeMax).trim()}` : '-')

  const build = (placeMax: number) => {
    const body = [COMPACT_VERSION, clientIdToIncident(s.client_id), dangers, sev, where(placeMax), people, res, time, cb].join('|')
    return `${body}|${crc16(body)}`
  }
  let placeMax = 40
  let text = build(placeMax)
  while (text.length > maxLen && !hasCoords && placeMax > 8) {
    placeMax -= 4
    text = build(placeMax)
  }
  return { text, length: text.length, placeTruncated: !hasCoords && placeText.length > placeMax }
}

// ---------- decode ----------
export interface CompactReport {
  incident: string
  clientId: string
  dangers: Danger[]
  urgency: ReporterUrgency | null
  injury: InjurySeverity
  lat: number | null
  lng: number | null
  place: string | null
  people: number | null
  resources: string[]
  incidentTime: string | null
  callback: string | null
}
export type CompactParse = { ok: true; value: CompactReport } | { ok: false; reason: string }

export function decodeCompact(raw: string): CompactParse {
  const at = raw.indexOf(`${COMPACT_VERSION}|`)
  if (at < 0) return { ok: false, reason: 'Not a VYRA emergency message' }
  const text = raw.slice(at).trim()
  if (text.length > 400) return { ok: false, reason: 'Message is too long' }
  const f = text.split('|')
  if (f.length !== 10) return { ok: false, reason: 'Wrong number of fields' }
  const body = f.slice(0, 9).join('|')
  if (crc16(body) !== f[9].toUpperCase()) return { ok: false, reason: 'Checksum mismatch: the message was damaged in transit' }
  const clientId = incidentToClientId(f[1])
  if (!clientId) return { ok: false, reason: 'Bad incident id' }

  const dangers = f[2] === '-' ? [] : f[2].split(',').map((c) => CODE_DANGER[c]).filter(Boolean)
  const urgency = CODE_URGENCY[f[3][0]] ?? null
  const injury = CODE_INJURY[f[3][1]] ?? 'unknown'

  let lat: number | null = null, lng: number | null = null, place: string | null = null
  if (f[4].startsWith('@')) place = f[4].slice(1) || null
  else if (f[4] !== '-') {
    const m = f[4].match(/^(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)$/)
    if (!m) return { ok: false, reason: 'Bad location' }
    lat = Number(m[1]); lng = Number(m[2])
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return { ok: false, reason: 'Location out of range' }
  }
  const people = /^\d{1,5}$/.test(f[5]) && Number(f[5]) > 0 ? Number(f[5]) : null
  const resources = f[6] === '-' ? [] : f[6].split('+').filter((r) => r in RESOURCE_LABEL)
  const secs = f[7] === '-' ? NaN : parseInt(f[7], 36)
  const ms = secs * 1000
  const incidentTime = Number.isFinite(ms) && ms > Date.UTC(2020, 0, 1) && ms < Date.now() + 86_400_000 ? new Date(ms).toISOString() : null
  const callback = /^\+?\d{3,15}$/.test(f[8]) ? f[8] : null
  return { ok: true, value: { incident: f[1], clientId, dangers, urgency, injury, lat, lng, place, people, resources, incidentTime, callback } }
}
