import { AuthError, type Caller } from './serverAuth'

// Only the account that owns the report, or (for anonymous reports) the device that created it,
// may add photos to it or see its analysis. The device proves it by sending the report's client_id,
// which is never included in any public response.
export function assertMayAttach(caller: Caller, report: { reporter_id: string | null; client_id: string | null }, clientIdHeader: string | null) {
  if (caller.kind === 'invalid') throw new AuthError(401, 'Your session has expired. Sign in again to upload photos.', 'auth_required')
  if (report.reporter_id) {
    if (caller.kind !== 'user') throw new AuthError(401, 'Sign in to upload photos for this report.', 'auth_required')
    if (caller.userId !== report.reporter_id) throw new AuthError(403, 'This report belongs to a different account.', 'account_mismatch')
    return
  }
  if (!report.client_id || clientIdHeader !== report.client_id) throw new AuthError(403, 'Not allowed to add photos to this report.', 'forbidden')
}

export function assertStaff(caller: Caller): asserts caller is Extract<Caller, { kind: 'user' }> {
  if (caller.kind !== 'user' || caller.role === 'citizen') throw new AuthError(caller.kind === 'user' ? 403 : 401, 'Responder sign-in required', caller.kind === 'user' ? 'forbidden' : 'auth_required')
}

export const isStaff = (caller: Caller) => caller.kind === 'user' && caller.role !== 'citizen'
