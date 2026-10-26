// Persistence for delivery state and channel settings (IndexedDB only, never localStorage).
import { getDb } from '../offline/db'
import { notifyChange } from '../offline/events'
import { incidentToClientId } from './compact'
import {
  DEFAULT_ORDER, MAX_ATTEMPT_LOG,
  type ChannelId, type ChannelStatus, type DeliveryAttempt, type DeliveryConfig, type DeliveryRecord, type DeliveryStage,
} from './types'

const nowIso = () => new Date().toISOString()

export function blankRecord(clientId: string, at = nowIso()): DeliveryRecord {
  return {
    client_id: clientId, stage: 'saved', channel: null, detail: 'Saved on this device. Delivery has not been confirmed.', updated_at: at,
    compact: null, attempts: [], channels: {}, gateway_ack_at: null, gateway_ack_via: null, operator_ack_at: null,
    server_status: null, runs: 0, next_retry_at: null,
  }
}

export async function getDelivery(clientId: string): Promise<DeliveryRecord | undefined> {
  return (await getDb()).get('delivery', clientId)
}

export async function listDeliveries(): Promise<DeliveryRecord[]> {
  return (await getDb()).getAll('delivery')
}

/** Read-modify-write in ONE transaction, so a late acknowledgement and a running delivery cannot lose each other's data. */
export async function patchDelivery(clientId: string, fn: (cur: DeliveryRecord) => DeliveryRecord | void): Promise<DeliveryRecord> {
  const db = await getDb()
  const tx = db.transaction('delivery', 'readwrite')
  const cur = (await tx.store.get(clientId)) ?? blankRecord(clientId)
  const draft: DeliveryRecord = structuredCloneSafe(cur)
  const next = fn(draft) ?? draft
  next.updated_at = nowIso()
  next.attempts = next.attempts.slice(-MAX_ATTEMPT_LOG)
  // A verified acknowledgement is never undone by a later (or slower) attempt.
  if (cur.operator_ack_at) next.operator_ack_at = cur.operator_ack_at
  if (cur.gateway_ack_at) { next.gateway_ack_at = cur.gateway_ack_at; next.gateway_ack_via = cur.gateway_ack_via }
  await tx.store.put(next)
  await tx.done
  notifyChange()
  return next
}

function structuredCloneSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

export const setStage = (r: DeliveryRecord, stage: DeliveryStage, channel: ChannelId | null, detail: string | null) => {
  // Once acknowledged, only a better acknowledgement may replace the stage.
  if (r.operator_ack_at) { r.stage = 'acknowledged'; return }
  if (r.gateway_ack_at && stage !== 'acknowledged') { r.stage = 'received_gateway'; return }
  r.stage = stage; r.channel = channel; r.detail = detail
}

export const setChannel = (r: DeliveryRecord, ch: ChannelId, status: Omit<ChannelStatus, 'at'>) => {
  r.channels[ch] = { ...status, at: nowIso() }
}

export const logAttempt = (r: DeliveryRecord, a: Omit<DeliveryAttempt, 'at'>) => {
  r.attempts.push({ ...a, at: nowIso() })
}

/**
 * A verified acknowledgement arrived (a radio/Bluetooth gateway answered, or the server confirmed).
 * `kind: 'operator'` means a rescue operator acknowledged the report.
 */
export async function recordAck(clientId: string, ack: { kind: 'gateway' | 'operator'; via: ChannelId; detail?: string; serverStatus?: string | null }): Promise<DeliveryRecord> {
  return patchDelivery(clientId, (r) => {
    const at = nowIso()
    if (!r.gateway_ack_at) { r.gateway_ack_at = at; r.gateway_ack_via = ack.via }
    if (ack.kind === 'operator' && !r.operator_ack_at) r.operator_ack_at = at
    if (ack.serverStatus !== undefined) r.server_status = ack.serverStatus
    setChannel(r, ack.via, { state: 'acked', reason: ack.detail ?? null })
    logAttempt(r, { channel: ack.via, outcome: 'acked', detail: ack.detail ?? (ack.kind === 'operator' ? 'A rescue operator acknowledged the report.' : 'A gateway confirmed receipt.') })
    r.stage = r.operator_ack_at ? 'acknowledged' : 'received_gateway'
    r.channel = ack.via
    r.detail = r.operator_ack_at ? 'A rescue operator has acknowledged this report.' : ack.detail ?? 'A gateway confirmed it received this report.'
    r.next_retry_at = null
  })
}

/** Acknowledgement line from a radio / Bluetooth bridge: addressed by the 22-character incident id. */
export async function recordAckForIncident(incident: string, ack: { kind: 'gateway' | 'operator'; via: ChannelId; detail?: string }): Promise<DeliveryRecord | null> {
  const clientId = incidentToClientId(incident)
  if (!clientId) return null
  const db = await getDb()
  if (!(await db.get('reports', clientId))) return null // not one of ours: ignore other people's acknowledgements
  return recordAck(clientId, ack)
}

// ---------- settings ----------
const CONFIG_KEY = 'deliveryConfig'

export function defaultConfig(): DeliveryConfig {
  return {
    order: [...DEFAULT_ORDER],
    enabled: { radio: true, sms: true, bluetooth: true, internet: true, manual: true },
    smsNumber: (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_VYRA_SMS_GATEWAY) || '',
    ackWaitMs: 8000,
  }
}

export function normaliseConfig(raw: Partial<DeliveryConfig> | undefined | null): DeliveryConfig {
  const d = defaultConfig()
  if (!raw) return d
  const order = Array.isArray(raw.order) ? raw.order.filter((c, i, a): c is ChannelId => DEFAULT_ORDER.includes(c) && a.indexOf(c) === i) : []
  for (const c of DEFAULT_ORDER) if (!order.includes(c)) order.push(c) // never lose a channel because of an old/broken setting
  return {
    order,
    enabled: { ...d.enabled, ...(raw.enabled ?? {}) },
    smsNumber: typeof raw.smsNumber === 'string' ? raw.smsNumber.replace(/[^0-9+]/g, '').slice(0, 16) : d.smsNumber,
    ackWaitMs: Math.min(60_000, Math.max(1_000, Number(raw.ackWaitMs) || d.ackWaitMs)),
  }
}

export async function getConfig(): Promise<DeliveryConfig> {
  try {
    const row = await (await getDb()).get('meta', CONFIG_KEY)
    return normaliseConfig(row?.value as Partial<DeliveryConfig> | undefined)
  } catch {
    return defaultConfig()
  }
}

export async function setConfig(cfg: Partial<DeliveryConfig>): Promise<DeliveryConfig> {
  const next = normaliseConfig({ ...(await getConfig()), ...cfg })
  await (await getDb()).put('meta', { key: CONFIG_KEY, value: next })
  notifyChange()
  return next
}
