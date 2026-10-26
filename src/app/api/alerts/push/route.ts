import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { isAllowedPushEndpoint, vapidConfigured } from '@/lib/alerts/push'
import { getAlertStore, userIdFrom } from '@/lib/alerts/service'
import { HAZARD_TYPES, SEVERITIES } from '@/lib/alerts/types'

export const dynamic = 'force-dynamic'

const location = z.object({
  id: z.string().min(1).max(64),
  label: z.string().trim().min(1).max(80),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  source: z.enum(['gps', 'area_centre', 'manual_point']),
  accuracyM: z.number().min(0).max(1_000_000).nullable(),
})
const body = z.object({
  subscription: z.object({ endpoint: z.string().url().max(1000), keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(10).max(100) }) }),
  locations: z.array(location).max(5),
  hazard_types: z.array(z.enum(Object.keys(HAZARD_TYPES) as [string, ...string[]])).max(20),
  minimum_severity: z.enum(SEVERITIES),
  language: z.string().min(2).max(10).default('en'),
})

// GET  -> is push available on this server, and the public VAPID key the browser needs
export async function GET() {
  const ok = vapidConfigured()
  return NextResponse.json({ configured: ok, publicKey: ok ? process.env.VAPID_PUBLIC_KEY : null })
}

// POST -> create / update this browser's subscription and preferences
export async function POST(request: NextRequest) {
  if (!vapidConfigured()) return NextResponse.json({ error: 'Push notifications are not set up on this server.' }, { status: 501 })
  const parsed = body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid subscription', details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) }, { status: 400 })
  const { subscription, locations, hazard_types, minimum_severity, language } = parsed.data
  if (!isAllowedPushEndpoint(subscription.endpoint, process.env.ALERT_PUSH_HOST_SUFFIXES)) return NextResponse.json({ error: 'That push service is not allowed.' }, { status: 400 })
  const row = await getAlertStore().upsertSubscription({
    endpoint: subscription.endpoint, p256dh: subscription.keys.p256dh, auth: subscription.keys.auth, user_id: await userIdFrom(request),
    locations, hazard_types: hazard_types as never, minimum_severity, language,
  })
  // The endpoint and keys are secrets: they are never echoed back.
  return NextResponse.json({ ok: true, updated_at: row.updated_at })
}

// DELETE -> remove this browser's subscription (knowing the endpoint is the proof of ownership)
export async function DELETE(request: NextRequest) {
  const parsed = z.object({ endpoint: z.string().url().max(1000) }).safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  await getAlertStore().removeSubscription(parsed.data.endpoint)
  return NextResponse.json({ ok: true })
}
