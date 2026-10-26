import { NextResponse } from 'next/server'
import { TRIAGE_RULES } from '@/lib/triageRules'
import { TRIAGE_VERSION } from '@/lib/triage'

// GET /api/triage/rules - the full rule set, so anyone can check how scores are produced
export function GET() {
  return NextResponse.json({
    version: TRIAGE_VERSION,
    rules: {
      ...TRIAGE_RULES,
      peopleBands: TRIAGE_RULES.peopleBands.map((b) => ({ ...b, max: Number.isFinite(b.max) ? b.max : null })),
      keywordCues: TRIAGE_RULES.keywordCues.map((c) => ({ pattern: c.pattern.source, points: c.points, label: c.label })),
    },
  })
}
