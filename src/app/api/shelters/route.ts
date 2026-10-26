<<<<<<< HEAD
import { NextRequest } from 'next/server'
import * as H from '@/lib/shelters/handlers'
import { readJson, respond } from '@/lib/shelters/runtime'

export const dynamic = 'force-dynamic'

// GET  /api/shelters  - anonymous/citizen: verified shelters, public fields only. Responder/admin: full records with availability and data-quality labels.
// POST /api/shelters  - administrators only. New records always start UNVERIFIED.
export const GET = (request: NextRequest) => respond(request, (c, d) => H.listShelters(c.actor, d))
export async function POST(request: NextRequest) {
  const body = await readJson(request)
  return respond(request, (c, d) => H.createShelter(c.actor, body, d))
=======
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/serverDb'

// GET all shelters
export async function GET(request: NextRequest) {
  try {
    const { data, error } = await supabase
      .from('shelters')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST create new shelter
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    if (!String(body.name ?? '').trim()) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 })
    }
    const capacity = body.capacity ?? null
    const occupancy = body.current_occupancy ?? 0
    if (capacity != null && (!Number.isInteger(capacity) || capacity < 1)) {
      return NextResponse.json({ error: 'capacity must be a whole number of 1 or more' }, { status: 400 })
    }
    if (!Number.isInteger(occupancy) || occupancy < 0 || (capacity != null && occupancy > capacity)) {
      return NextResponse.json({ error: 'current_occupancy must be between 0 and the capacity' }, { status: 400 })
    }
    // Coordinates of 0 are valid numbers, so only treat missing values as null.
    const coord = (v: unknown) => (v === '' || v == null ? null : Number(v))

    const { data, error } = await supabase
      .from('shelters')
      .insert({
        name: String(body.name).trim(),
        location_lat: coord(body.location_lat),
        location_lng: coord(body.location_lng),
        address: body.address || null,
        capacity,
        current_occupancy: occupancy,
        contact_number: body.contact_number || null,
        status: capacity != null && occupancy >= capacity ? 'full' : 'open'
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
}
