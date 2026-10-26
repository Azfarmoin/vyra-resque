import { NextRequest, NextResponse } from 'next/server'
import { handleError, HttpError } from '@/lib/reportService'
import { resolveCaller } from '@/lib/serverAuth'
import { MAX_ATTACHMENT_BYTES, sniffImageType } from '@/lib/attachments'
import { analyzeBytes } from '@/lib/photoAnalysis/service'
import { failedResult, photoModelName } from '@/lib/photoAnalysis/model'
import { checkRateLimit } from '@/lib/routing/rateLimit'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// POST /api/photo-analysis/preview - raw image bytes, header X-Analysis-Consent: yes.
// Used by the report form to show suggestions right after a photo is chosen, BEFORE the report exists.
// Nothing is stored. After the report syncs, the stored photo is analysed again server-side (that result
// is the saved record). Anonymous reporters are allowed (emergencies), so this is rate limited per client.
export async function POST(request: NextRequest) {
  try {
    if (request.headers.get('x-analysis-consent') !== 'yes') throw new HttpError(400, 'Consent to photo analysis is required')
    const caller = await resolveCaller(request)
    if (caller.kind === 'invalid') throw new HttpError(401, 'Your session has expired. Sign in again.')
    const ip = (request.headers.get('x-forwarded-for') || 'local').split(',')[0].trim()
    const who = caller.kind === 'user' ? `u:${caller.userId}` : `ip:${ip}`
    const limited = checkRateLimit(`photo-preview:${who}`, { limit: 12, windowMs: 60_000 })
    if (!limited.ok) throw new HttpError(429, `Too many photos at once. Try again in ${limited.retryAfterS}s.`)

    if (Number(request.headers.get('content-length') || 0) > MAX_ATTACHMENT_BYTES) throw new HttpError(413, 'Photo is larger than 5 MB')
    const bytes = new Uint8Array(await request.arrayBuffer())
    if (!bytes.byteLength) throw new HttpError(400, 'Empty upload')
    if (bytes.byteLength > MAX_ATTACHMENT_BYTES) throw new HttpError(413, 'Photo is larger than 5 MB')
    const mime = sniffImageType(bytes)
    if (!mime) throw new HttpError(415, 'Only JPEG, PNG or WebP photos are accepted')

    const force = request.headers.get('x-analysis-force') === 'yes'
    const call = await analyzeBytes(bytes, mime, force)
    if (call.ok) return NextResponse.json({ analysis: { analysis_status: 'completed', result: call.result, failure_reason: null, preview: true } })
    return NextResponse.json({
      analysis: { analysis_status: 'failed', result: failedResult(call.reason, call.state === 'not_configured' ? null : photoModelName()), failure_reason: call.reason, state: call.state, preview: true },
    })
  } catch (err) {
    return handleError(err)
  }
}
