// Server-side logic shared by the API routes for Stages 4-6.

import { NextResponse } from 'next/server'
import { ZodError, type ZodTypeAny, type output } from 'zod'
import { getStore, StoreError, type ReportFilter } from './db'
import { AREAS, OPEN_STATUSES, STATUSES, nearestArea, type Status } from './constants'
import { compareByTriage, hasLifeThreat, summarize, triageReport, withTriage } from './triage'
import type { CreateReportInput, ListQuery } from './validation'
import type { NewReport, ReportRow, TriagedReport } from './types'

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export function handleError(err: unknown) {
  if (err instanceof ZodError) {
    return NextResponse.json(
      { error: 'Validation failed', details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) },
      { status: 400 }
    )
  }
  if (err instanceof HttpError || err instanceof StoreError) {
<<<<<<< HEAD
    const code = (err as { code?: string }).code // lets the offline sync tell "sign in again" from "rejected"
    return NextResponse.json({ error: err.message, ...(code ? { code } : {}) }, { status: err.status })
=======
    return NextResponse.json({ error: err.message }, { status: err.status })
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
  }
  console.error(err)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}

export async function parseBody<S extends ZodTypeAny>(req: Request, schema: S): Promise<output<S>> {
  const body = await req.json().catch(() => {
    throw new HttpError(400, 'Request body must be JSON')
  })
  return schema.parse(body)
}

export const parseQuery = <S extends ZodTypeAny>(req: Request, schema: S): output<S> =>
  schema.parse(Object.fromEntries(new URL(req.url).searchParams))

// Snapshot of the triage stored on the row so SQL queries/exports can use it too.
// The live value (waiting time grows) is always recomputed on read.
function triageSnapshot(row: Pick<ReportRow, 'created_at'> & Partial<ReportRow>) {
  const t = triageReport(row)
  return { priority_score: t.score, priority_explanation: t }
}

// What a reporter gets back - reference and status only, never other people's details.
export const publicView = (r: ReportRow) => ({
  id: r.id,
  status: r.status,
  status_label: STATUSES[r.status],
  area: r.area,
  created_at: r.created_at,
  updated_at: r.updated_at,
<<<<<<< HEAD
  ingest_channel: r.ingest_channel ?? null, // lets a device see that a radio/SMS copy arrived first
  partial: !!r.partial,
})

export type IngestMeta = { channel: 'radio' | 'sms' | 'bluetooth' | 'manual'; gatewayId: string }

// `reporterId` is the identity the SERVER verified (undefined = fall back to the body, which the
// route only allows for anonymous reports). Retries of the same client_id return the stored report,
// but never one that belongs to a different account.
//
// `opts.ingest` marks a SHORT message that a gateway received over radio/SMS/Bluetooth/manual transfer. It creates a
// "partial" report. When the device later sends the full report (same client_id) the partial one is completed in place:
// one incident, never two, and the original creation time is kept.
export async function createReport(input: CreateReportInput, reporterId?: string | null, opts?: { ingest?: IngestMeta }) {
  const store = getStore()
  const owner = reporterId !== undefined ? reporterId : input.reporter_id ?? null
  const sameOwner = (r: ReportRow) => (r.reporter_id ?? null) === owner
  const { contact_name, contact_phone, area, client_id, ...rest } = input
  const contact = [contact_name, contact_phone].filter(Boolean).join(' · ')
  const build = (): NewReport => ({
    ...rest,
    reporter_id: owner,
    client_id: client_id ?? null,
    location_accuracy_m: rest.location_accuracy_m ?? null,
    area: area && AREAS.some((a) => a.name === area) ? area : input.location_lat != null && input.location_lng != null ? nearestArea(input.location_lat, input.location_lng) : null,
=======
})

export async function createReport(input: CreateReportInput) {
  const store = getStore()
  if (input.client_id) {
    const existing = await store.findReportByClientId(input.client_id)
    if (existing) return { report: existing, duplicate: true }
  }

  const { contact_name, contact_phone, area, client_id, ...rest } = input
  const contact = [contact_name, contact_phone].filter(Boolean).join(' · ')
  const base: NewReport = {
    ...rest,
    reporter_id: rest.reporter_id ?? null,
    client_id: client_id ?? null,
    location_accuracy_m: rest.location_accuracy_m ?? null,
    area: area && AREAS.some((a) => a.name === area) ? area : nearestArea(input.location_lat, input.location_lng),
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
    immediate_danger: hasLifeThreat(input.dangers),
    contact_info: contact || null,
    status: 'pending',
    verified: false,
    resolved_at: null,
    triage_override: null,
    priority_score: 0,
    priority_explanation: null,
<<<<<<< HEAD
  })

  if (client_id) {
    const existing = await store.findReportByClientId(client_id)
    if (existing) {
      // A gateway re-sending a short message for an incident we already hold (partial or complete): nothing to add.
      if (opts?.ingest) return { report: existing, duplicate: true }
      if (existing.partial) {
        // The full report arrived for an incident that so far only had its short message.
        const full = build()
        const { status: _s, verified: _v, resolved_at: _r, triage_override: _t, ...details } = full
        void _s; void _v; void _r; void _t // a responder may already have worked on it: keep that state
        const merged = { ...existing, ...details, reporter_id: existing.reporter_id ?? owner, partial: false }
        const updated = await store.updateReport(existing.id, { ...details, reporter_id: merged.reporter_id, partial: false, ...triageSnapshot(merged) })
        await store.addEvent({
          report_id: existing.id, action: 'created', actor: 'reporter', from_value: null, to_value: null,
          note: `Full report and details received over the internet; they complete the short ${existing.ingest_channel ?? 'emergency'} message received earlier (same incident, not a new one)`,
        })
        return { report: updated, duplicate: true, completed: true }
      }
      if (!existing.partial && !sameOwner(existing)) throw new HttpError(409, 'This report ID belongs to a different account')
      return { report: existing, duplicate: true }
    }
  }

  const base: NewReport = opts?.ingest ? { ...build(), ingest_channel: opts.ingest.channel, partial: true } : build()
=======
  }
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
  const report: NewReport = { ...base, ...triageSnapshot({ ...base, created_at: new Date().toISOString() }) }

  try {
    const saved = await store.insertReport(report)
    await store.addEvent({
      report_id: saved.id,
      action: 'created',
<<<<<<< HEAD
      actor: opts?.ingest ? `gateway:${opts.ingest.gatewayId}` : 'reporter',
      from_value: null,
      to_value: null,
      note: opts?.ingest
        ? `Short emergency message received over ${opts.ingest.channel} by gateway ${opts.ingest.gatewayId}. Full details and photos are pending. Location ${saved.location_lat == null ? 'is a typed description only (unverified)' : 'coordinates came from the sender (unverified)'}`
        : `${saved.location_lat == null ? 'Location is a typed landmark/address only (unverified)' : `Location from ${saved.location_source === 'gps' ? 'device GPS' : 'map selection'}`}${saved.submitted_offline ? '; created offline and synced later' : ''}`,
=======
      actor: 'reporter',
      from_value: null,
      to_value: null,
      note: `Location from ${saved.location_source === 'gps' ? 'device GPS' : 'map selection'}`,
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
    })
    return { report: saved, duplicate: false }
  } catch (err) {
    // Two retries of the same report raced each other - return the one that won.
    if (err instanceof StoreError && err.status === 409 && client_id) {
      const existing = await store.findReportByClientId(client_id)
<<<<<<< HEAD
      if (existing && (existing.partial || sameOwner(existing))) return { report: existing, duplicate: true }
=======
      if (existing) return { report: existing, duplicate: true }
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
    }
    throw err
  }
}

export function toFilter(q: Partial<ListQuery>): ReportFilter {
  const filter: ReportFilter = {}
  if (q.area) filter.area = q.area
  if (q.status) {
    filter.statuses = q.status === 'open' ? OPEN_STATUSES : (q.status.split(',').filter((s) => s in STATUSES) as Status[])
  }
  if (q.verified) filter.verified = q.verified === 'true'
  if (q.bbox) {
    const box = q.bbox.split(',').map(Number)
    if (box.length !== 4 || box.some(Number.isNaN)) throw new HttpError(400, 'bbox must be minLng,minLat,maxLng,maxLat')
    filter.bbox = box as ReportFilter['bbox']
  }
  return filter
}

export async function findTriaged(q: Partial<ListQuery>) {
  const rows = await getStore().listReports(toFilter(q))
  const now = new Date()
  let items = rows.map((r) => withTriage(r, { now }))
  if (q.priority) {
    const wanted = q.priority.split(',')
    items = items.filter((i) => wanted.includes(i.priority))
  }
  items.sort(q.sort === 'newest' ? (a, b) => b.created_at.localeCompare(a.created_at) : compareByTriage)
  return { summary: summarize(items), reports: items.slice(0, q.limit ?? 500), mode: getStore().mode }
}

export async function loadReport(id: string) {
  const report = await getStore().getReport(id)
  if (!report) throw new HttpError(404, 'Report not found')
  return report
}

export async function detail(id: string): Promise<TriagedReport & { history: Awaited<ReturnType<ReturnType<typeof getStore>['listEvents']>> }> {
  const report = await loadReport(id)
  const history = await getStore().listEvents(id)
  return { ...withTriage(report), history }
}

// Saves a change, refreshes the stored triage snapshot and records the audit event.
export async function applyChange(
  id: string,
  patch: Partial<ReportRow>,
  event: { action: 'status' | 'verify' | 'override' | 'override_cleared'; actor: string; from: unknown; to: unknown; note?: string | null }
) {
  const current = await loadReport(id)
  const merged = { ...current, ...patch }
  await getStore().updateReport(id, { ...patch, ...triageSnapshot(merged) })
  await getStore().addEvent({
    report_id: id,
    action: event.action,
    actor: event.actor,
    from_value: event.from == null ? null : String(event.from),
    to_value: event.to == null ? null : String(event.to),
    note: event.note ?? null,
  })
  return detail(id)
}
