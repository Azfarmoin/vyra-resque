// Internet channel: the existing VYRA API through the offline sync engine. Wi-Fi is NOT required: any link the
// device has (mobile data, Wi-Fi, Ethernet) is used. We never check which kind of link it is before sending.
import { getReport } from '../../offline/store'
import { defaultDeps, syncAll } from '../../offline/sync'
import type { AdapterContext, Availability, ChannelAdapter, DeliveryDeps, SendResult } from './types'

const SEND_TIMEOUT_MS = 25_000

export function linkKind(deps?: DeliveryDeps): 'cellular' | 'wifi' | 'other' | 'unknown' {
  if (deps?.connection) return deps.connection()
  try {
    const t = (navigator as Navigator & { connection?: { type?: string } }).connection?.type
    if (t === 'cellular') return 'cellular'
    if (t === 'wifi') return 'wifi'
    if (t && t !== 'none' && t !== 'unknown') return 'other'
  } catch { /* not available */ }
  return 'unknown'
}

const browserOnline = (deps?: DeliveryDeps) => (deps?.isOnline ? deps.isOnline() : typeof navigator === 'undefined' ? true : navigator.onLine !== false)

export const internetAdapter: ChannelAdapter = {
  id: 'internet',
  async availability(ctx: AdapterContext): Promise<Availability> {
    // navigator.onLine === false means the device has no network at all (e.g. airplane mode). The flag is only a hint
    // (it is true on Wi-Fi with no internet), so a manual retry tries anyway and lets the request itself decide.
    if (!browserOnline(ctx.deps) && !ctx.force) return { available: false, reason: 'The device reports no network connection (airplane mode or no signal).' }
    return { available: true, reason: null }
  },
  async send(ctx: AdapterContext): Promise<SendResult> {
    const id = ctx.report.client_id
    const deps = { ...defaultDeps(), ...(ctx.deps.syncDeps ?? {}), isOnline: () => true }
    await Promise.race([syncAll({ force: true, only: id }, deps).catch(() => null), new Promise((r) => setTimeout(r, SEND_TIMEOUT_MS))])
    const after = await getReport(id)
    if (after?.server_id) {
      const photosOk = after.status === 'synced'
      return {
        outcome: 'acked',
        detail: photosOk
          ? after.server_ingest_channel ? `The VYRA server confirmed the full report. It already had the short message you sent by ${after.server_ingest_channel}.` : 'The VYRA server confirmed receipt of the full report and photos.'
          : 'The VYRA server confirmed the report. Photos are still uploading.',
      }
    }
    if (after?.status === 'needs_auth') return { outcome: 'failed', detail: after.last_error || 'Sign in to send this report over the internet. Other channels do not need an account.' }
    return { outcome: 'failed', detail: after?.last_error || 'The server could not be reached.' }
  },
}
