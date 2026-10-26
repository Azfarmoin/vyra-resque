import { NextRequest, NextResponse } from 'next/server'
import { gatewayConfigured } from '@/lib/gateway/auth'
import { ingestCompact } from '@/lib/gateway/ingest'
import { verifyTwilioSignature, xmlEscape } from '@/lib/gateway/twilio'

export const dynamic = 'force-dynamic'

const twiml = (text: string, status = 200) =>
  new NextResponse(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${xmlEscape(text)}</Message></Response>`, { status, headers: { 'content-type': 'text/xml; charset=utf-8' } })

// The public URL Twilio signed. Behind a proxy request.url may be internal, so PUBLIC_BASE_URL wins.
function signedUrl(request: NextRequest): string {
  const base = process.env.PUBLIC_BASE_URL
  if (base) return new URL('/api/gateway/sms', base).toString()
  const proto = request.headers.get('x-forwarded-proto') || 'https'
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || new URL(request.url).host
  return `${proto}://${host}/api/gateway/sms`
}

// POST /api/gateway/sms - Twilio "A message comes in" webhook for the VYRA SMS gateway number.
// Refuses everything unless TWILIO_AUTH_TOKEN is set AND the request signature is valid, so nobody can inject reports.
// The reply SMS ("VYRA ACK ...") is the delivery confirmation the sender sees on their phone.
export async function POST(request: NextRequest) {
  const token = process.env.TWILIO_AUTH_TOKEN
  if (!token || !gatewayConfigured()) return new NextResponse('SMS gateway is not configured', { status: 503 })
  const form = new URLSearchParams(await request.text())
  const params = Object.fromEntries(form.entries())
  if (!verifyTwilioSignature(token, signedUrl(request), params, request.headers.get('x-twilio-signature'))) return new NextResponse('Invalid signature', { status: 403 })

  const to = (params.To || '').replace(/\D/g, '').slice(-4) || 'sms'
  const r = await ingestCompact(params.Body || '', { channel: 'sms', gatewayId: `sms-${to}`, fallbackCallback: params.From })
  if (!r.ok) return twiml('VYRA could not read that message and has NOT recorded it. Try again, or call your local emergency number.')
  return twiml(`VYRA ACK ${r.incident}. Your report is recorded. A rescue operator has not acknowledged it yet.`)
}
