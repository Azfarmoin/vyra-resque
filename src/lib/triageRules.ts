// Explainable triage rules (Stage 6). Every number here shows up in the explanation a
// responder sees, so tune them with responders and keep them readable.

import type { Danger, Vulnerability, MedicalNeed, InjurySeverity } from './constants'

export const TRIAGE_RULES = {
  // Score needed for each level (checked highest first).
  thresholds: { critical: 70, high: 45, medium: 20 },

  // 1. Immediate threats to life. The most severe danger counts in full; each further
  //    danger adds `additionalDangerPoints`, up to `maxDangerPoints`.
  dangers: {
    drowning: { points: 45, lifeThreat: true },
    trapped: { points: 40, lifeThreat: true },
    building_collapse: { points: 40, lifeThreat: true },
    fire: { points: 40, lifeThreat: true },
    rising_water: { points: 35, lifeThreat: true },
    electrocution: { points: 35, lifeThreat: true },
    landslide: { points: 35, lifeThreat: true },
    gas_leak: { points: 30, lifeThreat: true },
    extreme_heat: { points: 25, lifeThreat: false },
    stranded: { points: 18, lifeThreat: false },
    no_shelter: { points: 12, lifeThreat: false },
    no_food_water: { points: 10, lifeThreat: false },
<<<<<<< HEAD
    earthquake: { points: 20, lifeThreat: false },
    medical_emergency: { points: 20, lifeThreat: false },
    blocked_road: { points: 8, lifeThreat: false },
=======
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
    other: { points: 10, lifeThreat: false },
    none: { points: 0, lifeThreat: false },
  } satisfies Record<Danger, { points: number; lifeThreat: boolean }>,
  additionalDangerPoints: 5,
  maxDangerPoints: 50,

  // 2. Serious injuries and urgent medical needs.
  injuries: { critical: 35, serious: 25, minor: 6, none: 0, unknown: 0 } satisfies Record<InjurySeverity, number>,
  extraInjuredPersonPoints: 3, // per injured person beyond the first (serious/critical only)
  maxExtraInjuredPoints: 9,

  lifeSustainingNeeds: ['dialysis', 'oxygen', 'insulin', 'essential_medication', 'pregnancy_labor', 'heart_condition'] as MedicalNeed[],
  firstLifeSustainingPoints: 15,
  additionalMedicalPoints: 4,
  otherMedicalPoints: 5,
  maxMedicalPoints: 25,

  // 3. People unable to evacuate without help.
  cannotEvacuatePoints: 20,
  vulnerabilityPoints: { bedridden: 8, disability: 8, elderly: 5, infants_children: 5, pregnant: 5 } satisfies Record<Vulnerability, number>,
  maxVulnerabilityPoints: 16,

  // 4. Number of people affected (upper bound inclusive).
  peopleBands: [
    { max: 1, points: 2 },
    { max: 4, points: 5 },
    { max: 9, points: 10 },
    { max: 24, points: 15 },
    { max: Infinity, points: 20 },
  ],

  // 5. How long an open request has been waiting.
  waitingPointsPerStep: 1,
  waitingStepMinutes: 10,
  maxWaitingPoints: 15,
  longWaitMinutes: 60,

  // Missing information is NOT evidence of low risk: each unknown key field adds points and
  // a "verify" flag, and enough unknowns set a Medium floor.
  unknownFieldPoints: 5,
  maxUnknownPoints: 15,
  unknownFieldsForMediumFloor: 2,

  // Free-text cues. They add points and are always labelled as text-derived.
  keywordCues: [
    { pattern: /\b(not breathing|unconscious|unresponsive|no pulse)\b/i, points: 20, label: 'possible loss of consciousness or breathing' },
    { pattern: /\b(heavy|severe|lots of) bleeding\b|\bbleeding heavily\b/i, points: 15, label: 'heavy bleeding' },
    { pattern: /\b(drowning|swept away|under water)\b/i, points: 15, label: 'possible drowning' },
    { pattern: /\b(trapped|stuck|can'?t get out|cannot get out)\b/i, points: 10, label: 'people may be trapped' },
    { pattern: /\b(roof|rooftop)\b/i, points: 8, label: 'people may be sheltering on a roof' },
    { pattern: /\b(baby|newborn|infant)\b/i, points: 5, label: 'infant mentioned' },
  ],
  maxKeywordPoints: 25,
}

export type TriageRules = typeof TRIAGE_RULES
