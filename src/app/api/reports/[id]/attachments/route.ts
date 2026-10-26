import { NextRequest, NextResponse } from 'next/server'
import { getStore } from '@/lib/db'
import { handleError, HttpError, loadReport } from '@/lib/reportService'
import { AuthError, resolveCaller } from '@/lib/serverAuth'
import { assertMayAttach } from '@/lib/attachmentAccess'
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_REPORT, sniffImageType } from '@/lib/attachments'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } }

// POST /api/reports/:id/attachments - raw image bytes in the body.
// Headers: X-Attachment-Id (device-generated, makes retries idempotent), X-Report-Client-Id.
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const attachmentId = (request.headers.get('x-attachment-id') || '').trim()
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(attachmentId)) throw new HttpError(400, 'X-Attachment-Id header is required (8-64 letters, digits, - or _)')

    const report = await loadReport(params.id)
    assertMayAttach(await resolveCaller(request), report, request.headers.get('x-report-client-id'))

    const store = getStore()
    const existing = await store.findAttachment(report.id, attachmentId)
    if (existing) return NextResponse.json({ attachment: pub(existing), duplicate: true }, { status: 200 })

    const declared = Number(request.headers.get('content-length') || 0)
    if (declared > MAX_ATTACHMENT_BYTES) throw new HttpError(413, 'Photo is larger than 5 MB')
    const bytes = new Uint8Array(await request.arrayBuffer())
    if (!bytes.byteLength) throw new HttpError(400, 'Empty upload')
    if (bytes.byteLength > MAX_ATTACHMENT_BYTES) throw new HttpError(413, 'Photo is larger than 5 MB')
    const mime = sniffImageType(bytes)
    if (!mime) throw new HttpError(415, 'Only JPEG, PNG or WebP photos are accepted')

    if ((await store.listAttachments(report.id)).length >= MAX_ATTACHMENTS_PER_REPORT) {
      throw new HttpError(422, `A report can have at most ${MAX_ATTACHMENTS_PER_REPORT} photos`)
    }
    const saved = await store.saveAttachment({ report_id: report.id, client_id: attachmentId, mime_type: mime, bytes })
    return NextResponse.json({ attachment: pub(saved), duplicate: false }, { status: 201 })
  } catch (err) {
    return handleError(err)
  }
}

// GET /api/reports/:id/attachments - photo list for responders and admins only.
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const caller = await resolveCaller(request)
    if (caller.kind !== 'user' || caller.role === 'citizen') throw new AuthError(caller.kind === 'user' ? 403 : 401, 'Responder sign-in required', caller.kind === 'user' ? 'forbidden' : 'auth_required')
    const report = await loadReport(params.id)
    const rows = await getStore().listAttachments(report.id)
    return NextResponse.json({ attachments: rows.map(pub) })
  } catch (err) {
    return handleError(err)
  }
}

const pub = (a: { id: string; client_id: string; mime_type: string; size_bytes: number; created_at: string }) => ({
  id: a.id,
  client_id: a.client_id,
  mime_type: a.mime_type,
  size_bytes: a.size_bytes,
  created_at: a.created_at,
})
