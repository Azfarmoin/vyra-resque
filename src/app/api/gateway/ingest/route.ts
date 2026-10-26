import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkGatewayKey } from '@/lib/gateway/auth'
import { GATEWAY_CHANNELS, ingestCompact } from '@/lib/gateway/ingest'
import { handleError } from '@/lib/reportService'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  gateway_id: z.string().regex(/^[A-Za-z0-9_.-]{1,32}$/).default('gateway'),
  messages: z.array(z.object({ channel: z.enum(GATEWAY_CHANNELS as [string, ...string[]]), raw: z.string().min(1).max(500) })).min(1).max(50),
})

// POST /api/gateway/ingest - a gateway (radio bridge, relay, operator import) hands over short emergency messages.
// Authorization: Bearer <GATEWAY_API_KEY>. Every message is answered with a result; `ack` is the exact line the gateway
// sends back over the radio. Retransmissions are safe: the same incident id returns duplicate:true, never a second report.
export async function POST(request: NextRequest) {
  try {
    const auth = checkGatewayKey(request)
    if (auth === 'unconfigured') return NextResponse.json({ error: 'Gateway ingestion is not configured on this server (set GATEWAY_API_KEY, at least 16 characters).' }, { status: 503 })
    if (auth === 'invalid') return NextResponse.json({ error: 'Invalid gateway key' }, { status: 401 })
    const body = bodySchema.parse(await request.json().catch(() => ({})))
    const results = []
    for (const m of body.messages) results.push(await ingestCompact(m.raw, { channel: m.channel as 'radio', gatewayId: body.gateway_id }))
    return NextResponse.json({ results })
  } catch (err) {
    return handleError(err)
  }
}
