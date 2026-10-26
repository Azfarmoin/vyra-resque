// Combines several per-photo analyses into one summary WITHOUT assuming the photos show the same event.
// Every line keeps the photo(s) it came from; near-identical hazards are merged (not double counted);
// differing readings between photos are flagged as possible conflicts.
import type { IncidentType, PhotoAnalysisResult, Severity } from './schema'

export interface PhotoInput {
  attachment_id: string
  label: string // "Photo 1"
  result: PhotoAnalysisResult
}
export interface Sourced {
  text: string
  photos: string[] // labels
}
export interface CombinedSummary {
  photo_count: number
  analyzed_count: number
  incident_types: { type: IncidentType; photos: string[] }[]
  observations: Sourced[]
  hazards: Sourced[]
  damage: Sourced[]
  road_blockages: Sourced[]
  highest_suggested_severity: Severity
  conflicts: string[]
  notes: string[]
}

const norm = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w))
const STOP = new Set(['the', 'and', 'with', 'that', 'this', 'are', 'may', 'could', 'visible', 'appears', 'appear', 'seems', 'some', 'there', 'from', 'into', 'over', 'part'])

function similar(a: string, b: string) {
  const A = new Set(norm(a))
  const B = new Set(norm(b))
  if (!A.size || !B.size) return false
  let inter = 0
  for (const w of A) if (B.has(w)) inter++
  return inter / Math.min(A.size, B.size) >= 0.75
}

function merge(items: { text: string; photo: string }[]): Sourced[] {
  const out: Sourced[] = []
  for (const it of items) {
    const hit = out.find((o) => similar(o.text, it.text))
    if (hit) {
      if (!hit.photos.includes(it.photo)) hit.photos.push(it.photo)
    } else out.push({ text: it.text, photos: [it.photo] })
  }
  return out
}

const RANK: Record<Severity, number> = { not_determined: 0, low: 1, moderate: 2, high: 3 }
const REAL = (t: IncidentType) => t !== 'no_disaster_evidence' && t !== 'unclear'

export function combineAnalyses(inputs: PhotoInput[]): CombinedSummary {
  const done = inputs.filter((i) => i.result.analysis_status === 'completed')
  const flat = (pick: (r: PhotoAnalysisResult) => string[]) => merge(done.flatMap((i) => pick(i.result).map((text) => ({ text, photo: i.label }))))

  const types = new Map<IncidentType, string[]>()
  for (const i of done) for (const t of i.result.detected_incident_types) if (REAL(t)) types.set(t, [...(types.get(t) ?? []), i.label])

  const conflicts: string[] = []
  const noEvidence = done.filter((i) => i.result.detected_incident_types.includes('no_disaster_evidence')).map((i) => i.label)
  const withEvidence = done.filter((i) => i.result.detected_incident_types.some(REAL)).map((i) => i.label)
  if (noEvidence.length && withEvidence.length) {
    conflicts.push(`${noEvidence.join(', ')} show no disaster evidence while ${withEvidence.join(', ')} do. The photos may not show the same place or time.`)
  }
  const sev = done.filter((i) => i.result.suggested_severity !== 'not_determined')
  const levels = new Set(sev.map((i) => i.result.suggested_severity))
  if (levels.size > 1) conflicts.push(`Photos suggest different severity levels (${sev.map((i) => `${i.label}: ${i.result.suggested_severity}`).join('; ')}).`)
  if (types.has('flooding') && types.has('fire')) conflicts.push(`Both flooding (${types.get('flooding')!.join(', ')}) and fire (${types.get('fire')!.join(', ')}) were suggested. Check whether they are the same event.`)

  const notes = ['The photos are analysed separately. They are not assumed to show the same event, place or time.']
  if (done.length < inputs.length) notes.push(`${inputs.length - done.length} photo${inputs.length - done.length === 1 ? ' has' : 's have'} no completed analysis and ${inputs.length - done.length === 1 ? 'is' : 'are'} not included.`)

  const best = done.reduce<Severity>((m, i) => (RANK[i.result.suggested_severity] > RANK[m] ? i.result.suggested_severity : m), 'not_determined')
  return {
    photo_count: inputs.length,
    analyzed_count: done.length,
    incident_types: [...types].map(([type, photos]) => ({ type, photos })),
    observations: flat((r) => r.visual_observations),
    hazards: flat((r) => r.possible_hazards),
    damage: flat((r) => r.damage_indicators),
    road_blockages: flat((r) => r.possible_road_blockages),
    highest_suggested_severity: best,
    conflicts,
    notes,
  }
}
