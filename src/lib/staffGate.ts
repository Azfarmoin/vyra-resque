// Server-side gate for endpoints that change operational data (verify a report, override triage, dispatch a team, edit supplies).
//
// Before this gate these routes had NO authentication: anyone on the internet could verify reports, override triage priority, send
// teams, or delete resources, which is the same class of problem as the profile role-escalation hole (an anonymous caller gets
// responder powers). A signed-in responder or administrator is now required.
//
// The one exception keeps local development and the automated tests working as before: in DEMO mode outside production the data is
// fictional and sign-in is a convenience, so writes stay open there. Anywhere else (production, or any real Supabase project) the
// gate is enforced.
import { NextResponse, type NextRequest } from 'next/server'
import { isDemoMode } from './adminAuth'
import { requireResponder } from './routing/auth'

export async function staffGate(request: NextRequest): Promise<NextResponse | null> {
  if (isDemoMode() && process.env.NODE_ENV !== 'production') return null
  const check = await requireResponder(request)
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status })
  return null
}
