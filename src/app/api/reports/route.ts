import { NextRequest, NextResponse } from 'next/server'
import { createReport, findTriaged, handleError, parseBody, parseQuery, publicView } from '@/lib/reportService'
import { createReportSchema, listQuerySchema } from '@/lib/validation'
<<<<<<< HEAD
import { AuthError, resolveCaller } from '@/lib/serverAuth'
=======
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895

export const dynamic = 'force-dynamic'

// GET /api/reports - reports with live triage (responders).
// Filters: area, status (comma list or "open"), priority, verified, bbox, sort.
export async function GET(request: NextRequest) {
  try {
    return NextResponse.json(await findTriaged(parseQuery(request, listQuerySchema)))
  } catch (err) {
    return handleError(err)
  }
}

<<<<<<< HEAD
// POST /api/reports - public: submit a report. Returns only the public view (no contact details).
// A `client_id` idempotency key makes retries (e.g. from an offline queue) safe: resubmitting
// the same key returns the stored report with 200 instead of creating a duplicate.
export async function POST(request: NextRequest) {
  try {
    const input = await parseBody(request, createReportSchema)
    // Who owns the report is decided HERE from the verified token, never from the body.
    // Anonymous reporting stays allowed (people in an emergency may not have an account), but a report
    // that claims an account without a valid sign-in is refused so it can never land on the wrong user.
    const caller = await resolveCaller(request)
    if (caller.kind === 'invalid') {
      throw new AuthError(401, 'Your session has expired. Sign in again to send this report. It is still saved on your device.', 'auth_required')
    }
    if (caller.kind === 'anonymous' && input.reporter_id) {
      throw new AuthError(401, 'Sign in to send a report saved under your account. It is still saved on your device.', 'auth_required')
    }
    if (caller.kind === 'user' && input.reporter_id && input.reporter_id !== caller.userId) {
      throw new AuthError(403, 'This report was saved under a different account.', 'account_mismatch')
    }
    const { report, duplicate } = await createReport(input, caller.kind === 'user' ? caller.userId : null)
    return NextResponse.json({ report: publicView(report), duplicate }, { status: duplicate ? 200 : 201 })
  } catch (err) {
    return handleError(err)
  }
}
=======
// POST create new report.
// Offline-queued reports send a `client_id` idempotency key; resubmitting the same
// key returns the already-stored report instead of creating a duplicate.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const clientId: string | null = typeof body.client_id === 'string' && body.client_id ? body.client_id : null

    if (!body.location_address && (body.location_lat == null || body.location_lng == null)) {
      return NextResponse.json({ error: 'A location address or GPS coordinates are required' }, { status: 400 })
    }

    if (clientId) {
      const existing = await findByClientId(clientId)
      if (existing) {
        return NextResponse.json({ ...existing, duplicate: true }, { status: 200 })
      }
    }

    // Calculate triage score
    const triageResult = calculateTriage({
      people_count: body.people_count || 1,
      immediate_danger: body.immediate_danger || false,
      injury_details: body.injury_details || null,
      medical_needs: body.medical_needs || null
    })

    const { data, error } = await supabase
      .from('emergency_reports')
      .insert({
        reporter_id: body.reporter_id || null,
        location_lat: body.location_lat ?? null,
        location_lng: body.location_lng ?? null,
        location_address: body.location_address,
        people_count: body.people_count || 1,
        immediate_danger: body.immediate_danger || false,
        injury_details: body.injury_details || null,
        medical_needs: body.medical_needs || null,
        contact_info: body.contact_info || null,
        status: 'pending',
        priority_score: triageResult.priority_score,
        priority_explanation: triageResult.priority_explanation,
        client_id: clientId,
        submitted_offline: Boolean(body.submitted_offline),
        client_created_at: body.client_created_at || null
      })
      .select()
      .single()

    if (error) {
      // Unique violation on client_id: a concurrent sync already stored this report
      if (clientId && error.code === '23505') {
        const existing = await findByClientId(clientId)
        if (existing) {
          return NextResponse.json({ ...existing, duplicate: true }, { status: 200 })
        }
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ...data, duplicate: false }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

async function findByClientId(clientId: string) {
  const { data } = await supabase
    .from('emergency_reports')
    .select('*')
    .eq('client_id', clientId)
    .maybeSingle()
  return data
}
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
