// Request validation for the simulator (zod). Every number has a physical range; anything outside it is rejected with a
// message a responder can act on instead of being clamped silently.
import { z } from 'zod'
import { AREAS } from '../constants'

const lat = z.number({ invalid_type_error: 'Latitude must be a number.' }).finite().min(-90, 'Latitude must be between -90 and 90.').max(90, 'Latitude must be between -90 and 90.')
const lng = z.number({ invalid_type_error: 'Longitude must be a number.' }).finite().min(-180, 'Longitude must be between -180 and 180.').max(180, 'Longitude must be between -180 and 180.')
export const latLngSchema = z.tuple([lat, lng])

const areaNames = AREAS.map((a) => a.name) as [string, ...string[]]

export const areaSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('operational_area'), name: z.enum(areaNames), radiusM: z.number().finite().min(500, 'Radius must be at least 500 m.').max(10_000, 'Radius can be at most 10 km.').default(3000) }).strict(),
  z.object({ kind: z.literal('polygon'), geometry: z.unknown() }).strict(),
  z.object({ kind: z.literal('vyra_zone'), zoneId: z.string().trim().min(1).max(64) }).strict(),
])
export type AreaSource = z.infer<typeof areaSourceSchema>

const elevationSource = z.enum(['auto', 'geotiff', 'open_meteo']).default('auto')

const isoDate = z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'Use a valid date and time.')

export const scenarioSpecSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('hypothetical_overlay'),
    // Depth ABOVE GROUND, applied evenly. 10 m is already beyond any urban pluvial flood.
    depthM: z.number({ invalid_type_error: 'Enter a depth in metres.' }).finite().gt(0, 'Depth must be greater than 0.').max(10, 'Depth can be at most 10 m.'),
  }).strict(),
  z.object({
    kind: z.literal('terrain_bathtub'),
    // In the VERTICAL DATUM OF THE ELEVATION DATA, not above local ground and not above a tide-gauge chart datum.
    waterSurfaceElevationM: z.number({ invalid_type_error: 'Enter a water level in metres.' }).finite().min(-20).max(200),
    connectivity: z.enum(['none', 'seeded']).default('seeded'),
    seeds: z.array(latLngSchema).max(10, 'Use at most 10 source points.').default([]),
    elevationSource,
  }).strict(),
  z.object({
    kind: z.literal('terrain_rainfall'),
    rainfall: z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('manual'),
        mm: z.number({ invalid_type_error: 'Enter rainfall in millimetres.' }).finite().gt(0, 'Rainfall must be greater than 0.').max(1500, 'Rainfall can be at most 1500 mm.'),
        durationHours: z.number().finite().min(0.25, 'Duration must be at least 15 minutes.').max(720).default(24),
        note: z.string().trim().max(200).optional(),
      }).strict(),
      z.object({ kind: z.literal('open_meteo'), start: isoDate, end: isoDate }).strict(),
    ]),
    runoffCoefficient: z.number().finite().min(0).max(1).default(0.8),
    drainageCapacityMm: z.number().finite().min(0).max(1500).default(0),
    infiltrationMm: z.number().finite().min(0).max(500).default(0),
    elevationSource,
  }).strict(),
])
export type ScenarioSpec = z.infer<typeof scenarioSpecSchema>

export const optionsSchema = z.object({
  minDepthM: z.number().finite().min(0.05, 'The flooded threshold must be at least 0.05 m.').max(1).default(0.1),
  targetCellM: z.number().finite().min(10).max(500).optional(),
  compareObservations: z.object({ from: isoDate, to: isoDate }).strict().optional(),
}).strict()

export const scenarioInputSchema = z.object({
  name: z.string().trim().min(3, 'Give the scenario a name of at least 3 characters.').max(120).optional(),
  description: z.string().trim().max(2000).optional(),
  areaSource: areaSourceSchema,
  scenario: scenarioSpecSchema,
  options: optionsSchema.default({}),
}).strict()
export type ScenarioInput = z.infer<typeof scenarioInputSchema>

export const saveSchema = scenarioInputSchema.extend({ name: z.string().trim().min(3, 'Give the scenario a name of at least 3 characters.').max(120) })

export const patchSchema = z.object({
  name: z.string().trim().min(3).max(120).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
}).strict().refine((v) => v.name !== undefined || v.description !== undefined, 'Send a name or description.')

export const observationSchema = z.object({
  lat, lng,
  depthM: z.number().finite().min(0, 'Depth cannot be negative.').max(20, 'Depth can be at most 20 m.'),
  observedAt: isoDate,
  source: z.string().trim().min(2, 'Say who measured it or where the record comes from.').max(200),
  sourceUrl: z.string().trim().url().max(500).refine((u) => /^https?:\/\//i.test(u), 'Use an http(s) link.').optional(),
  method: z.enum(['gauge', 'field_measurement', 'photo_estimate', 'official_survey', 'other']).optional(),
  notes: z.string().trim().max(1000).optional(),
}).strict()

export const importSchema = z.object({
  name: z.string().trim().min(3).max(120),
  description: z.string().trim().max(2000).optional(),
  area: z.unknown(),
  model: z.object({
    name: z.string().trim().min(2).max(120),
    version: z.string().trim().max(60).optional(),
    software: z.string().trim().max(120).optional(),
    runDate: isoDate.optional(),
    eventDescription: z.string().trim().max(500).optional(),
  }).strict(),
  validation: z.object({
    status: z.enum(['validated', 'unvalidated']),
    method: z.string().trim().max(300).optional(),
    metricName: z.string().trim().max(60).optional(),
    metricValue: z.number().finite().optional(),
    observedEvent: z.string().trim().max(300).optional(),
    reportUrl: z.string().trim().url().max(500).optional(),
    validatedBy: z.string().trim().max(120).optional(),
    validatedAt: isoDate.optional(),
  }).strict(),
  depths: z.object({ type: z.literal('FeatureCollection'), features: z.array(z.unknown()).min(1, 'Send at least one depth polygon.').max(50_000) }),
}).strict()
export type ImportInput = z.infer<typeof importSchema>

export const routeExposureSchema = z.object({
  routes: z.array(z.object({ id: z.string().trim().min(1).max(64), geometry: z.array(latLngSchema).min(2).max(20_000) }).strict()).min(1).max(10),
}).strict()
