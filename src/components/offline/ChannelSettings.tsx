'use client'

import { useEffect, useState } from 'react'
import Icon, { type IconName } from '@/components/ui/Icon'
import { useDeliveryConfig } from '@/hooks/useDeliveryConfig'
import { bridgeSupport, connectBridge, disconnectBridge, getBridge, onBridgeChange, type BridgeRole } from '@/lib/delivery/adapters/bridge'
import { CHANNEL_LABEL, type ChannelId } from '@/lib/delivery/types'

const ICON: Record<ChannelId, IconName> = { radio: 'radio', sms: 'message', bluetooth: 'bluetooth', internet: 'globe', manual: 'qr' }

function BridgeRow({ role, label, options }: { role: BridgeRole; label: string; options: { via: 'serial' | 'ble'; text: string; ok: boolean }[] }) {
  const [, tick] = useState(0)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => onBridgeChange(() => tick((n) => n + 1)), [])
  const b = getBridge(role)
  const usable = options.filter((o) => o.ok)
  return (
    <div className="clay-inset p-2.5">
      <p className="font-bold">{label}</p>
      {b?.transport.isOpen() ? (
        <p className="mt-1 flex flex-wrap items-center gap-2">
          <span className="font-semibold text-success-800">Connected: {b.transport.name} ({b.deviceId})</span>
          <button type="button" className="btn-ghost btn-sm" onClick={() => void disconnectBridge(role)}>Disconnect</button>
        </p>
      ) : usable.length ? (
        <div className="mt-1 flex flex-wrap gap-2">
          {usable.map((o) => (
            <button key={o.via} type="button" className="btn-ghost btn-sm" disabled={busy} onClick={async () => { setBusy(true); const r = await connectBridge(role, o.via); setMsg(r.message); setBusy(false) }}>
              <Icon name={o.via === 'ble' ? 'bluetooth' : 'radio'} size={16} /> {o.text}
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-1 text-ink-700">This browser cannot reach this hardware. Use Chrome or Edge on Android or a computer.</p>
      )}
      {msg && <p className="mt-1 font-semibold" role="status">{msg}</p>}
    </div>
  )
}

// Which channels to use, in which order, plus the hardware and the SMS number they need.
export default function ChannelSettings() {
  const { config, update } = useDeliveryConfig()
  const [sms, setSms] = useState(config.smsNumber)
  const [support, setSupport] = useState({ serial: false, ble: false })
  useEffect(() => setSms(config.smsNumber), [config.smsNumber])
  useEffect(() => setSupport(bridgeSupport()), [])

  const move = (i: number, d: -1 | 1) => {
    const order = [...config.order]
    const j = i + d
    if (j < 0 || j >= order.length) return
    ;[order[i], order[j]] = [order[j], order[i]]
    void update({ order })
  }

  return (
    <section className="clay p-4 text-sm sm:p-5" aria-label="Delivery channels" data-testid="channel-settings">
      <h2 className="font-display text-lg font-semibold">Delivery channels</h2>
      <p className="mt-1 text-ink-700">Reports are saved first, then sent in this order. Channels that are not available are skipped at once. Wi-Fi is never required.</p>
      <ol className="mt-3 space-y-1.5">
        {config.order.map((c, i) => (
          <li key={c} className="clay-inset flex items-center gap-2 p-2">
            <Icon name={ICON[c]} size={18} className="shrink-0" />
            <label className="flex min-w-0 flex-1 items-center gap-2 font-bold">
              <input type="checkbox" checked={config.enabled[c]} onChange={(e) => void update({ enabled: { ...config.enabled, [c]: e.target.checked } })} />
              <span className="truncate">{i + 1}. {CHANNEL_LABEL[c]}</span>
            </label>
            <button type="button" className="btn-ghost btn-sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${CHANNEL_LABEL[c]} up`}><Icon name="chevron" size={16} className="rotate-180" /></button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => move(i, 1)} disabled={i === config.order.length - 1} aria-label={`Move ${CHANNEL_LABEL[c]} down`}><Icon name="chevron" size={16} /></button>
          </li>
        ))}
      </ol>

      <div className="mt-4 space-y-2">
        <BridgeRow role="radio" label="LoRa / radio mesh bridge" options={[{ via: 'serial', text: 'Connect by USB', ok: support.serial }, { via: 'ble', text: 'Connect by Bluetooth', ok: support.ble }]} />
        <BridgeRow role="bluetooth" label="Nearby VYRA relay (Bluetooth)" options={[{ via: 'ble', text: 'Connect relay', ok: support.ble }]} />
        <div className="clay-inset p-2.5">
          <label className="font-bold" htmlFor="sms-gateway">SMS gateway number</label>
          <div className="mt-1 flex gap-2">
            <input id="sms-gateway" inputMode="tel" autoComplete="off" className="input flex-1" placeholder="+92…" value={sms} onChange={(e) => setSms(e.target.value)} onBlur={() => void update({ smsNumber: sms })} />
          </div>
          <p className="mt-1 text-ink-700">A browser can only open your messaging app with the text ready. You press Send. Delivery cannot be seen from here.</p>
        </div>
      </div>
      <p className="mt-3 text-ink-700">Radio and Bluetooth need compatible external hardware and a Chromium browser. Nothing is assumed to be available: each channel shows why it was skipped.</p>
    </section>
  )
}
