import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { createAnthropicClient } from '@/lib/alerts/ai'
import { runMonitoring } from '@/lib/alerts/monitor'
import { createWebPushSender } from '@/lib/alerts/push'
import { getAlertStoreStatus, getProviders } from '@/lib/alerts/service'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// POST /api/admin/alerts/run - check every configured source now (ignores the polling interval).
export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request)
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status })
  const { store } = getAlertStoreStatus()
  const report = await runMonitoring(store, getProviders(), { force: true, sender: await createWebPushSender(), llm: createAnthropicClient() })
  await store.addAudit({ actor: admin.email, action: 'manual_run', alert_id: null, detail: report.providers.map((p) => `${p.provider}:${p.status}`).join(', ').slice(0, 500) })
  return NextResponse.json(report)
}
