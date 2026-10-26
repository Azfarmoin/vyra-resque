import { NextRequest, NextResponse } from 'next/server'
import { handleError, HttpError, parseBody } from '@/lib/reportService'
import { supportSubmitSchema } from '@/lib/support'
import { checkRateLimit, clientKey, hashContent, createSupportRequest, identify, listSupportRequests, recordSubmission, spamVerdict } from '@/lib/supportServer'

export const dynamic = 'force-dynamic'

// POST /api/support - send a support request. Open to everyone (people in trouble may not have an
//   account). Validated, spam-checked and rate-limited; saved to the database; answered with a
//   reference ID. No email is sent anywhere.
// GET  /api/support?scope=mine|all - the caller's own requests, or (administrators) every request.
export async function POST(request: NextRequest) {
  try {
    const body = await parseBody(request, supportSubmitSchema)
    const caller = await identify(request)

    const spam = spamVerdict(body, body)
    if (spam) throw new HttpError(400, spam)

    // Signed-in people are limited per account, everyone else per network address.
    const key = caller.userId ? `user:${caller.userId}` : `ip:${clientKey(request)}`
    const hash = hashContent(body)
    const limit = checkRateLimit(key, hash)
    if (!limit.ok) {
      return NextResponse.json(
        { error: `You have sent several requests recently. Please try again in ${Math.ceil(limit.retryAfterSec / 60) || 1} minute(s).` },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } },
      )
    }

    const { name, email, subject, category, message, report_reference } = body
    const result = await createSupportRequest({ name, email, subject, category, message, report_reference }, caller, clientKey(request))
    if (!result.duplicate) recordSubmission(key, hash)
    return NextResponse.json(result, { status: result.duplicate ? 200 : 201 })
  } catch (err) {
    return handleError(err)
  }
}

export async function GET(request: NextRequest) {
  try {
    const scope = new URL(request.url).searchParams.get('scope') === 'all' ? 'all' : 'mine'
    const requests = await listSupportRequests(await identify(request), scope)
    return NextResponse.json({ requests })
  } catch (err) {
    return handleError(err)
  }
}
