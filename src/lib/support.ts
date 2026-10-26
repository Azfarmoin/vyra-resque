// Support requests ("Contact us"): shared constants and validation, used by the browser form AND the
// API route, so both sides enforce exactly the same rules. No email is ever sent: requests are saved
// to the database and shown to administrators inside VYRA.
import { z } from 'zod'

export const SUPPORT_CATEGORIES = {
  technical: 'Technical issue',
  report_problem: 'Report problem',
  account: 'Account issue',
  privacy: 'Privacy concern',
  general: 'General inquiry',
} as const
export type SupportCategory = keyof typeof SUPPORT_CATEGORIES

export const SUPPORT_STATUSES = { open: 'Open', in_progress: 'In progress', resolved: 'Resolved' } as const
export type SupportStatus = keyof typeof SUPPORT_STATUSES

export const SUPPORT_LIMITS = {
  name: { min: 2, max: 120 },
  email: { max: 200 },
  subject: { min: 3, max: 150 },
  message: { min: 10, max: 4000 },
  reportReference: { max: 40 },
  maxLinks: 2,
  /** A person cannot read and fill in the form faster than this; anything quicker is a script. */
  minFillMs: 2500,
} as const

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// The reference a reporter sees is 6 letters/digits (e.g. 3F9A1C); the full report id (a UUID) is accepted too.
export const REPORT_REF_RE = /^[A-Za-z0-9][A-Za-z0-9-]{4,39}$/
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g

/** Trim, drop control characters and normalise newlines. Applied on both sides before validating. */
export const clean = (v: unknown) => (typeof v === 'string' ? v.replace(CONTROL_CHARS, '').replace(/\r\n?/g, '\n').trim() : '')

export const countLinks = (text: string) => (text.match(/https?:\/\/|www\./gi) || []).length

const L = SUPPORT_LIMITS
const text = (label: string, min: number, max: number) =>
  z
    .preprocess(clean, z.string())
    .pipe(z.string().min(min, min === 1 ? `Enter ${label}.` : `${label[0].toUpperCase()}${label.slice(1)} must be at least ${min} characters.`).max(max, `${label[0].toUpperCase()}${label.slice(1)} must be at most ${max} characters.`))

export const supportInputSchema = z.object({
  name: text('your name', L.name.min, L.name.max),
  email: z
    .preprocess(clean, z.string())
    .pipe(z.string().max(L.email.max, `Email must be at most ${L.email.max} characters.`))
    .refine((v) => v === '' || EMAIL_RE.test(v), 'Enter a valid email address, like name@example.com, or leave it empty.')
    .transform((v) => v.toLowerCase() || null),
  subject: text('the subject', L.subject.min, L.subject.max),
  category: z.enum(Object.keys(SUPPORT_CATEGORIES) as [SupportCategory, ...SupportCategory[]], {
    errorMap: () => ({ message: 'Choose a category.' }),
  }),
  message: text('your message', L.message.min, L.message.max).refine((v) => countLinks(v) <= L.maxLinks, `Please include at most ${L.maxLinks} links.`),
  report_reference: z
    .preprocess(clean, z.string())
    .pipe(z.string().max(L.reportReference.max))
    .refine((v) => v === '' || REPORT_REF_RE.test(v), 'Use the reference number from your report (letters, numbers and dashes only), or leave it empty.')
    .transform((v) => v.toUpperCase() || null),
})
export type SupportInput = z.infer<typeof supportInputSchema>

/** What the browser sends: the form fields plus anti-spam signals. */
export const supportSubmitSchema = supportInputSchema.and(
  z.object({
    website: z.string().max(200).optional(), // honeypot: real people never see or fill this field
    elapsed_ms: z.number().int().min(0).max(1000 * 60 * 60 * 24).optional(), // time spent on the form
  }),
)

export const supportUpdateSchema = z
  .object({
    status: z.enum(Object.keys(SUPPORT_STATUSES) as [SupportStatus, ...SupportStatus[]]).optional(),
    category: z.enum(Object.keys(SUPPORT_CATEGORIES) as [SupportCategory, ...SupportCategory[]]).optional(),
  })
  .refine((v) => v.status || v.category, 'Provide a status or a category to change.')

export interface SupportRequestRow {
  id: string
  reference: string
  user_id: string | null
  name: string
  email: string | null
  subject: string
  category: SupportCategory
  message: string
  report_reference: string | null
  status: SupportStatus
  created_at: string
  updated_at: string
}

/** Support reference IDs look like SUP-7K3M9QX2 (no 0/O/1/I so they are easy to read out and type). */
export const SUPPORT_REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const SUPPORT_REF_RE = /^SUP-[A-HJ-NP-Z2-9]{8}$/
