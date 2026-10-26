'use client'

// Line-based links to external hardware: USB serial (Web Serial) and Bluetooth LE (Web Bluetooth, Nordic UART service).
// These APIs exist only in Chromium-based browsers (and need HTTPS plus a user choosing the device). Where they are
// missing the matching channel reports "unavailable"; nothing is ever pretended.

export interface LineTransport {
  readonly kind: 'serial' | 'ble'
  readonly name: string
  open(): Promise<void>
  writeLine(line: string): Promise<void>
  onLine(cb: (line: string) => void): () => void
  onClose(cb: () => void): void
  close(): Promise<void>
  isOpen(): boolean
}

// ---- minimal typings (these APIs are not in TypeScript's DOM lib) ----
export interface SerialPortLike {
  open(o: { baudRate: number }): Promise<void>
  close(): Promise<void>
  readable: ReadableStream<Uint8Array> | null
  writable: WritableStream<Uint8Array> | null
}
interface SerialLike { requestPort(o?: unknown): Promise<SerialPortLike>; getPorts(): Promise<SerialPortLike[]> }
interface BleCharacteristic {
  value?: DataView
  startNotifications(): Promise<BleCharacteristic>
  writeValue(v: BufferSource): Promise<void>
  writeValueWithoutResponse?(v: BufferSource): Promise<void>
  addEventListener(type: string, cb: (e: Event) => void): void
}
interface BleService { getCharacteristic(uuid: string): Promise<BleCharacteristic> }
interface BleServer { getPrimaryService(uuid: string): Promise<BleService> }
interface BleDevice { name?: string; gatt?: { connect(): Promise<BleServer>; disconnect(): void; connected: boolean }; addEventListener(type: string, cb: () => void): void }
interface BluetoothLike { requestDevice(o: unknown): Promise<BleDevice> }

const nav = () => (typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { serial?: SerialLike; bluetooth?: BluetoothLike }))
export const serialSupported = () => !!nav()?.serial
export const bleSupported = () => !!nav()?.bluetooth

abstract class BaseTransport {
  private lineCbs = new Set<(l: string) => void>()
  private closeCbs: (() => void)[] = []
  private buf = ''
  protected opened = false
  protected push(text: string) {
    this.buf += text
    let i: number
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).replace(/\r$/, '').trim()
      this.buf = this.buf.slice(i + 1)
      if (line) this.lineCbs.forEach((cb) => cb(line))
    }
    if (this.buf.length > 4096) this.buf = '' // garbage without a newline: never grow without bound
  }
  protected closed() {
    if (!this.opened) return
    this.opened = false
    this.closeCbs.forEach((cb) => cb())
  }
  onLine(cb: (l: string) => void) { this.lineCbs.add(cb); return () => { this.lineCbs.delete(cb) } }
  onClose(cb: () => void) { this.closeCbs.push(cb) }
  isOpen() { return this.opened }
}

export class SerialTransport extends BaseTransport implements LineTransport {
  readonly kind = 'serial' as const
  readonly name = 'USB serial radio'
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  constructor(private port: SerialPortLike) { super() }

  async open() {
    await this.port.open({ baudRate: 115200 })
    if (!this.port.readable || !this.port.writable) throw new Error('The serial port has no data stream')
    this.opened = true
    void this.loop()
  }
  private async loop() {
    const reader = this.port.readable!.getReader()
    this.reader = reader
    const dec = new TextDecoder()
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        if (value) this.push(dec.decode(value, { stream: true }))
      }
    } catch {
      /* cable pulled or device reset */
    } finally {
      try { reader.releaseLock() } catch { /* already released */ }
      this.closed()
    }
  }
  async writeLine(line: string) {
    if (!this.opened || !this.port.writable) throw new Error('The radio is not connected')
    const w = this.port.writable.getWriter()
    try { await w.write(new TextEncoder().encode(`${line}\n`)) } finally { w.releaseLock() }
  }
  async close() {
    try { await this.reader?.cancel() } catch { /* ignore */ }
    try { await this.port.close() } catch { /* ignore */ }
    this.closed()
  }
}

export const NUS_SERVICE = '6e400001-b5a3-f393-b0a9-e50e24dcca9e'
const NUS_RX = '6e400002-b5a3-f393-b0a9-e50e24dcca9e' // phone -> device (write)
const NUS_TX = '6e400003-b5a3-f393-b0a9-e50e24dcca9e' // device -> phone (notify)
const BLE_CHUNK = 20 // works with the default 23-byte MTU on every phone

export class BleTransport extends BaseTransport implements LineTransport {
  readonly kind = 'ble' as const
  name = 'Bluetooth device'
  private rx: BleCharacteristic | null = null
  constructor(private device: BleDevice) { super(); this.name = device.name || 'Bluetooth device' }

  async open() {
    if (!this.device.gatt) throw new Error('This Bluetooth device has no GATT server')
    const server = await this.device.gatt.connect()
    const svc = await server.getPrimaryService(NUS_SERVICE)
    this.rx = await svc.getCharacteristic(NUS_RX)
    const tx = await svc.getCharacteristic(NUS_TX)
    const dec = new TextDecoder()
    tx.addEventListener('characteristicvaluechanged', (e) => {
      const v = (e.target as unknown as BleCharacteristic).value
      if (v) this.push(dec.decode(v, { stream: true }))
    })
    await tx.startNotifications()
    this.device.addEventListener('gattserverdisconnected', () => this.closed())
    this.opened = true
  }
  async writeLine(line: string) {
    if (!this.opened || !this.rx) throw new Error('The Bluetooth device is not connected')
    const bytes = new TextEncoder().encode(`${line}\n`)
    for (let i = 0; i < bytes.length; i += BLE_CHUNK) {
      const chunk = bytes.slice(i, i + BLE_CHUNK)
      if (this.rx.writeValueWithoutResponse) await this.rx.writeValueWithoutResponse(chunk)
      else await this.rx.writeValue(chunk)
    }
  }
  async close() {
    try { this.device.gatt?.disconnect() } catch { /* ignore */ }
    this.closed()
  }
}

/** Ports the user already allowed earlier: can be reopened with no tap (that is what lets a plugged-in radio work at once). */
export async function grantedSerialPorts(): Promise<SerialPortLike[]> {
  try { return (await nav()?.serial?.getPorts()) ?? [] } catch { return [] }
}
export async function requestSerialPort(): Promise<SerialPortLike> {
  const s = nav()?.serial
  if (!s) throw new Error('This browser cannot talk to USB serial devices. Use Chrome or Edge on Android or desktop.')
  return s.requestPort()
}
export async function requestBleDevice(): Promise<BleDevice> {
  const b = nav()?.bluetooth
  if (!b) throw new Error('This browser cannot use Bluetooth LE devices. Use Chrome or Edge (not iOS Safari).')
  return b.requestDevice({ filters: [{ services: [NUS_SERVICE] }] })
}
