// AI may only REWORD what an official source already said. It never decides severity, area, timing or actions.
//   - Output is checked by validateAiText(); anything that adds numbers, links, reassurance, evacuation destinations
//     or a different severity word is rejected, and the deterministic template summary is shown instead.
//   - The original alert text is always displayed next to any summary, and the UI labels summaries as AI-generated.
//   - With no ANTHROPIC_API_KEY the system uses the template summary only (no AI involved).

import { aiProvider, modelFor, callText } from '../ai/provider'
import { HAZARD_TYPES, SEVERITY_LABELS, severityRank, type AlertAiSummary, type AlertRecord } from './types'

export type LlmClient = (system: string, user: string) => Promise<string>

const MAX_CHARS = 900

const EASTERN_DIGITS: Record<string, string> = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9', '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9' }
const asciiDigits = (s: string) => s.replace(/[٠-٩۰-۹]/g, (d) => EASTERN_DIGITS[d] ?? d)
const numbersIn = (s: string) => new Set((asciiDigits(s).match(/\d+(?:[.,]\d+)?/g) || []).map((n) => n.replace(',', '.').replace(/^0+(?=\d)/, '')))

function sourceCorpus(a: AlertRecord): string {
  return [a.title, a.description, a.instruction ?? '', a.affected_area, a.source_name, ...a.areas.map((x) => x.description)].join(' \n ')
}

// Numbers a faithful summary may legitimately contain: anything in the source text, plus parts of its timestamps.
function allowedNumbers(a: AlertRecord): Set<string> {
  const set = numbersIn(sourceCorpus(a))
  for (const t of [a.issued_at, a.starts_at, a.expires_at, a.last_updated_at]) {
    if (!t) continue
    for (const n of numbersIn(t)) set.add(n)
    const d = new Date(t)
    if (Number.isFinite(d.getTime())) [d.getUTCFullYear(), d.getUTCDate(), d.getUTCMonth() + 1, d.getUTCHours(), d.getUTCMinutes()].forEach((n) => set.add(String(n)))
  }
  return set
}

const FORBIDDEN: { re: RegExp; why: string }[] = [
  { re: /\b(?:you(?:'re| are)|area (?:is|remains)|it(?:'s| is)|everything(?: is)?|all)\s+(?:completely |totally |perfectly )?(?:safe|out of danger|fine)\b/i, why: 'declares safety' },
  { re: /\bno (?:danger|risk|threat|hazard|need to (?:worry|evacuate|prepare))\b/i, why: 'declares no risk' },
  { re: /\b(?:nothing|don'?t|do not) (?:to )?worry\b/i, why: 'reassurance' },
  { re: /\b(?:guarantee[sd]?|definitely will|certain(?:ly)? will|will (?:definitely|certainly)|100 ?%)\b/i, why: 'claims certainty' },
  { re: /\b(?:evacuate|go|move|head|travel|relocate)\s+(?:immediately\s+)?(?:to|towards?)\s+(?:the\s+)?\S+/i, why: 'names an evacuation destination' },
  { re: /\bsafe (?:zone|area|place|shelter|route)s?\b/i, why: 'names a safe place' },
  { re: /\bpredict(?:s|ed|ion)?\b.*\b(?:earthquake)\b|\bearthquake\b.*\bpredict(?:s|ed)\b/i, why: 'earthquake prediction claim' },
]

export function validateAiText(text: string, a: AlertRecord): { ok: true } | { ok: false; reason: string } {
  const t = (text || '').trim()
  if (!t) return { ok: false, reason: 'empty output' }
  if (t.length > MAX_CHARS) return { ok: false, reason: 'too long' }
  if (/https?:\/\/|www\.|@\w+\.\w+/i.test(t) && !sourceCorpus(a).includes(t.match(/https?:\/\/\S+|www\.\S+/i)?.[0] ?? '\u0000')) return { ok: false, reason: 'contains a link or address not in the source' }
  const allowed = allowedNumbers(a)
  for (const n of numbersIn(t)) if (!allowed.has(n)) return { ok: false, reason: `contains a number (${n}) that is not in the source` }
  const corpusLower = sourceCorpus(a).toLowerCase()
  for (const f of FORBIDDEN) {
    const m = t.match(f.re)
    // A phrase the authority itself wrote (e.g. "move to higher ground") may be repeated; anything new may not.
    if (m && !(f.why.includes('destination') && corpusLower.includes(m[0].toLowerCase()))) return { ok: false, reason: f.why }
  }
  // The summary must not use a stronger severity word than the source did.
  const corpus = sourceCorpus(a).toLowerCase()
  const lower = t.toLowerCase()
  if (/\bemergency\b/.test(lower) && a.severity !== 'emergency' && !corpus.includes('emergency')) return { ok: false, reason: 'raises severity to Emergency' }
  if (/\bwarning\b/.test(lower) && severityRank(a.severity) < severityRank('warning') && !corpus.includes('warning')) return { ok: false, reason: 'raises severity to Warning' }
  return { ok: true }
}

const sentences = (s: string) => s.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/).filter(Boolean)

// Deterministic, no AI: reorders what the source said. Used when no LLM is configured or when its output is rejected.
export function templateSummary(a: AlertRecord): string {
  const parts = [`${a.source_name} issued ${/^[aeiou]/i.test(SEVERITY_LABELS[a.severity]) ? 'an' : 'a'} ${SEVERITY_LABELS[a.severity]} notice for ${HAZARD_TYPES[a.hazard_type].toLowerCase()}${a.affected_area ? ` affecting ${a.affected_area}` : ''}.`]
  const d = sentences(a.description).slice(0, 2).join(' ')
  if (d) parts.push(d)
  if (a.instruction) parts.push(`The source advises: ${sentences(a.instruction).slice(0, 2).join(' ')}`)
  if (a.expires_at) parts.push(`It is expected to remain in force until ${a.expires_at}.`)
  return parts.join(' ').slice(0, MAX_CHARS)
}

const SYSTEM = `You rewrite official hazard alerts in plain language for the public.
Hard rules:
- Use ONLY facts in the alert text provided. Do not add numbers, places, times, links, phone numbers or advice that are not in it.
- Never change or soften the severity, and never use the words "emergency" or "warning" unless the alert does.
- Never say any place is safe, never say there is no danger, never promise or predict outcomes, never name an evacuation destination or route.
- If the alert text is unclear or incomplete, say so in one short sentence instead of guessing.
- Maximum 4 short sentences. Output only the summary text.`

export async function summarizeAlert(a: AlertRecord, opts: { language?: string; llm?: LlmClient | null; model?: string; now?: number } = {}): Promise<AlertAiSummary> {
  const language = (opts.language || 'en').toLowerCase()
  const generatedAt = new Date(opts.now ?? Date.now()).toISOString()
  const fallback = (rejectedReason?: string): AlertAiSummary => ({ text: templateSummary(a), language: 'en', method: 'template', generatedAt, ...(rejectedReason ? { rejectedReason } : {}) })
  if (!opts.llm) return fallback()
  const user = `Alert severity (fixed, do not change): ${SEVERITY_LABELS[a.severity]}\nHazard: ${HAZARD_TYPES[a.hazard_type]}\nSource: ${a.source_name}\nTitle: ${a.title}\nArea: ${a.affected_area}\nDescription: ${a.description}\nInstructions from source: ${a.instruction ?? '(none given)'}\nIssued: ${a.issued_at}\nExpires: ${a.expires_at ?? '(not stated)'}\n\nWrite the summary in language code "${language}".`
  try {
    const text = (await opts.llm(SYSTEM, user)).trim()
    const v = validateAiText(text, a)
    if (!v.ok) return fallback(v.reason)
    return { text, language, method: 'llm', model: opts.model, generatedAt }
  } catch (e) {
    return fallback(`AI service error: ${(e instanceof Error ? e.message : 'unknown').replace(/https?:\/\/\S+/g, '[url]').slice(0, 100)}`)
  }
}

export function createAnthropicClient(env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch): { client: LlmClient; model: string } | null {
  const alt = aiProvider(env)
  if (alt === 'gemini' || alt === 'openai') {
    const m = modelFor(alt, env, true)
    return { client: (system, user) => callText({ provider: alt, env, fetchImpl, model: m, system, user, maxTokens: 400, timeoutMs: 20_000 }), model: m }
  }
  const key = env.ANTHROPIC_API_KEY
  if (!key) return null
  const model = env.ALERT_AI_MODEL || 'claude-haiku-5-5'
  const client: LlmClient = async (system, user) => {
    const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 400, temperature: 0, system, messages: [{ role: 'user', content: user }] }),
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as { content?: { type: string; text?: string }[] }
    return (data.content || []).filter((c) => c.type === 'text').map((c) => c.text || '').join('')
  }
  return { client, model }
}
