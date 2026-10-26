// Structured result of analysing ONE report photo. Everything the model returns is validated against
// ModelOutputSchema, then passed through safety.ts, before it is displayed or saved.
import { z } from 'zod'

export const INCIDENT_TYPES = {
  flooding: 'Flooding or standing water',
  fire: 'Fire or flames',
  smoke: 'Visible smoke',
  building_collapse: 'Collapsed building',
  building_damage: 'Damaged building',
  bridge_damage: 'Damaged bridge',
  road_blockage: 'Blocked road',
  debris: 'Debris',
  landslide: 'Landslide or mudslide',
  fallen_tree: 'Fallen tree',
  storm_damage: 'Storm damage',
  infrastructure_damage: 'Damaged infrastructure',
  person_may_need_assistance: 'Person who may need assistance',
  other_hazard: 'Other visible hazard',
  no_disaster_evidence: 'No disaster evidence visible',
  unclear: 'Unclear',
} as const
export type IncidentType = keyof typeof INCIDENT_TYPES
export const INCIDENT_KEYS = Object.keys(INCIDENT_TYPES) as [IncidentType, ...IncidentType[]]

// Severity is a PRELIMINARY hint for a human reviewer, never a decision.
export const SEVERITIES = ['not_determined', 'low', 'moderate', 'high'] as const
export type Severity = (typeof SEVERITIES)[number]

// The model's own rough certainty. It is NOT a calibrated probability and is shown as words only.
export const CONFIDENCES = ['low', 'medium', 'high'] as const
export type Confidence = (typeof CONFIDENCES)[number]

export const ANALYSIS_STATUSES = ['pending', 'processing', 'completed', 'failed'] as const
export type AnalysisStatus = (typeof ANALYSIS_STATUSES)[number]

export const REVIEW_STATUSES = ['unreviewed', 'confirmed', 'rejected', 'needs_more_info'] as const
export type ReviewStatus = (typeof REVIEW_STATUSES)[number]

export const USER_ACTIONS = ['none', 'used', 'edited', 'ignored'] as const
export type UserAction = (typeof USER_ACTIONS)[number]

export const LIMITS = { items: 8, itemChars: 240, title: 100, description: 600 }

const item = z.string().trim().min(1).max(LIMITS.itemChars * 2)
const list = z.array(item).max(LIMITS.items * 2).default([])

/** What the model must return (the forced tool call). Unknown keys are dropped; numbers for confidence are rejected. */
export const ModelOutputSchema = z.object({
  detected_incident_types: z.array(z.enum(INCIDENT_KEYS)).max(INCIDENT_KEYS.length).default([]),
  visual_observations: list,
  possible_hazards: list,
  damage_indicators: list,
  possible_road_blockages: list,
  suggested_report_title: z.string().trim().max(LIMITS.title * 2).default(''),
  suggested_description: z.string().trim().max(LIMITS.description * 2).default(''),
  suggested_severity: z.enum(SEVERITIES).default('not_determined'),
  confidence: z.enum(CONFIDENCES),
  limitations: list,
  review_required: z.boolean().optional(),
})
export type ModelOutput = z.infer<typeof ModelOutputSchema>

/** What VYRA stores and shows: the cleaned model output plus provenance. */
export interface PhotoAnalysisResult {
  detected_incident_types: IncidentType[]
  visual_observations: string[]
  possible_hazards: string[]
  damage_indicators: string[]
  possible_road_blockages: string[]
  suggested_report_title: string
  suggested_description: string
  suggested_severity: Severity
  confidence: Confidence
  limitations: string[]
  /** Always true: a person must verify before anything is relied on. */
  review_required: true
  analysis_status: AnalysisStatus
  analyzed_at: string | null
  model_provider: string | null
  model_version: string | null
  /** Why a failed analysis failed, in words a reporter can read. */
  failure_reason?: string | null
  /** How many statements the safety checks removed. */
  removed_statements?: number
}

export interface AnalysisRow {
  id: string
  attachment_id: string
  report_id: string
  uploader_id: string | null
  analysis_status: AnalysisStatus
  result: PhotoAnalysisResult | null
  consent_at: string | null
  model_provider: string | null
  model_version: string | null
  analyzed_at: string | null
  failure_reason: string | null
  review_status: ReviewStatus
  reviewed_by: string | null
  reviewed_at: string | null
  review_note: string | null
  user_action: UserAction
  attempts: number
  created_at: string
  updated_at: string
}

export const reviewBodySchema = z.object({
  review_status: z.enum(REVIEW_STATUSES).optional(),
  review_note: z.string().trim().max(500).nullish(),
  user_action: z.enum(USER_ACTIONS).optional(),
})

export const analyzeBodySchema = z.object({
  consent: z.literal(true, { errorMap: () => ({ message: 'Consent to photo analysis is required' }) }),
  force: z.boolean().optional().default(false),
})

/** Hand-written JSON Schema for the forced tool call (kept next to the zod schema; a test checks they agree). */
export const TOOL_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['detected_incident_types', 'visual_observations', 'possible_hazards', 'damage_indicators', 'possible_road_blockages', 'suggested_report_title', 'suggested_description', 'suggested_severity', 'confidence', 'limitations'],
  properties: {
    detected_incident_types: { type: 'array', items: { type: 'string', enum: INCIDENT_KEYS } },
    visual_observations: { type: 'array', maxItems: LIMITS.items, items: { type: 'string', maxLength: LIMITS.itemChars }, description: 'Only what is plainly visible.' },
    possible_hazards: { type: 'array', maxItems: LIMITS.items, items: { type: 'string', maxLength: LIMITS.itemChars }, description: 'Hazards the visible evidence MAY suggest. Hedge them.' },
    damage_indicators: { type: 'array', maxItems: LIMITS.items, items: { type: 'string', maxLength: LIMITS.itemChars } },
    possible_road_blockages: { type: 'array', maxItems: LIMITS.items, items: { type: 'string', maxLength: LIMITS.itemChars } },
    suggested_report_title: { type: 'string', maxLength: LIMITS.title },
    suggested_description: { type: 'string', maxLength: LIMITS.description, description: 'Based only on this image; no location, no identities.' },
    suggested_severity: { type: 'string', enum: SEVERITIES },
    confidence: { type: 'string', enum: CONFIDENCES },
    limitations: { type: 'array', maxItems: LIMITS.items, items: { type: 'string', maxLength: LIMITS.itemChars } },
    review_required: { type: 'boolean' },
  },
} as const
