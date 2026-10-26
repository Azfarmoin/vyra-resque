// Content checks used by the tests and by the admin editor before anything can be published.
// They catch missing parts, unknown illustrations, invented phone numbers and a few known-dangerous omissions.
import { SCENES } from './scenes'
import { PHASES, type HazardGuide, type Step } from './types'

const phone = /\b(911|999|112|1122|1166)\b|\bcall\s+(15|16|100|115)\b/i // numbers must come from config.ts, never from guide text
const allSteps = (g: HazardGuide): Step[] => [...g.before, ...g.during, ...g.after, ...g.waiting.flatMap((w) => w.steps)]
const textOf = (steps: Step[]) => steps.flatMap((s) => [s.title, ...s.do, ...s.dont, s.remember ?? '', s.detail ?? '']).join(' \n ')

// Phrases a guide MUST contain in the given phase (case-insensitive). Prevents shipping a guide that leaves out the key action.
const REQUIRED: Record<string, { phase: 'before' | 'during' | 'waiting' | 'after'; re: RegExp; why: string }[]> = {
  flood: [{ phase: 'during', re: /walk, swim or drive through floodwater/i, why: 'must say never to walk, swim or drive through floodwater' }, { phase: 'during', re: /higher ground/i, why: 'must say to move to higher ground' }],
  'urban-flood': [{ phase: 'during', re: /manhole/i, why: 'must warn about hidden open manholes' }, { phase: 'during', re: /electrical equipment with wet hands/i, why: 'must warn about wet electrical equipment' }],
  earthquake: [{ phase: 'during', re: /drop[^.]*cover[^.]*hold on/i, why: 'must teach Drop, Cover and Hold On' }, { phase: 'during', re: /lift/i, why: 'must say not to use the lift' }, { phase: 'waiting', re: /match/i, why: 'trapped guidance must warn against matches' }],
  fire: [{ phase: 'during', re: /lift/i, why: 'must say not to use the lift' }, { phase: 'during', re: /stay low|crawl/i, why: 'must say to stay low under smoke' }, { phase: 'during', re: /back of your hand/i, why: 'must check doors' }],
  collapse: [{ phase: 'waiting', re: /match/i, why: 'must warn against matches' }, { phase: 'waiting', re: /tap|whistle/i, why: 'trapped guidance must say how to signal' }, { phase: 'waiting', re: /dig/i, why: 'must warn bystanders against digging by hand' }],
  storm: [{ phase: 'during', re: /windows/i, why: 'must say to stay away from windows' }, { phase: 'during', re: /eye/i, why: 'must warn about the calm eye' }, { phase: 'after', re: /carbon monoxide/i, why: 'must warn about generators' }],
  landslide: [{ phase: 'during', re: /path/i, why: 'must say to move out of the path' }],
  heat: [{ phase: 'during', re: /parked vehicle/i, why: 'must warn about parked vehicles' }, { phase: 'waiting', re: /unconscious/i, why: 'must warn against giving drinks to an unconscious person' }],
  electrical: [{ phase: 'during', re: /assume a fallen wire is live|live/i, why: 'must say to treat wires as live' }, { phase: 'during', re: /do not touch/i, why: 'must say not to touch' }],
  road: [{ phase: 'during', re: /traffic/i, why: 'must say to get out of traffic' }],
  chemical: [{ phase: 'during', re: /official instructions/i, why: 'must put official instructions first' }, { phase: 'during', re: /light switches/i, why: 'must warn about switches and flames near gas' }],
  tsunami: [{ phase: 'during', re: /inland|uphill|high ground/i, why: 'must say to go inland or uphill' }, { phase: 'waiting', re: /all-clear/i, why: 'must say to wait for the all-clear' }],
}

export function lintGuide(g: HazardGuide, now = Date.now()): string[] {
  const errs: string[] = []
  const e = (m: string) => errs.push(`${g.id}: ${m}`)
  if (!g.title || g.title.length > 70) e('title missing or too long')
  if (g.short.length > 120) e('short description too long')
  for (const p of PHASES) {
    const steps = p === 'waiting' ? g.waiting.flatMap((w) => w.steps) : g[p]
    if (!steps.length) e(`${p} has no steps`)
  }
  if (!g.waiting.length) e('no waiting-for-rescue scenarios')
  const ids = new Set<string>()
  for (const s of allSteps(g)) {
    if (!(s.scene in SCENES)) e(`step ${s.id}: unknown illustration "${s.scene}"`)
    if (!s.do.length && !s.dont.length) e(`step ${s.id}: needs a DO or a DON'T`)
    if (s.title.length > 70) e(`step ${s.id}: title too long`)
    for (const line of [...s.do, ...s.dont, s.remember ?? '']) if (line.length > 260) e(`step ${s.id}: sentence too long for a stressed reader`)
  }
  for (const w of g.waiting) {
    const seen = new Set<string>()
    for (const s of w.steps) { if (seen.has(s.id)) e(`scenario ${w.id}: duplicate step id ${s.id}`); seen.add(s.id) }
    if (!w.steps.length) e(`scenario ${w.id}: empty`)
  }
  void ids
  if (phone.test(textOf(allSteps(g)) + ' ' + Object.values(g.quick).flat().join(' '))) e('contains something that looks like an emergency number: numbers come from configuration')
  if (g.sources.length < 2 || g.sources.some((s) => !/^https:\/\//.test(s.url))) e('needs at least two https sources')
  if (!g.sources.some((s) => s.checked)) e('needs at least one source that was actually read')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(g.content_checked_on)) e('content_checked_on must be a date')
  if (Date.parse(g.content_checked_on) > now + 86_400_000) e('content_checked_on is in the future')
  for (const k of ['danger', 'trapped', 'injured', 'waiting', 'safe'] as const) if (!g.quick[k].length) e(`quick.${k} is empty`)
  if (!g.waiting.some((w) => /Do not (go into danger|enter|go back|go in|go out|approach)|Do not (touch|walk|enter)/i.test(textOf(w.steps)))) e('waiting guidance must warn against entering danger')
  for (const r of REQUIRED[g.id] ?? []) {
    const steps = r.phase === 'waiting' ? g.waiting.flatMap((w) => w.steps) : g[r.phase]
    if (!r.re.test(textOf(steps))) e(`${r.phase} ${r.why}`)
  }
  if (g.id === 'collapse' || g.id === 'earthquake') for (const s of allSteps(g)) for (const l of s.do) if (/\blight a match\b/i.test(l)) e('tells people to light a match')
  return errs
}

export const isStale = (g: HazardGuide, now = Date.now(), days = 365) => now - Date.parse(g.expert_reviewed?.on ?? g.content_checked_on) > days * 86_400_000
