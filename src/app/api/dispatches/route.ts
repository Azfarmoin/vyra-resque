import { NextRequest, NextResponse } from 'next/server'
<<<<<<< HEAD
import { staffGate } from '@/lib/staffGate'
import { supabase } from '@/lib/serverDb'
=======
import { supabase } from '@/lib/supabase'
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
import { matchTeamsToCase } from '@/lib/matching'
import { ACTIVE_DISPATCH_STATUSES, DISPATCH_SELECT } from '@/lib/dispatch'

// GET all dispatches (optionally ?report_id=...&active=true)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    let query = supabase
      .from('dispatches')
      .select(DISPATCH_SELECT)
      .order('assigned_at', { ascending: false })

    const reportId = searchParams.get('report_id')
    if (reportId) query = query.eq('report_id', reportId)
    if (searchParams.get('active') === 'true') {
      query = query.in('status', ACTIVE_DISPATCH_STATUSES)
    }

    const { data, error } = await query

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST assign a team (and optional resources) to a report
export async function POST(request: NextRequest) {
<<<<<<< HEAD
  const denied = await staffGate(request)
  if (denied) return denied
=======
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
  try {
    const body = await request.json()
    const reportId: string | undefined = body.report_id
    const teamId: string | undefined = body.team_id
    const resourceIds: string[] = Array.isArray(body.resource_ids) ? body.resource_ids : []

    if (!reportId || !teamId) {
      return NextResponse.json({ error: 'report_id and team_id are required' }, { status: 400 })
    }

    const [reportRes, teamRes, resourcesRes, hazardsRes] = await Promise.all([
      supabase.from('emergency_reports').select('*').eq('id', reportId).single(),
      supabase.from('rescue_teams').select('*').eq('id', teamId).single(),
      supabase.from('resources').select('*'),
      supabase.from('route_hazards').select('*').eq('active', true)
    ])

    if (reportRes.error || !reportRes.data) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 })
    }
    if (teamRes.error || !teamRes.data) {
      return NextResponse.json({ error: 'Team not found' }, { status: 404 })
    }
    if (reportRes.data.status === 'resolved') {
      return NextResponse.json({ error: 'Report is already resolved' }, { status: 409 })
    }
    if (teamRes.data.status !== 'available') {
      return NextResponse.json(
        { error: `Team is ${teamRes.data.status} and cannot be assigned` },
        { status: 409 }
      )
    }

    const allResources = resourcesRes.data ?? []
    const selected = allResources.filter(r => resourceIds.includes(r.id))
    const unavailable = selected.filter(r => r.status !== 'available')
    if (selected.length !== resourceIds.length || unavailable.length) {
      return NextResponse.json(
        { error: 'One or more selected resources are no longer available' },
        { status: 409 }
      )
    }

    const { matches } = matchTeamsToCase(reportRes.data, [teamRes.data], allResources, hazardsRes.data ?? [])
    const match = matches[0]

    const { data: dispatch, error: dispatchError } = await supabase
      .from('dispatches')
      .insert({
        report_id: reportId,
        team_id: teamId,
        assigned_by: body.assigned_by || null,
        status: 'pending',
        notes: body.notes || null,
        match_score: match?.score ?? null,
        distance_km: match?.distance_km ?? null,
        match_explanation: match ? { breakdown: match.breakdown, warnings: match.warnings } : null
      })
      .select()
      .single()

    if (dispatchError) {
      return NextResponse.json({ error: dispatchError.message }, { status: 500 })
    }

    const updates: PromiseLike<{ error: { message: string } | null }>[] = [
      supabase.from('rescue_teams').update({ status: 'assigned' }).eq('id', teamId),
      supabase.from('emergency_reports').update({ status: 'assigned' }).eq('id', reportId)
    ]
    if (selected.length) {
      updates.push(
        supabase.from('resources').update({ status: 'in_use' }).in('id', resourceIds),
        supabase.from('dispatch_resources').insert(
          selected.map(r => ({ dispatch_id: dispatch.id, resource_id: r.id, quantity: r.quantity }))
        )
      )
    }
    const results = await Promise.all(updates)
    const updateError = results.find(r => r.error)?.error
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    const { data } = await supabase.from('dispatches').select(DISPATCH_SELECT).eq('id', dispatch.id).single()
    return NextResponse.json(data ?? dispatch, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
