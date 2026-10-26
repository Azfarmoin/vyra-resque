import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { ManualError, publishAnnouncement } from '@/lib/alerts/manual'
import { announcementSchema } from '@/lib/alerts/manualSchema'
import { detectConflicts, freshnessOf } from '@/lib/alerts/lifecycle'
import { createWebPushSender, vapidConfigured } from '@/lib/alerts/push'
import { getAlertStoreStatus, getProviders } from '@/lib/alerts/service'

export const dynamic = 'force-dynamic'

// GET /api/admin/alerts - everything an administrator needs: all alerts (any status/origin), provider health and
// documentation, ingest problems, the audit trail and delivery outcomes. Administrators only.
export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request)
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status })
  const { store, persistent, note } = getAlertStoreStatus()
  const providers = getProviders()
  const [alerts, health, overrides, issues, audit, notifications] = await Promise.all([
    store.listAlerts({ limit: 500 }), store.getHealth(), store.getProviderOverrides(), store.listIssues(100), store.listAudit(200), store.listNotifications(200),
  ])
  const now = Date.now()
  const counts = notifications.reduce<Record<string, number>>((acc, n) => ({ ...acc, [n.outcome]: (acc[n.outcome] ?? 0) + 1 }), {})
  return NextResponse.json({
    storage: { persistent, note, mode: store.mode },
    push: { configured: vapidConfigured(), subscribers: (await store.listSubscriptions()).length },
    cronConfigured: !!process.env.CRON_SECRET && process.env.CRON_SECRET.length >= 16,
    providers: providers.map((p) => {
      const h = health.find((x) => x.provider === p.id)
      return { id: p.id, name: p.name, origin: p.origin, docs: p.docs, minIntervalMinutes: p.minIntervalMinutes, staleAfterMinutes: p.staleAfterMinutes, unconfiguredReason: p.unconfiguredReason, enabled: overrides[p.id]?.enabled ?? true, health: h ?? null, freshness: freshnessOf(h, p.staleAfterMinutes, now) }
    }),
    alerts, // includes raw_source_metadata for review; admins only
    conflicts: detectConflicts(alerts, now),
    issues, audit, notifications: { recent: notifications.slice(0, 50), counts },
  })
}

// POST /api/admin/alerts - publish a manually verified announcement (human-authored, clearly labelled).
export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request)
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status })
  const parsed = announcementSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Please check the form.', details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) }, { status: 400 })
  try {
    const sender = parsed.data.notify ? await createWebPushSender() : null
    const { alert, notifications } = await publishAnnouncement(getAlertStoreStatus().store, parsed.data, admin.email, sender)
    return NextResponse.json({ alert, notifications }, { status: 201 })
  } catch (e) {
    if (e instanceof ManualError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('announcement failed', e instanceof Error ? e.message : 'unknown')
    return NextResponse.json({ error: 'Could not publish the announcement.' }, { status: 500 })
  }
}
