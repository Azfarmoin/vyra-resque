import { NextRequest, NextResponse } from 'next/server'
<<<<<<< HEAD
import { staffGate } from '@/lib/staffGate'
import { supabase } from '@/lib/serverDb'
=======
import { supabase } from '@/lib/supabase'
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
import {
  ACTIVE_DISPATCH_STATUSES as ACTIVE,
  DISPATCH_SELECT,
  DISPATCH_STATUSES as STATUSES
} from '@/lib/dispatch'

// PATCH update dispatch status; completing/cancelling frees the team and its resources
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

    if (body.status && !STATUSES.includes(body.status)) {
      return NextResponse.json({ error: `Invalid status: ${body.status}` }, { status: 400 })
    }

    const { data: existing, error: fetchError } = await supabase
      .from('dispatches')
      .select('*, dispatch_resources(resource_id)')
      .eq('id', params.id)
      .single()

    if (fetchError || !existing) {
      return NextResponse.json({ error: 'Dispatch not found' }, { status: 404 })
    }
    if (!ACTIVE.includes(existing.status) && body.status && body.status !== existing.status) {
      return NextResponse.json({ error: `Dispatch is already ${existing.status}` }, { status: 409 })
    }

    const update: Record<string, unknown> = {}
    if (body.status) update.status = body.status
    if ('notes' in body) update.notes = body.notes
    const closing = body.status === 'completed' || body.status === 'cancelled'
    if (closing) update.completed_at = new Date().toISOString()

    const { error: updateError } = await supabase.from('dispatches').update(update).eq('id', params.id)
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    if (closing) {
      const resourceIds = (existing.dispatch_resources ?? []).map((r: { resource_id: string }) => r.resource_id)
      const { data: otherActive } = await supabase
        .from('dispatches')
        .select('id')
        .eq('report_id', existing.report_id)
        .in('status', ACTIVE)

      const followUps: PromiseLike<{ error: { message: string } | null }>[] = [
        supabase.from('rescue_teams').update({ status: 'available' }).eq('id', existing.team_id)
      ]
      if (resourceIds.length) {
        followUps.push(supabase.from('resources').update({ status: 'available' }).in('id', resourceIds))
      }
      if (!otherActive?.length) {
        followUps.push(
          supabase
            .from('emergency_reports')
            .update({ status: body.status === 'completed' ? 'resolved' : 'pending' })
            .eq('id', existing.report_id)
        )
      }
      const results = await Promise.all(followUps)
      const followUpError = results.find(r => r.error)?.error
      if (followUpError) {
        return NextResponse.json({ error: followUpError.message }, { status: 500 })
      }
    }

    const { data } = await supabase.from('dispatches').select(DISPATCH_SELECT).eq('id', params.id).single()
    return NextResponse.json(data)
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
