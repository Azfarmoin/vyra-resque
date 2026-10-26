import { NextRequest, NextResponse } from 'next/server'
<<<<<<< HEAD
import { supabase } from '@/lib/serverDb'
=======
import { supabase } from '@/lib/supabase'
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
import { matchTeamsToCase } from '@/lib/matching'

// GET ranked team suggestions for a report
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const [reportRes, teamsRes, resourcesRes, hazardsRes] = await Promise.all([
      supabase.from('emergency_reports').select('*').eq('id', params.id).single(),
      supabase.from('rescue_teams').select('*'),
      supabase.from('resources').select('*'),
      supabase.from('route_hazards').select('*').eq('active', true)
    ])

    if (reportRes.error) {
      return NextResponse.json({ error: reportRes.error.message }, { status: 404 })
    }
    const firstError = teamsRes.error || resourcesRes.error || hazardsRes.error
    if (firstError) {
      return NextResponse.json({ error: firstError.message }, { status: 500 })
    }

    const result = matchTeamsToCase(
      reportRes.data,
      teamsRes.data ?? [],
      resourcesRes.data ?? [],
      hazardsRes.data ?? []
    )

    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
