// Stage 6 - Explainable Triage Engine.
// Pure functions: the same report at the same moment always gets the same result,
// and every point in the score comes with a plain-language reason.

import { TRIAGE_RULES, type TriageRules } from './triageRules'
import {
  DANGERS,
  INJURY_SEVERITIES,
  MEDICAL_NEEDS,
  VULNERABILITIES,
  PRIORITIES,
  PRIORITY_LABELS,
  OPEN_STATUSES,
  type Priority,
} from './constants'
import type { ReportRow, ReportSummary, TriagedReport, TriageFactor, TriageResult } from './types'

export const TRIAGE_VERSION = 'rules-v1'

// critical = 4 ... low = 1
export const priorityRank = (p?: Priority | null) => (p ? PRIORITIES.length - PRIORITIES.indexOf(p) : 0)

const list = (keys: readonly string[], labels: Record<string, string>) => keys.map((k) => labels[k] || k).join(', ')
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export function formatMinutes(min: number) {
  if (min < 60) return plural(min, 'minute')
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${plural(h, 'hour')} ${m} min` : plural(h, 'hour')
}

function scoreToPriority(score: number, { thresholds }: TriageRules): Priority {
  if (score >= thresholds.critical) return 'critical'
  if (score >= thresholds.high) return 'high'
  if (score >= thresholds.medium) return 'medium'
  return 'low'
}

type TriageInput = Partial<ReportRow> & Pick<ReportRow, 'created_at'>

export function triageReport(
  report: TriageInput,
  { now = new Date(), rules = TRIAGE_RULES }: { now?: Date; rules?: TriageRules } = {}
): TriageResult {
  const factors: TriageFactor[] = []
  const flags: string[] = []
  const floors: { priority: Priority; reason: string }[] = []
  const unknowns: string[] = []
  const add = (key: string, category: string, points: number, detail: string) => {
    if (points > 0) factors.push({ key, category, points, detail })
  }

  // 1. Immediate threats to life
  const reported = report.dangers || []
  const dangers = reported.filter((d) => d !== 'none')
  let lifeThreat: string | null = null
  if (dangers.length) {
    const scored = dangers
      .map((key) => ({ key, ...(rules.dangers[key] || rules.dangers.other) }))
      .sort((a, b) => b.points - a.points)
    const points = Math.min(scored[0].points + (scored.length - 1) * rules.additionalDangerPoints, rules.maxDangerPoints)
    lifeThreat = scored.find((s) => s.lifeThreat)?.key ?? null
    const extra = scored.length > 1 ? ` - most severe counted in full, +${rules.additionalDangerPoints} for each other danger` : ''
    add('danger', lifeThreat ? 'Immediate threat to life' : 'Hazard reported', points, `Reported: ${list(scored.map((s) => s.key), DANGERS)}${extra}`)
    if (lifeThreat) {
      floors.push({ priority: 'high', reason: `an immediate threat to life was reported (${DANGERS[lifeThreat as keyof typeof DANGERS]})` })
    }
  } else if (!reported.includes('none')) {
    unknowns.push('immediate danger')
  }

  // 2. Serious injuries and urgent medical needs
  const severity = report.injury_severity || 'unknown'
  if (severity === 'unknown') {
    unknowns.push('injuries')
  } else if (rules.injuries[severity] > 0) {
    let points = rules.injuries[severity]
    let detail: string = INJURY_SEVERITIES[severity]
    const count = report.injury_count ?? 0
    if ((severity === 'serious' || severity === 'critical') && count > 1) {
      const extra = Math.min((count - 1) * rules.extraInjuredPersonPoints, rules.maxExtraInjuredPoints)
      points += extra
      detail += ` - ${count} people injured (+${extra})`
    }
    add('injury', severity === 'minor' ? 'Minor injuries' : 'Serious injury', points, detail)
    if (severity === 'critical') floors.push({ priority: 'high', reason: 'a critical injury was reported' })
  }

  const needs = report.medical_need_types || []
  const lifeSustaining = needs.filter((n) => rules.lifeSustainingNeeds.includes(n))
  const otherNeeds = needs.filter((n) => !rules.lifeSustainingNeeds.includes(n))
  if (needs.length) {
    let points = 0
    if (lifeSustaining.length) points += rules.firstLifeSustainingPoints + (lifeSustaining.length - 1) * rules.additionalMedicalPoints
    points = Math.min(points + otherNeeds.length * rules.otherMedicalPoints, rules.maxMedicalPoints)
    const parts: string[] = []
    if (lifeSustaining.length) parts.push(`time-critical: ${list(lifeSustaining, MEDICAL_NEEDS)}`)
    if (otherNeeds.length) parts.push(`other: ${list(otherNeeds, MEDICAL_NEEDS)}`)
    add('medical', lifeSustaining.length ? 'Urgent medical need' : 'Medical need', points, parts.join('; '))
  }

  // 3. People unable to evacuate without assistance
  if (report.can_evacuate === 'no') {
    add('evacuation', 'Cannot evacuate without help', rules.cannotEvacuatePoints, 'Reporter says the people cannot leave without assistance')
  } else if (!report.can_evacuate || report.can_evacuate === 'unknown') {
    unknowns.push('ability to evacuate')
  }
  const vulns = report.vulnerabilities || []
  if (vulns.length) {
    const points = Math.min(vulns.reduce((s, v) => s + (rules.vulnerabilityPoints[v] || 0), 0), rules.maxVulnerabilityPoints)
    add('vulnerability', 'Vulnerable people present', points, list(vulns, VULNERABILITIES))
  }

  // 4. Number of people affected
  const people = report.people_count
  if (people == null) {
    unknowns.push('number of people')
  } else {
    const band = rules.peopleBands.find((b) => people <= b.max)!
    add('people', 'People affected', band.points, `${people} ${people === 1 ? 'person needs' : 'people need'} assistance`)
  }

  // Free-text cues - never the only basis, always labelled
  const text = [report.danger_details, report.injury_details, report.medical_needs].filter(Boolean).join(' ')
  if (text) {
    const hits = rules.keywordCues.filter((c) => c.pattern.test(text))
    if (hits.length) {
      const points = Math.min(hits.reduce((s, c) => s + c.points, 0), rules.maxKeywordPoints)
      add('keywords', 'Description mentions', points, `${hits.map((h) => h.label).join('; ')} (from free text - please confirm)`)
      flags.push('Some points come from words in the description; confirm with the reporter when possible.')
    }
  }

  // 5. Waiting time
  const created = new Date(report.created_at)
  const status = report.status || 'pending'
  const isOpen = OPEN_STATUSES.includes(status)
  const end = isOpen ? now : new Date(report.resolved_at || report.updated_at || now)
  const waitingMinutes = Math.max(0, Math.floor((end.getTime() - created.getTime()) / 60000))
  if (isOpen) {
    const points = Math.min(Math.floor(waitingMinutes / rules.waitingStepMinutes) * rules.waitingPointsPerStep, rules.maxWaitingPoints)
    add('waiting', 'Waiting time', points, `Waiting ${formatMinutes(waitingMinutes)} (+${rules.waitingPointsPerStep} per ${rules.waitingStepMinutes} min, max ${rules.maxWaitingPoints})`)
    if (waitingMinutes >= rules.longWaitMinutes && status === 'pending') flags.push(`Not picked up after ${formatMinutes(waitingMinutes)}.`)
  }

  // Missing information must not be read as low risk
  if (unknowns.length) {
    const points = Math.min(unknowns.length * rules.unknownFieldPoints, rules.maxUnknownPoints)
    add('unknown', 'Missing information', points, `Not reported: ${unknowns.join(', ')}. Unknown is treated as possible risk, not as safe.`)
    flags.push(`Verify with the reporter: ${unknowns.join(', ')}.`)
    if (unknowns.length >= rules.unknownFieldsForMediumFloor) {
      floors.push({ priority: 'medium', reason: `${unknowns.length} key details are missing, so it cannot be ruled low risk` })
    }
  }

  // Combined safety rule
  if (lifeThreat && (severity === 'critical' || report.can_evacuate === 'no' || lifeSustaining.length)) {
    const why = severity === 'critical' ? 'a critical injury' : report.can_evacuate === 'no' ? 'people who cannot evacuate' : 'a time-critical medical need'
    floors.push({ priority: 'critical', reason: `an immediate threat to life combined with ${why}` })
  }

  if (report.verified === false) flags.push('Report is not yet verified.')
  if ((report.location_accuracy_m ?? 0) > 200) flags.push(`GPS accuracy is low (about ${Math.round(report.location_accuracy_m!)} m).`)

  factors.sort((a, b) => b.points - a.points)
  const score = factors.reduce((s, f) => s + f.points, 0)
  const scorePriority = scoreToPriority(score, rules)

  let priority = scorePriority
  let applied: (typeof floors)[number] | null = null
  for (const floor of floors) {
    if (priorityRank(floor.priority) > priorityRank(priority)) {
      priority = floor.priority
      applied = floor
    }
  }
  const safetyRules = applied
    ? [`Raised from ${PRIORITY_LABELS[scorePriority]} to ${PRIORITY_LABELS[priority]} because ${applied.reason}.`]
    : []

  const main = factors.slice(0, 3).map((f) => f.category.toLowerCase())
  const summary =
    `${PRIORITY_LABELS[priority]} priority (score ${score}). ` +
    (main.length ? `Main factors: ${main.join(', ')}.` : 'No risk factors reported.') +
    (safetyRules.length ? ` ${safetyRules[0]}` : '')

  return {
    version: TRIAGE_VERSION,
    computedAt: now.toISOString(),
    score,
    scorePriority,
    suggestedPriority: priority,
    factors,
    safetyRules,
    flags,
    unknowns,
    waitingMinutes,
    summary,
  }
}

// Whether any reported danger is an immediate threat to life (stored in immediate_danger).
export const hasLifeThreat = (dangers: readonly string[] = []) =>
  dangers.some((d) => TRIAGE_RULES.dangers[d as keyof typeof TRIAGE_RULES.dangers]?.lifeThreat)

// Report + its triage. A responder override, when present, is the effective priority.
export function withTriage(report: ReportRow, opts?: { now?: Date }): TriagedReport {
  const triage = triageReport(report, opts)
  const override = report.triage_override?.priority ? report.triage_override : null
  return { ...report, triage, overridden: Boolean(override), priority: override ? override.priority : triage.suggestedPriority }
}

// Highest priority first, then highest score, then longest waiting.
export function compareByTriage(a: TriagedReport, b: TriagedReport) {
  return (
    priorityRank(b.priority) - priorityRank(a.priority) ||
    b.triage.score - a.triage.score ||
    new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  )
}

export function summarize(items: TriagedReport[]): ReportSummary {
  const byStatus: ReportSummary['byStatus'] = {}
  for (const i of items) byStatus[i.status] = (byStatus[i.status] || 0) + 1
  return {
    total: items.length,
    byPriority: Object.fromEntries(PRIORITIES.map((p) => [p, items.filter((i) => i.priority === p).length])) as ReportSummary['byPriority'],
    byStatus,
    overridden: items.filter((i) => i.overridden).length,
    unverified: items.filter((i) => !i.verified).length,
  }
}
