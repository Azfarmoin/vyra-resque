import { NextRequest, NextResponse } from 'next/server'
<<<<<<< HEAD
import { staffGate } from '@/lib/staffGate'
import { supabase } from '@/lib/serverDb'
=======
import { supabase } from '@/lib/supabase'
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895

// GET all teams
export async function GET(request: NextRequest) {
  try {
    const { data, error } = await supabase
      .from('rescue_teams')
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

// POST create new team
export async function POST(request: NextRequest) {
<<<<<<< HEAD
  const denied = await staffGate(request)
  if (denied) return denied
=======
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
  try {
    const body = await request.json()

    if (!body.team_name) {
      return NextResponse.json({ error: 'team_name is required' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('rescue_teams')
      .insert({
        team_name: body.team_name,
        team_leader: body.team_leader,
        contact_number: body.contact_number,
        capabilities: body.capabilities || [],
<<<<<<< HEAD
        current_location_lat: body.current_location_lat ?? null,
        current_location_lng: body.current_location_lng ?? null,
        base_location: body.base_location || null,
        team_size: Number.isInteger(body.team_size) && body.team_size > 0 ? body.team_size : 4,
=======
        current_location_lat: body.current_location_lat || null,
        current_location_lng: body.current_location_lng || null,
        base_location: body.base_location || null,
        team_size: body.team_size || 4,
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
        status: 'available'
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
}
