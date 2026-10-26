// Shared helpers for the /api/satellite routes: responder-only access and uniform error bodies.
import { NextRequest, NextResponse } from 'next/server'
import { requireResponder } from '../routing/auth'
import { HttpError } from '../reportService'
import { AnalysisError } from './quality'
import { ProviderError } from './providers/types'
import { SatError } from './service'
import { RepoError } from './repo'

export async function guard(request: NextRequest) {
  const auth = await requireResponder(request)
  if (!auth.ok) return { ok: false as const, res: NextResponse.json({ error: auth.error.replace('Route analysis is', 'Satellite analysis is'), code: auth.status === 401 ? 'auth_required' : 'forbidden' }, { status: auth.status }) }
  return { ok: true as const, user: auth.user }
}

export function fail(e: unknown) {
  if (e instanceof SatError) return NextResponse.json({ error: e.message, code: e.code, ...e.extra }, { status: e.status })
  if (e instanceof ProviderError) return NextResponse.json({ error: e.message, code: `provider_${e.code}` }, { status: e.status })
  if (e instanceof AnalysisError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status })
  if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status })
  if (e instanceof RepoError) return NextResponse.json({ error: e.message, code: 'storage_error' }, { status: 503 })
  console.error('satellite route error:', e)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
export async function readJson(request: NextRequest): Promise<Record<string, unknown>> {
  const b = await request.json().catch(() => null)
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new SatError(400, 'The request body must be a JSON object.', 'validation')
  return b as Record<string, unknown>
}
