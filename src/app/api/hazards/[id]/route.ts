import { NextRequest, NextResponse } from 'next/server'
<<<<<<< HEAD
import { z } from 'zod'
import { supabase } from '@/lib/serverDb'
import { requireResponder } from '@/lib/routing/auth'

export const dynamic = 'force-dynamic'

const patchSchema = z
  .object({
    description: z.string().trim().min(1).max(300).optional(),
    location_lat: z.coerce.number().finite().min(-90).max(90).optional(),
    location_lng: z.coerce.number().finite().min(-180).max(180).optional(),
    radius_km: z.coerce.number().finite().min(0.025).max(3).optional(),
    severity: z.enum(['low', 'medium', 'high']).optional(),
    active: z.boolean().optional(),
    blocks_road: z.boolean().nullable().optional(),
    // Convenience: set verification with a SERVER-side timestamp (the client cannot back-date it).
    verify: z.enum(['confirmed', 'unverified', 'resolved']).optional(),
  })
  .strict()

const deny = (c: { status: number; error: string }) => NextResponse.json({ error: c.error }, { status: c.status })

// PATCH update hazard (e.g. confirm it, or mark cleared)
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireResponder(request)
  if (!auth.ok) return deny(auth)
  try {
    const parsed = patchSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) }, { status: 400 })
    }
    const { verify, ...fields } = parsed.data
    const update: Record<string, unknown> = { ...fields }
    if (verify) {
      update.verification_status = verify // needs migration 006; the database error is passed through if it is missing
      if (verify === 'confirmed') update.last_verified_at = new Date().toISOString()
      if (verify === 'resolved') update.active = false
      if (verify !== 'resolved' && fields.active === undefined) update.active = true
    }
    if (!Object.keys(update).length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

    const { data, error } = await supabase.from('route_hazards').update(update).eq('id', params.id).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  } catch {
=======
import { supabase } from '@/lib/supabase'

const EDITABLE_FIELDS = ['description', 'location_lat', 'location_lng', 'radius_km', 'severity', 'active']

// PATCH update hazard (e.g. mark cleared)
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json()
    const update: Record<string, unknown> = {}
    for (const field of EDITABLE_FIELDS) {
      if (field in body) update[field] = body[field]
    }

    const { data, error } = await supabase
      .from('route_hazards')
      .update(update)
      .eq('id', params.id)
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (error) {
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE remove hazard
<<<<<<< HEAD
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireResponder(request)
  if (!auth.ok) return deny(auth)
  try {
    const { error } = await supabase.from('route_hazards').delete().eq('id', params.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  } catch {
=======
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { error } = await supabase.from('route_hazards').delete().eq('id', params.id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
