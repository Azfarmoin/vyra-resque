'use client'

// Radio (LoRa) and Bluetooth channels. Both talk to external hardware through the VYRA bridge line protocol
// (docs/MULTICHANNEL_DELIVERY.md):
//
//   phone -> bridge   VYRA?                     "who are you?"
//   bridge -> phone   VYRA-BRIDGE|1|<lora|relay>|<device id>
//   phone -> bridge   MSG|<compact message>     "put this on the air / hand it to the relay"
//   bridge -> phone   TX|<incident>             accepted and transmitted. NOT an acknowledgement.
//   bridge -> phone   ERR|<incident>|<reason>   could not transmit
//   bridge -> phone   ACK|<incident>|<gateway>  a gateway received it and answered over the mesh (VERIFIED)
//   bridge -> phone   OPACK|<incident>|<name>   a rescue operator acknowledged it (VERIFIED)
//
// Only ACK / OPACK ever move a report to a "delivered" state. TX only means "transmitted".
import { recordAckForIncident } from '../store'
import type { ChannelId } from '../types'
import type { AdapterContext, Availability, ChannelAdapter, SendResult } from './types'
import { BleTransport, SerialTransport, bleSupported, grantedSerialPorts, requestBleDevice, requestSerialPort, serialSupported, type LineTransport } from './transports'

export type BridgeRole = 'radio' | 'bluetooth'
export interface BridgeInfo { role: BridgeRole; kind: string; deviceId: string; transport: LineTransport }

const bridges = new Map<BridgeRole, BridgeInfo>()
const changeCbs = new Set<() => void>()
type LineEvent = { role: BridgeRole; line: string }
const waiters = new Set<(e: LineEvent) => void>()

const HANDSHAKE_MS = 3000
const EXPECT_KIND: Record<BridgeRole, string> = { radio: 'lora', bluetooth: 'relay' }

export const getBridge = (role: BridgeRole) => bridges.get(role) ?? null
export function onBridgeChange(cb: () => void) { changeCbs.add(cb); return () => { changeCbs.delete(cb) } }
const changed = () => changeCbs.forEach((cb) => cb())
export const bridgeSupport = () => ({ serial: serialSupported(), ble: bleSupported() })

// Acknowledgements are persisted the moment they arrive, even if nobody is waiting for them any more.
function handleLine(role: BridgeRole, line: string) {
  const parts = line.split('|')
  if (parts[0] === 'ACK' && parts[1]) void recordAckForIncident(parts[1], { kind: 'gateway', via: role, detail: `Gateway ${parts[2] || ''} confirmed receipt over ${role === 'radio' ? 'radio' : 'Bluetooth'}.`.replace('  ', ' ') }).catch(() => undefined)
  if (parts[0] === 'OPACK' && parts[1]) void recordAckForIncident(parts[1], { kind: 'operator', via: role, detail: `Rescue operator ${parts[2] || ''} acknowledged the report.`.replace('  ', ' ') }).catch(() => undefined)
  waiters.forEach((w) => w({ role, line }))
}

async function handshake(role: BridgeRole, t: LineTransport): Promise<{ kind: string; deviceId: string }> {
  const reply = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => { off(); reject(new Error('The device did not answer like a VYRA bridge, so no report was sent to it.')) }, HANDSHAKE_MS)
    const off = t.onLine((l) => {
      if (l.startsWith('VYRA-BRIDGE|')) { clearTimeout(timer); off(); resolve(l) }
    })
  })
  await t.writeLine('VYRA?')
  const f = (await reply).split('|')
  const kind = f[2] ?? ''
  if (f[1] !== '1') throw new Error(`Unsupported bridge protocol version "${f[1] ?? '?'}".`)
  if (kind !== EXPECT_KIND[role]) throw new Error(role === 'radio' ? `This is a "${kind}" device, not a LoRa radio bridge.` : `This is a "${kind}" device, not a nearby VYRA relay.`)
  return { kind, deviceId: f[3] ?? 'unknown' }
}

/** Exported for tests (fake hardware); the app uses connectBridge / restoreBridges. */
export async function adopt(role: BridgeRole, t: LineTransport): Promise<BridgeInfo> {
  await t.open()
  try {
    const info = await handshake(role, t)
    const b: BridgeInfo = { role, kind: info.kind, deviceId: info.deviceId, transport: t }
    bridges.get(role)?.transport.close().catch(() => undefined)
    bridges.set(role, b)
    t.onLine((l) => handleLine(role, l))
    t.onClose(() => { if (bridges.get(role)?.transport === t) { bridges.delete(role); changed() } })
    changed()
    return b
  } catch (e) {
    await t.close().catch(() => undefined)
    throw e
  }
}

/** Reopen serial devices the user allowed before. Needs no tap, so a plugged-in radio is ready as soon as the app opens. */
export async function restoreBridges(): Promise<void> {
  if (bridges.has('radio')) return
  for (const port of await grantedSerialPorts()) {
    try { await adopt('radio', new SerialTransport(port)); return } catch { /* not a VYRA radio, or busy: try the next port */ }
  }
}

/** Must be called from a tap (the browser shows its own device chooser). */
export async function connectBridge(role: BridgeRole, via: 'serial' | 'ble'): Promise<{ ok: boolean; message: string }> {
  try {
    const t = via === 'serial' ? new SerialTransport(await requestSerialPort()) : new BleTransport(await requestBleDevice())
    const b = await adopt(role, t)
    return { ok: true, message: `Connected to ${b.transport.name} (${b.deviceId}).` }
  } catch (e) {
    const err = e as Error
    if (err?.name === 'NotFoundError') return { ok: false, message: 'No device was chosen.' }
    return { ok: false, message: err?.message || 'Could not connect.' }
  }
}

export async function disconnectBridge(role: BridgeRole) {
  await bridges.get(role)?.transport.close().catch(() => undefined)
  bridges.delete(role)
  changed()
}

const incidentOf = (compact: string) => compact.split('|')[1] ?? ''

function waitFor(role: BridgeRole, incident: string, ms: number) {
  const seen = { tx: false, err: null as string | null, ack: null as null | 'gateway' | 'operator' }
  let finish: () => void = () => undefined
  const done = new Promise<typeof seen>((resolve) => {
    const timer = setTimeout(() => finish(), ms)
    const handler = (e: LineEvent) => {
      if (e.role !== role) return
      const p = e.line.split('|')
      if (p[1] !== incident) return
      if (p[0] === 'TX') seen.tx = true
      else if (p[0] === 'ERR') { seen.err = p[2] || 'The bridge refused the message.'; finish() }
      else if (p[0] === 'ACK') { seen.ack = seen.ack ?? 'gateway'; finish() }
      else if (p[0] === 'OPACK') { seen.ack = 'operator'; finish() }
    }
    waiters.add(handler)
    finish = () => { clearTimeout(timer); waiters.delete(handler); resolve(seen) }
  })
  return { done, cancel: () => finish() }
}

export function createBridgeAdapter(role: BridgeRole): ChannelAdapter {
  const radio = role === 'radio'
  return {
    id: role as ChannelId,
    async availability(): Promise<Availability> {
      const b = getBridge(role)
      if (b?.transport.isOpen()) return { available: true, reason: null }
      const supported = radio ? serialSupported() || bleSupported() : bleSupported()
      if (!supported) return { available: false, reason: radio ? 'This browser cannot reach radio hardware (needs Chrome or Edge with USB or Bluetooth).' : 'This browser cannot use Bluetooth LE (needs Chrome or Edge, not iOS Safari).' }
      return { available: false, reason: radio ? 'No LoRa radio bridge is connected. Plug it in or connect it under Delivery channels.' : 'No nearby VYRA relay is connected. Connect one under Delivery channels.' }
    },
    async send(ctx: AdapterContext): Promise<SendResult> {
      const b = getBridge(role)
      if (!b?.transport.isOpen()) return { outcome: 'unavailable', detail: radio ? 'The radio bridge is not connected.' : 'The Bluetooth relay is not connected.' }
      const incident = incidentOf(ctx.compact)
      const w = waitFor(role, incident, ctx.config.ackWaitMs)
      try {
        await b.transport.writeLine(`MSG|${ctx.compact}`)
      } catch (e) {
        w.cancel()
        return { outcome: 'failed', detail: `Could not write to ${b.transport.name}: ${(e as Error).message}` }
      }
      const seen = await w.done
      if (seen.ack) {
        return {
          outcome: 'acked', ack: { operator: seen.ack === 'operator' },
          detail: seen.ack === 'operator' ? 'A rescue operator acknowledged the report.' : `A gateway confirmed receipt over ${radio ? 'radio' : 'Bluetooth'}.`,
        }
      }
      if (seen.err) return { outcome: 'failed', detail: `${b.transport.name} could not send it: ${seen.err}` }
      if (seen.tx) {
        return {
          outcome: 'transmitted',
          detail: radio
            ? 'Transmitted over radio. No gateway has acknowledged it yet, so it is NOT confirmed delivered. It will be re-sent until one does.'
            : 'Handed to the nearby device. No gateway has acknowledged it yet, so it is NOT confirmed delivered.',
        }
      }
      return { outcome: 'failed', detail: `${b.transport.name} did not confirm that it transmitted the message.` }
    },
  }
}
