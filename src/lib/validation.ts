import { z } from 'zod'
import {
  DANGERS,
  INJURY_SEVERITIES,
  MEDICAL_NEEDS,
  VULNERABILITIES,
  EVACUATION_ABILITY,
  STATUSES,
  PRIORITIES,
<<<<<<< HEAD
  REPORTER_URGENCY,
=======
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
} from './constants'

const keys = <T extends Record<string, unknown>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]]
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null)
const enumList = <T extends Record<string, unknown>>(o: T) =>
  z
    .array(z.enum(keys(o)))
    .max(Object.keys(o).length)
    .default([])
    .transform((a) => [...new Set(a)])

// POST /api/reports - what a citizen submits (Stage 4).
export const createReportSchema = z
  .object({
    client_id: z.string().trim().min(8).max(64).optional(),
    reporter_id: z.string().uuid().nullish(),
<<<<<<< HEAD
    // Coordinates are optional so a report with only a landmark or address can still be sent
    // (e.g. no GPS fix and no map while offline). We never invent coordinates.
    location_lat: z.number().min(-90).max(90).nullish().transform((v) => v ?? null),
    location_lng: z.number().min(-180).max(180).nullish().transform((v) => v ?? null),
    location_source: z.enum(['gps', 'manual']),
    location_accuracy_m: z.number().nonnegative().max(100000).nullish(),
    location_captured_at: z.string().datetime({ offset: true }).nullish().transform((v) => v ?? null),
    incident_time: z.string().datetime({ offset: true }).nullish().transform((v) => v ?? null),
    reporter_urgency: z.enum(keys(REPORTER_URGENCY)).nullish().transform((v) => v ?? null),
    submitted_offline: z.boolean().optional().default(false),
    client_created_at: z.string().datetime({ offset: true }).nullish().transform((v) => v ?? null),
=======
    location_lat: z.number().min(-90).max(90),
    location_lng: z.number().min(-180).max(180),
    location_source: z.enum(['gps', 'manual']),
    location_accuracy_m: z.number().nonnegative().max(100000).nullish(),
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
    location_address: optText(300),
    area: optText(80),
    people_count: z.number().int().min(1).max(10000).nullish().transform((v) => v ?? null),
    dangers: enumList(DANGERS),
    danger_details: optText(1000),
    injury_severity: z.enum(keys(INJURY_SEVERITIES)).default('unknown'),
    injury_count: z.number().int().min(0).max(10000).nullish().transform((v) => v ?? null),
    injury_details: optText(1000),
    medical_need_types: enumList(MEDICAL_NEEDS),
    medical_needs: optText(1000),
    can_evacuate: z.enum(keys(EVACUATION_ABILITY)).default('unknown'),
    vulnerabilities: enumList(VULNERABILITIES),
    contact_name: optText(120),
    contact_phone: z
      .string()
      .trim()
      .max(40)
      .regex(/^[+0-9 ()-]*$/, 'Phone may only contain digits, spaces, + ( ) -')
      .nullish()
      .transform((v) => v || null),
  })
<<<<<<< HEAD
  .refine((r) => (r.location_lat == null) === (r.location_lng == null), {
    message: 'Send both latitude and longitude, or neither',
    path: ['location_lat'],
  })
  .refine((r) => r.location_lat != null || !!r.location_address || !!r.area, {
    message: 'Add coordinates, a landmark/address, or an area so responders know where to look',
    path: ['location_address'],
  })
=======
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
  .refine((r) => !(r.dangers.includes('none') && r.dangers.length > 1), {
    message: '"No immediate danger" cannot be combined with other dangers',
    path: ['dangers'],
  })

export type CreateReportInput = z.infer<typeof createReportSchema>

const actor = z.string().trim().min(1).max(80).default('responder')

export const statusUpdateSchema = z.object({
  status: z.enum(keys(STATUSES)),
  note: optText(500),
  by: actor,
})

export const verifySchema = z.object({ verified: z.boolean(), by: actor })

export const overrideSchema = z.object({
  priority: z.enum(PRIORITIES).nullable(), // null clears the override
  reason: z.string().trim().min(5, 'Please give a reason (at least 5 characters)').max(500),
  by: actor,
})

export const listQuerySchema = z.object({
  area: z.string().trim().max(80).optional(),
  status: z.string().optional(), // comma separated, or "open"
  priority: z.string().optional(), // comma separated
  verified: z.enum(['true', 'false']).optional(),
  bbox: z.string().optional(), // minLng,minLat,maxLng,maxLat
  sort: z.enum(['triage', 'newest']).default('triage'),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
})

export type ListQuery = z.infer<typeof listQuerySchema>
