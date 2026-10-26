import { NextRequest, NextResponse } from 'next/server'
<<<<<<< HEAD
import { z } from 'zod'
import { supabase } from '@/lib/serverDb'
import { requireResponder } from '@/lib/routing/auth'

export const dynamic = 'force-dynamic'

// Hazard records feed team matching and route analysis, so reading or changing them needs a responder
// or administrator (Supabase bearer token, or the x-demo-user header in demo mode).
const KINDS = ['road_closure', 'flooding', 'damaged_infrastructure', 'structural_collapse', 'debris', 'fire', 'landslide', 'electrical', 'gas_leak', 'other'] as const

const createSchema = z
  .object({
    description: z.string().trim().min(1).max(300),
    location_lat: z.coerce.number().finite().min(-90).max(90),
    location_lng: z.coerce.number().finite().min(-180).max(180),
    radius_km: z.coerce.number().finite().min(0.025).max(3).optional(),
    severity: z.enum(['low', 'medium', 'high']).optional(),
    // Optional provenance (migration 006). Only sent to the database when provided.
    hazard_type: z.enum(KINDS).optional(),
    blocks_road: z.boolean().optional(),
    source: z.string().trim().max(80).optional(),
  })
  .strict()

const deny = (c: { status: number; error: string }) => NextResponse.json({ error: c.error }, { status: c.status })

// GET all route hazards
export async function GET(request: NextRequest) {
  const auth = await requireResponder(request)
  if (!auth.ok) return deny(auth)
  try {
    const { data, error } = await supabase.from('route_hazards').select('*').order('created_at', { ascending: false })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  } catch {
=======
import { supabase } from '@/lib/supabase'

// GET all route hazards
export async function GET(request: NextRequest) {
  try {
    const { data, error } = await supabase
      .from('route_hazards')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (error) {
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

<<<<<<< HEAD
// POST create route hazard (flooded road, collapsed bridge, ...). New hazards start unverified.
export async function POST(request: NextRequest) {
  const auth = await requireResponder(request)
  if (!auth.ok) return deny(auth)
  try {
    const body = await request.json().catch(() => null)
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) }, { status: 400 })
    }
    const d = parsed.data
    const { data, error } = await supabase
      .from('route_hazards')
      .insert({
        description: d.description,
        location_lat: d.location_lat,
        location_lng: d.location_lng,
        radius_km: d.radius_km ?? 1,
        severity: d.severity ?? 'high',
        active: true,
        ...(d.hazard_type ? { hazard_type: d.hazard_type } : {}),
        ...(d.blocks_road !== undefined ? { blocks_road: d.blocks_road } : {}),
        ...(d.source ? { source: d.source } : {}),
      })
      .select()
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data, { status: 201 })
  } catch {
=======
// POST create route hazard (flooded road, collapsed bridge, ...)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    if (!body.description || body.location_lat == null || body.location_lng == null) {
      return NextResponse.json(
        { error: 'description, location_lat and location_lng are required' },
        { status: 400 }
      )
    }

    const { data, error } = await supabase
      .from('route_hazards')
      .insert({
        description: body.description,
        location_lat: body.location_lat,
        location_lng: body.location_lng,
        radius_km: body.radius_km || 1,
        severity: body.severity || 'high',
        active: true
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data, { status: 201 })
  } catch (error) {
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
