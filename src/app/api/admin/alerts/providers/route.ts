import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/adminAuth'
import { getAlertStoreStatus, getProviders } from '@/lib/alerts/service'

export const dynamic = 'force-dynamic'

// PATCH /api/admin/alerts/providers { provider, enabled } - switch a configured source on or off.
// Feed URLs and credentials are deliberately NOT editable here: they live in server environment variables so they can
// never be read back out of the database or the browser.
export async function PATCH(request: NextRequest) {
  const admin = await requireAdmin(request)
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status })
  const parsed = z.object({ provider: z.string().min(1).max(80), enabled: z.boolean() }).safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  if (!getProviders().some((p) => p.id === parsed.data.provider)) return NextResponse.json({ error: 'Unknown provider' }, { status: 404 })
  const { store } = getAlertStoreStatus()
  await store.setProviderOverride(parsed.data.provider, parsed.data.enabled)
  await store.addAudit({ actor: admin.email, action: parsed.data.enabled ? 'provider_enabled' : 'provider_disabled', alert_id: null, detail: parsed.data.provider })
  return NextResponse.json({ ok: true })
}
