// Server-side safety-content management. Administrators only; every save is validated and recorded.
import { getStore } from '../db'
import { HttpError } from '../reportService'
import type { ZoneCaller } from '../zones/auth'
import { toPublished, validateSafetySave, type SafetyRow } from './admin'
import { getGuide } from './index'

const actorOf = (c: ZoneCaller) => (c.token ? { token: c.token } : undefined)
function requireAdmin(c: ZoneCaller) {
  if (!c.role) throw new HttpError(401, 'Sign in to manage safety content.')
  if (c.role !== 'admin') throw new HttpError(403, 'Only administrators can manage safety content.')
}

/** Public: only guides an administrator has reviewed and published. */
export async function publishedContent() {
  const rows = await getStore().listSafetyContent({ publishedOnly: true })
  return rows.map(toPublished).filter((x): x is NonNullable<ReturnType<typeof toPublished>> => !!x)
}

export async function adminContent(caller: ZoneCaller): Promise<SafetyRow[]> {
  requireAdmin(caller)
  return getStore().listSafetyContent()
}

export async function saveContent(caller: ZoneCaller, raw: unknown, now = Date.now()) {
  requireAdmin(caller)
  const v = validateSafetySave(raw, now)
  if (!v.ok) throw new HttpError(400, v.errors.join(' '))
  const s = v.value
  const store = getStore()
  const prev = (await store.listSafetyContent()).find((r) => r.hazard_id === s.hazard_id)
  const content = s.content ?? prev?.content ?? getGuide(s.hazard_id)!
  if (s.action === 'retire' && prev?.status !== 'published') throw new HttpError(409, 'Only a published guide can be retired. The built-in guide is shown again after retiring.')
  if (s.action === 'save_draft' && prev?.status === 'published') throw new HttpError(409, 'This guide is published. A draft would take it offline, so publish your changes with a new review, or retire it first.')
  const status = s.action === 'publish' ? 'published' : s.action === 'retire' ? 'retired' : 'draft'
  return store.saveSafetyContent(
    {
      hazard_id: s.hazard_id, content, status, reviewed_by: status === 'published' ? s.reviewed_by! : status === 'retired' ? prev?.reviewed_by ?? null : null,
      reviewed_on: status === 'published' ? s.reviewed_on! : status === 'retired' ? prev?.reviewed_on ?? null : null, change_reason: s.change_reason!, updated_by: caller.email,
    },
    actorOf(caller)
  )
}

export async function revisions(caller: ZoneCaller, hazardId: string) {
  requireAdmin(caller)
  if (!getGuide(hazardId)) throw new HttpError(404, 'Unknown category')
  return getStore().listSafetyRevisions(hazardId, actorOf(caller))
}
