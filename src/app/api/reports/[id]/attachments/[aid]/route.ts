import { NextRequest, NextResponse } from 'next/server'
import { getStore } from '@/lib/db'
import { handleError, HttpError, loadReport } from '@/lib/reportService'
import { resolveCaller } from '@/lib/serverAuth'
import { assertStaff } from '@/lib/attachmentAccess'
import { signPhotoUrl, verifyPhotoSignature } from '@/lib/signedUrl'

export const dynamic = 'force-dynamic'

// GET /api/reports/:id/attachments/:aid - the photo itself, streamed through the server so the
// storage bucket can stay private. Responders and admins only; never cached.
export async function GET(request: NextRequest, { params }: { params: { id: string; aid: string } }) {
  try {
    const q = new URL(request.url).searchParams
    const report = await loadReport(params.id)
    const row = (await getStore().listAttachments(report.id)).find((a) => a.id === params.aid)
    // Either a short-lived signed link (minted for staff by POST below) or a responder/admin bearer token.
    if (!(q.get('sig') && verifyPhotoSignature(report.id, params.aid, q.get('exp'), q.get('sig')))) assertStaff(await resolveCaller(request))
    if (!row) throw new HttpError(404, 'Photo not found')
    const bytes = await getStore().readAttachment(row)
    if (!bytes) throw new HttpError(404, 'Photo file is not available (is SUPABASE_SERVICE_ROLE_KEY set on the server?)')
    return new NextResponse(bytes as unknown as BodyInit, {
      headers: { 'Content-Type': row.mime_type, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
    })
  } catch (err) {
    return handleError(err)
  }
}

// POST /api/reports/:id/attachments/:aid - mint a 5-minute signed link for one photo (staff only).
export async function POST(request: NextRequest, { params }: { params: { id: string; aid: string } }) {
  try {
    assertStaff(await resolveCaller(request))
    const report = await loadReport(params.id)
    const row = (await getStore().listAttachments(report.id)).find((a) => a.id === params.aid)
    if (!row) throw new HttpError(404, 'Photo not found')
    return NextResponse.json(signPhotoUrl(report.id, row.id), { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (err) {
    return handleError(err)
  }
}
