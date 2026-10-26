import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { ManualError, withdrawAnnouncement } from '@/lib/alerts/manual'
import { createWebPushSender } from '@/lib/alerts/push'
import { getAlertStoreStatus } from '@/lib/alerts/service'

export const dynamic = 'force-dynamic'

// DELETE /api/admin/alerts/:id - withdraw an announcement written in VYRA. Imported alerts cannot be changed here.
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireAdmin(request)
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status })
  try {
    const alert = await withdrawAnnouncement(getAlertStoreStatus().store, params.id, admin.email, await createWebPushSender())
    return NextResponse.json({ alert })
  } catch (e) {
    if (e instanceof ManualError) return NextResponse.json({ error: e.message }, { status: e.status })
    return NextResponse.json({ error: 'Could not withdraw the announcement.' }, { status: 500 })
  }
}
