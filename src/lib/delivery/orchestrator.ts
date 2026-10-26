// Delivery orchestrator. Order of events for every report:
//
//   1. The report is ALREADY on the device (offline/store.queueReport). Nothing here depends on any network.
//   2. Every enabled channel is tried in the user's priority order. Unavailable channels cost nothing.
//   3. A channel result is one of: acked (verified), transmitted/handed_off (sent, NOT confirmed), failed, unavailable.
//      Only "acked" can produce a delivered stage. Transmitted never does.
//   4. After a constrained channel (radio, SMS, Bluetooth) is acknowledged, the full report and photos still go out
//      over the internet when it becomes available (idempotent: same client_id, so no duplicate incident).
//   5. If nothing is acknowledged the report stays queued with "Delivery Failed — Retry Available" and a plain
//      explanation, and is retried (backoff) and re-tried the moment a connection or radio appears.
import { listAllReports, getReport } from '../offline/store'
import { computeBackoffMs } from '../offline/sync'
import { adapterFor } from './adapters'
import type { AdapterContext, DeliveryDeps, SendResult } from './adapters/types'
import { linkKind } from './adapters/internet'
import { encodeCompact } from './compact'
import { getConfig, getDelivery, listDeliveries, logAttempt, patchDelivery, recordAck, setChannel, setStage } from './store'
import { CHANNEL_LABEL, type ChannelId, type DeliveryRecord, type DeliveryStage } from './types'

export interface DeliverOptions {
  force?: boolean
  userGesture?: boolean
  only?: ChannelId[]
  deps?: Partial<DeliveryDeps>
}

const RETRY_CAP_MS = 120_000 // an emergency report should not wait ten minutes between tries
const ACK_RETRANSMIT_MIN_MS = 30_000 // do not flood a shared radio channel
const STALE_SENDING_MS = 120_000

const withDefaults = (d?: Partial<DeliveryDeps>): DeliveryDeps => ({ now: () => Date.now(), ...d })
const iso = (ms: number) => new Date(ms).toISOString()

function sendingStage(ch: ChannelId, deps: DeliveryDeps): DeliveryStage | null {
  if (ch === 'radio') return 'sending_radio'
  if (ch === 'sms') return 'sending_sms'
  if (ch === 'internet') return linkKind(deps) === 'cellular' ? 'sending_mobile_data' : 'sending_internet'
  return null // Bluetooth and manual have no "sending" label of their own; the detail line explains
}

const PENDING_STAGE: Partial<Record<ChannelId, (deps: DeliveryDeps) => DeliveryStage>> = {
  radio: () => 'sending_radio',
  sms: () => 'sending_sms',
  bluetooth: () => 'transferred_nearby',
}

/** Work out the stage from what every channel has done so far. */
function settle(r: DeliveryRecord, order: ChannelId[], deps: DeliveryDeps) {
  if (r.operator_ack_at || r.gateway_ack_at) { setStage(r, 'received_gateway', r.gateway_ack_via, r.detail); return }
  const pending = order.find((c) => r.channels[c]?.state === 'pending_ack')
  if (pending) {
    setStage(r, PENDING_STAGE[pending]!(deps), pending, r.channels[pending]?.reason ?? 'Sent, waiting for an acknowledgement. Not confirmed delivered.')
    return
  }
  const why = order
    .map((c) => ({ c, s: r.channels[c] }))
    .filter((x) => x.s && ['unavailable', 'failed', 'needs_user_action'].includes(x.s.state) && x.s.reason)
    .map((x) => `${CHANNEL_LABEL[x.c]}: ${x.s!.reason}`)
  setStage(r, 'failed_retry', null, `NOT delivered yet. The report is safe on this device and will be retried automatically.${why.length ? ` ${why.join(' · ')}` : ''}`.slice(0, 900))
}

const inflight = new Map<string, Promise<DeliveryRecord | null>>()

export function deliverReport(clientId: string, opts: DeliverOptions = {}): Promise<DeliveryRecord | null> {
  // A targeted action (e.g. the "Send via SMS" tap) must run now; a general run joins one already in progress.
  if (!opts.only) {
    const running = inflight.get(clientId)
    if (running) return running
  }
  const p = run(clientId, opts).finally(() => { if (inflight.get(clientId) === p) inflight.delete(clientId) })
  if (!opts.only) inflight.set(clientId, p)
  return p
}

async function run(clientId: string, opts: DeliverOptions): Promise<DeliveryRecord | null> {
  const deps = withDefaults(opts.deps)
  const report = await getReport(clientId)
  if (!report || !report.payload || report.status === 'draft') return null
  const rec0 = await getDelivery(clientId)
  if (rec0?.operator_ack_at && report.server_id && report.status === 'synced') return rec0 // nothing left to do
  const config = await getConfig()

  // The compact message is built once and reused, so every channel carries the identical text and the identical incident id.
  const compact = rec0?.compact ?? encodeCompact({ ...(report.payload as Record<string, unknown>), client_id: clientId } as never).text
  await patchDelivery(clientId, (r) => { r.compact = compact; r.runs += 1; r.next_retry_at = null })

  // What to try: the server already has it -> only the photos remain (internet). A constrained channel already
  // acknowledged it -> only the full report is missing (internet). Otherwise everything, in priority order.
  let channels: ChannelId[] = opts.only ?? config.order
  channels = channels.filter((c) => config.enabled[c])
  if (!opts.only && (report.server_id || rec0?.gateway_ack_at)) channels = channels.filter((c) => c === 'internet')

  const ctxBase = (r = report): AdapterContext => ({ report: r, compact, config, force: !!opts.force, userGesture: !!opts.userGesture, deps })

  for (const ch of channels) {
    const adapter = adapterFor(ch, deps)
    let av
    try { av = await adapter.availability(ctxBase()) } catch (e) { av = { available: false, reason: (e as Error).message } }
    if (!av.available) {
      await patchDelivery(clientId, (r) => setChannel(r, ch, { state: 'unavailable', reason: av.reason }))
      continue
    }
    const stage = sendingStage(ch, deps)
    await patchDelivery(clientId, (r) => {
      if (stage) setStage(r, stage, ch, `Trying ${CHANNEL_LABEL[ch]}…`)
      else r.detail = r.operator_ack_at || r.gateway_ack_at ? r.detail : `Trying ${CHANNEL_LABEL[ch]}…`
    })

    let res: SendResult
    try { res = await adapter.send(ctxBase((await getReport(clientId)) ?? report)) } catch (e) { res = { outcome: 'failed', detail: (e as Error).message || 'Unexpected error' } }

    if (res.outcome === 'acked') {
      await recordAck(clientId, { kind: res.ack?.operator ? 'operator' : 'gateway', via: ch, detail: res.detail })
      if (ch === 'internet') break
      // A constrained channel has it. The full report and photos still need the internet; try that next.
      const net = channels.find((c) => c === 'internet')
      if (!net || opts.only) break
      channels = ['internet']
      const a = adapterFor('internet', deps)
      const avNet = await a.availability(ctxBase()).catch(() => ({ available: false, reason: 'Internet unavailable' }))
      if (!avNet.available) { await patchDelivery(clientId, (r) => setChannel(r, 'internet', { state: 'unavailable', reason: avNet.reason })); break }
      const full = await a.send(ctxBase((await getReport(clientId)) ?? report)).catch((e: Error) => ({ outcome: 'failed' as const, detail: e.message }))
      if (full.outcome === 'acked') await recordAck(clientId, { kind: 'gateway', via: 'internet', detail: full.detail })
      else await patchDelivery(clientId, (r) => { setChannel(r, 'internet', { state: 'failed', reason: full.detail }); logAttempt(r, { channel: 'internet', outcome: 'failed', detail: full.detail }) })
      break
    }

    await patchDelivery(clientId, (r) => {
      logAttempt(r, { channel: ch, outcome: res.outcome, detail: res.detail })
      if (res.outcome === 'transmitted' || res.outcome === 'handed_off') {
        // SMS hand-off: the person still has to press Send, and nobody can see whether they did.
        setChannel(r, ch, { state: 'pending_ack', reason: res.detail })
      } else if (res.outcome === 'needs_user_action') setChannel(r, ch, { state: 'needs_user_action', reason: res.detail })
      else if (res.outcome === 'unavailable') setChannel(r, ch, { state: 'unavailable', reason: res.detail })
      else setChannel(r, ch, { state: 'failed', reason: res.detail })
    })
  }

  // Decide the final stage and when to try again.
  const after = (await getReport(clientId)) ?? report
  return patchDelivery(clientId, (r) => {
    settle(r, config.order, deps)
    const delivered = !!r.operator_ack_at || (!!r.gateway_ack_at && !!after.server_id && after.status === 'synced')
    if (delivered && (r.operator_ack_at || after.status === 'synced')) { r.next_retry_at = null; return }
    const pendingAck = config.order.some((c) => r.channels[c]?.state === 'pending_ack')
    const floor = pendingAck ? ACK_RETRANSMIT_MIN_MS : 0
    const wait = Math.max(floor, Math.min(RETRY_CAP_MS, computeBackoffMs(r.runs)))
    r.next_retry_at = iso(deps.now() + wait)
  })
}

/** Try every report that still needs delivery. Called on app open, on a timer, and when a connection or radio appears. */
export async function deliverPending(opts: { force?: boolean; deps?: Partial<DeliveryDeps> } = {}): Promise<number> {
  const deps = withDefaults(opts.deps)
  const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined
  const job = async () => {
    const now = deps.now()
    const recs = new Map((await listDeliveries()).map((d) => [d.client_id, d]))
    const due = (await listAllReports())
      .filter((r) => r.payload && r.status !== 'draft' && !(r.server_id && r.status === 'synced'))
      .filter((r) => {
        const d = recs.get(r.client_id)
        if (d?.operator_ack_at && r.server_id && r.status === 'synced') return false
        if (r.status === 'failed' && !opts.force) return false // the server rejected it: a person must decide
        return opts.force || !d?.next_retry_at || Date.parse(d.next_retry_at) <= now
      })
      .sort((a, b) => (a.queued_at ?? a.created_at).localeCompare(b.queued_at ?? b.created_at))
    for (const r of due) await deliverReport(r.client_id, { force: opts.force, deps })
    return due.length
  }
  if (!locks) return job()
  // One tab at a time; other tabs simply skip this round and see the result through the shared database.
  return ((await locks.request('vyra-delivery', { ifAvailable: true }, async (lock) => (lock ? job() : 0))) as number) ?? 0
}

/** After a crash or a closed tab a row can say "sending" forever. Turn those back into an honest "retry available". */
export async function resetStaleSending(nowMs = Date.now()): Promise<void> {
  for (const d of await listDeliveries()) {
    if (!d.stage.startsWith('sending_')) continue
    if (nowMs - Date.parse(d.updated_at) < STALE_SENDING_MS) continue
    await patchDelivery(d.client_id, (r) => {
      if (r.gateway_ack_at) return
      r.stage = 'failed_retry'
      r.detail = 'NOT delivered yet. Sending was interrupted (the app closed or lost power). The report is safe on this device and will be retried.'
      r.next_retry_at = null
    })
  }
}

/** Ask the server whether a rescue operator has picked up reports it already holds. Read-only, internet only. */
export async function refreshOperatorAcks(fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<void> {
  const recs = new Map((await listDeliveries()).map((d) => [d.client_id, d]))
  for (const r of await listAllReports()) {
    if (!r.server_id || recs.get(r.client_id)?.operator_ack_at) continue
    try {
      const res = await fetchImpl(`/api/reports/${r.server_id}/public-status`, { cache: 'no-store' })
      if (!res.ok) continue
      const status = ((await res.json()) as { report?: { status?: string } }).report?.status
      if (!status) continue
      if (['investigating', 'assigned', 'resolved'].includes(status)) await recordAck(r.client_id, { kind: 'operator', via: 'internet', serverStatus: status, detail: 'A rescue operator is working on this report.' })
      else await patchDelivery(r.client_id, (d) => { d.server_status = status })
    } catch { /* offline: try again later */ }
  }
}

const SMS_HANDOFF = 'Opened your messaging app with the report ready. Press Send there. VYRA cannot see whether it was sent or delivered, so this is NOT confirmed delivered.'

/** Call right after the SMS app was opened (from the tap itself). Records a hand-off, never a delivery. */
export async function markSmsHandedOff(clientId: string): Promise<void> {
  await patchDelivery(clientId, (r) => {
    logAttempt(r, { channel: 'sms', outcome: 'handed_off', detail: SMS_HANDOFF })
    setChannel(r, 'sms', { state: 'pending_ack', reason: SMS_HANDOFF })
    setStage(r, 'sending_sms', 'sms', SMS_HANDOFF)
  })
}
