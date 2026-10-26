import { z } from 'zod'
import { HAZARD_TYPES, SEVERITIES } from './types'
import type { AnnouncementInput } from './manual'

// Validation for the admin announcement form (kept apart from manual.ts so the publishing logic has no runtime dependencies).
export const announcementSchema: z.ZodType<AnnouncementInput> = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().min(10).max(4000),
  instruction: z.string().trim().max(2000).optional().nullable(),
  severity: z.enum(SEVERITIES),
  hazard_type: z.enum(Object.keys(HAZARD_TYPES) as [keyof typeof HAZARD_TYPES, ...(keyof typeof HAZARD_TYPES)[]]),
  affected_area: z.string().trim().min(2).max(300),
  circle: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), radiusKm: z.number().min(0.1).max(2000) }).optional().nullable(),
  source_url: z.string().url().max(500).refine((u) => u.startsWith('https://'), 'Link must be https').optional().nullable(),
  expires_at: z.string().datetime({ offset: true }),
  notify: z.boolean().optional(),
  verified_confirmation: z.literal(true),
})
