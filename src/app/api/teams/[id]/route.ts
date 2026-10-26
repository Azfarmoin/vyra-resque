import { NextRequest, NextResponse } from 'next/server'
<<<<<<< HEAD
import { staffGate } from '@/lib/staffGate'
import { supabase } from '@/lib/serverDb'
import { ACTIVE_DISPATCH_STATUSES } from '@/lib/dispatch'

const TEAM_STATUSES = ['available', 'unavailable', 'assigned']
=======
import { supabase } from '@/lib/supabase'
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895

const EDITABLE_FIELDS = [
  'team_name',
  'team_leader',
  'contact_number',
  'capabilities',
  'current_location_lat',
  'current_location_lng',
  'base_location',
  'team_size',
  'status'
]

// PATCH update team (status, location, capabilities...)
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
<<<<<<< HEAD
  const denied = await staffGate(request)
  if (denied) return denied
=======
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
  try {
    const body = await request.json()
    const update: Record<string, unknown> = {}
    for (const field of EDITABLE_FIELDS) {
      if (field in body) update[field] = body[field]
    }

<<<<<<< HEAD
    if ('status' in update) {
      if (!TEAM_STATUSES.includes(update.status as string)) {
        return NextResponse.json({ error: `Invalid status: ${update.status}` }, { status: 400 })
      }
      // Assignment is owned by dispatches: a team on a mission is freed by completing it, not by a manual toggle.
      const { data: current } = await supabase.from('rescue_teams').select('status').eq('id', params.id).maybeSingle()
      if (current?.status === 'assigned' && update.status !== 'assigned') {
        return NextResponse.json({ error: 'This team is on a mission. Complete or cancel the mission first.' }, { status: 409 })
      }
      if (update.status === 'assigned') {
        return NextResponse.json({ error: 'Teams are assigned by creating a dispatch.' }, { status: 400 })
      }
    }
    if ('team_name' in update && !String(update.team_name ?? '').trim()) {
      return NextResponse.json({ error: 'team_name cannot be empty' }, { status: 400 })
    }
    if (!Object.keys(update).length) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }

=======
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
    const { data, error } = await supabase
      .from('rescue_teams')
      .update(update)
      .eq('id', params.id)
      .select()
      .single()

    if (error) {
<<<<<<< HEAD
      const missing = error.code === 'PGRST116'
      return NextResponse.json({ error: missing ? 'Team not found' : error.message }, { status: missing ? 404 : 500 })
=======
      return NextResponse.json({ error: error.message }, { status: 500 })
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
    }

    return NextResponse.json(data)
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE remove team
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
<<<<<<< HEAD
  const denied = await staffGate(request)
  if (denied) return denied
  try {
    const { data: active } = await supabase
      .from('dispatches')
      .select('id')
      .eq('team_id', params.id)
      .in('status', ACTIVE_DISPATCH_STATUSES)
    if (active?.length) {
      return NextResponse.json({ error: 'This team is on a mission and cannot be deleted.' }, { status: 409 })
    }

=======
  try {
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
    const { error } = await supabase.from('rescue_teams').delete().eq('id', params.id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
