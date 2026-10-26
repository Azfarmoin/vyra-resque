import { NextRequest } from 'next/server'
import { fail, guard, json, readJson } from '@/lib/satellite/http'
import { ADVISORY, createAnalysis, listAnalyses, SatError, type UploadInput } from '@/lib/satellite/service'
import type { UploadDeclaration } from '@/lib/satellite/providers/userUpload'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET /api/satellite/analyses?limit=&targetType=&targetId= - history (newest first), optionally only those linked to one record.
export async function GET(request: NextRequest) {
  const g = await guard(request)
  if (!g.ok) return g.res
  try {
    const q = request.nextUrl.searchParams
    return json({ analyses: await listAnalyses(g.user, { limit: Number(q.get('limit')) || undefined, targetType: q.get('targetType') || undefined, targetId: q.get('targetId') || undefined }), advisory: ADVISORY })
  } catch (e) { return fail(e) }
}

// POST /api/satellite/analyses
//   JSON:      { provider, collection, aoi, beforeRange, afterRange, beforeSceneId, afterSceneId, parameters? }
//   multipart: params (JSON, as above plus "uploads":{before:{...declaration},after:{...}}) and files "before" and "after" (user-supplied GeoTIFFs)
export async function POST(request: NextRequest) {
  const g = await guard(request)
  if (!g.ok) return g.res
  try {
    let body: Record<string, unknown>, uploads: { before: UploadInput; after: UploadInput } | null = null
    if ((request.headers.get('content-type') || '').includes('multipart/form-data')) {
      const form = await request.formData().catch(() => null)
      if (!form) throw new SatError(400, 'The upload could not be read.', 'validation')
      try { body = JSON.parse(String(form.get('params') || '{}')) } catch { throw new SatError(400, 'The "params" field is not valid JSON.', 'validation') }
      const decl = (body.uploads ?? {}) as Record<string, UploadDeclaration>
      const bf = form.get('before'), af = form.get('after')
      if (bf instanceof File && af instanceof File) uploads = { before: { buf: await bf.arrayBuffer(), filename: bf.name, decl: decl.before }, after: { buf: await af.arrayBuffer(), filename: af.name, decl: decl.after } }
      if (uploads && (!uploads.before.decl || !uploads.after.decl)) throw new SatError(400, 'Describe both uploaded images (date, platform, sensor type, band order).', 'validation')
    } else body = await readJson(request)
    const analysis = await createAnalysis(g.user, { ...body, uploads } as Parameters<typeof createAnalysis>[1])
    return json({ analysis, advisory: ADVISORY }, 201)
  } catch (e) { return fail(e) }
}
