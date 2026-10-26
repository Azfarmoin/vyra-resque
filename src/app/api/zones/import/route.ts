import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { getStore } from '@/lib/db'
import { handleError } from '@/lib/reportService'
import { identify } from '@/lib/zones/auth'
import { importFeed, loadFeedConfigs } from '@/lib/zones/feeds'

export const dynamic = 'force-dynamic'

function secretOk(given: string) {
  const want = process.env.ZONE_IMPORT_SECRET || ''
  if (want.length < 16 || given.length !== want.length) return false
  return timingSafeEqual(Buffer.from(given), Buffer.from(want))
}

// POST /api/zones/import - pull every feed in ZONE_FEEDS. Call it from a scheduler (cron / Vercel cron / Supabase pg_cron)
// with the `x-zone-import-secret` header, or as a signed-in administrator. A failed feed leaves its zones untouched.
export async function POST(request: NextRequest) {
  try {
    const bySecret = secretOk(request.headers.get('x-zone-import-secret') || '')
    if (!bySecret && (await identify(request)).role !== 'admin') return NextResponse.json({ error: 'Not allowed' }, { status: 403 })
    const feeds = loadFeedConfigs()
    if (!feeds.length) return NextResponse.json({ results: [], note: 'No feeds configured (set ZONE_FEEDS).' })
    const base = getStore()
    // Feed imports have no signed-in user, so they write with the server-only service role (Supabase mode).
    const store = {
      ...base,
      insertZone: (z: Parameters<typeof base.insertZone>[0]) => base.insertZone(z, { service: true }),
      updateZone: (id: string, patch: Parameters<typeof base.updateZone>[1]) => base.updateZone(id, patch, { service: true }),
    }
    const results = []
    for (const feed of feeds) results.push(await importFeed(store, feed))
    return NextResponse.json({ results })
  } catch (err) {
    return handleError(err)
  }
}
