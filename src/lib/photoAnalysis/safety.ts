// Safety post-filters. The model is told the rules in its prompt, but its output is untrusted, so the
// same rules are enforced here in code before anything is shown or saved:
//  - no statement that a building, road or area is safe,
//  - no identifying people, and no medical diagnosis,
//  - no location inferred from the picture,
//  - control characters / markup stripped and lengths capped,
//  - review_required is always true, and standard limitations are always present.
import { LIMITS, type IncidentType, type ModelOutput, type PhotoAnalysisResult } from './schema'

const SAFE_CLAIM = /\b(is|are|looks?|appears?|seems?|remains?|deemed|considered|declared)\s+(totally |completely |perfectly |generally )?(safe|secure|stable|passable|drivable|habitable|sound|undamaged)\b|\b(no|without)\s+(danger|hazards?|risk|threat)s?\b|\bsafe (to|for)\b|\bstructurally (sound|stable|safe)\b|\bclear (to|for) (cross|pass|drive|travel|enter|use)\b|\bnot (dangerous|hazardous|a (risk|danger))\b/i
const IDENTITY = /\b(identif\w+|recogni[sz]\w*|looks like (a |the )?[A-Z]|resembles|is (mr|mrs|ms|dr)\b|named|his name|her name|nationality|ethnicity|race|religion)\b/i
const MEDICAL = /\b(fractur\w+|broken (bone|leg|arm|neck|back)|concussion|internal(ly)? bleeding|hemorrhag\w+|diagnos\w+|infection|heart attack|cardiac|stroke|seizure|dead|deceased|died|corpse|alive|unconscious|dying|critical condition|paralys\w+|severe(ly)? injur\w+)\b/i
const LOCATION = /\b(located (in|at|near|on)|taken (in|at|near|on)|photo(graph)? (was )?(taken|shot) (in|at)|appears to be (in|at|near)|this is (in|at|near)|somewhere (in|near)|gps|coordinates|latitude|longitude)\b/i

const RULES: { name: string; test: RegExp }[] = [
  { name: 'safety claim', test: SAFE_CLAIM },
  { name: 'identification', test: IDENTITY },
  { name: 'medical statement', test: MEDICAL },
  { name: 'location inference', test: LOCATION },
]

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g

export function cleanText(s: string, max: number): string {
  const t = s.replace(CONTROL, '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t
}

export const violates = (s: string): string | null => RULES.find((r) => r.test.test(s))?.name ?? null

export const STANDARD_LIMITATIONS = [
  'A photo cannot show where it was taken, when it was taken, or whether it is edited or unrelated to this report.',
  'A photo cannot show that a building, road or area is safe. Only an on-site check can.',
  'These are suggestions from a computer vision model. A person must verify them before anyone acts on them.',
]

const sentences = (s: string) => s.match(/[^.!?]+[.!?]*/g)?.map((x) => x.trim()).filter(Boolean) ?? []

/** Cleans one validated model output. `removed` counts statements dropped by the rules above. */
export function sanitizeOutput(raw: ModelOutput): { result: Omit<PhotoAnalysisResult, 'analysis_status' | 'analyzed_at' | 'model_provider' | 'model_version'>; removed: number } {
  let removed = 0
  const keepList = (xs: string[]) => {
    const out: string[] = []
    for (const x of xs) {
      const c = cleanText(x, LIMITS.itemChars)
      if (!c) continue
      if (violates(c)) {
        removed++
        continue
      }
      if (!out.some((o) => o.toLowerCase() === c.toLowerCase())) out.push(c)
    }
    return out.slice(0, LIMITS.items)
  }
  const keepProse = (s: string, max: number) => {
    const kept = sentences(cleanText(s, max * 2)).filter((x) => {
      if (violates(x)) {
        removed++
        return false
      }
      return true
    })
    return cleanText(kept.join(' '), max)
  }

  const types = [...new Set(raw.detected_incident_types)] as IncidentType[]
  // "no evidence" / "unclear" cannot be combined with an actual incident type.
  const real = types.filter((t) => t !== 'no_disaster_evidence' && t !== 'unclear')
  const detected: IncidentType[] = real.length ? real : types.includes('no_disaster_evidence') && !types.includes('unclear') ? ['no_disaster_evidence'] : ['unclear']

  const observations = keepList(raw.visual_observations)
  const hazards = keepList(raw.possible_hazards)
  const damage = keepList(raw.damage_indicators)
  const blockages = keepList(raw.possible_road_blockages)
  const title = keepProse(raw.suggested_report_title, LIMITS.title)
  const description = keepProse(raw.suggested_description, LIMITS.description)

  // Nothing visible was reported: do not let a severity or incident type stand on its own.
  const hasEvidence = !!(observations.length || damage.length || blockages.length)
  const incidentless = detected.length === 1 && (detected[0] === 'no_disaster_evidence' || detected[0] === 'unclear')
  const severity = !hasEvidence || incidentless ? 'not_determined' : raw.suggested_severity
  const limits = keepList(raw.limitations)
  if (removed) limits.push(`${removed} statement${removed === 1 ? ' was' : 's were'} removed because it made a claim a photo cannot support (safety, identity, medical or location).`)
  for (const l of STANDARD_LIMITATIONS) if (!limits.includes(l)) limits.push(l)

  return {
    removed,
    result: {
      detected_incident_types: detected,
      visual_observations: observations,
      possible_hazards: hazards,
      damage_indicators: damage,
      possible_road_blockages: blockages,
      suggested_report_title: title,
      suggested_description: description,
      suggested_severity: severity,
      confidence: raw.confidence,
      limitations: limits,
      review_required: true,
      removed_statements: removed,
    },
  }
}
