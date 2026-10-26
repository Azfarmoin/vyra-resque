import { NextRequest, NextResponse } from 'next/server'
import { createAnthropicClient } from '@/lib/alerts/ai'
import { runMonitoring } from '@/lib/alerts/monitor'
import { createWebPushSender } from '@/lib/alerts/push'
import { cronAuthorised } from '@/lib/alerts/auth'
import { getAlertStoreStatus, getProviders } from '@/lib/alerts/service'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Scheduled monitoring entry point. A scheduler (GitHub Actions, Vercel Cron, Supabase pg_cron, cron-job.org ...) calls it with
//   Authorization: Bearer $CRON_SECRET
// Nothing here depends on any browser being open. Without CRON_SECRET the endpoint refuses to run.
async function run(request: NextRequest) {
  const auth = cronAuthorised(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  try {
    const { store, persistent, note } = getAlertStoreStatus()
    const report = await runMonitoring(store, getProviders(), { sender: await createWebPushSender(), llm: createAnthropicClient() })
    return NextResponse.json({ ...report, persistent, note })
  } catch (err) {
    console.error('alerts cron failed', err instanceof Error ? err.message.replace(/https?:\/\/\S+/g, '[url]') : 'unknown')
    return NextResponse.json({ error: 'Monitoring run failed' }, { status: 500 })
  }
}
export const GET = run
export const POST = run
