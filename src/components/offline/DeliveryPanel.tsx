'use client'

import { useEffect, useState } from 'react'
import Icon, { type IconName } from '@/components/ui/Icon'
import { useDeliveryConfig } from '@/hooks/useDeliveryConfig'
import { smsUri } from '@/lib/delivery/adapters/sms'
import { encodeCompact, incidentRef } from '@/lib/delivery/compact'
import { buildExportFile, copyText, downloadBlob, qrDataUrl } from '@/lib/delivery/manualTransfer'
import { deliverReport, markSmsHandedOff } from '@/lib/delivery/orchestrator'
import { deliveryView } from '@/lib/delivery/status'
import { CHANNEL_LABEL, type ChannelId, type ChannelState, type DeliveryRecord } from '@/lib/delivery/types'
import { retryReport } from '@/lib/offline/store'
import type { LocalReport } from '@/lib/offline/types'

const ICON: Record<ChannelId, IconName> = { radio: 'radio', sms: 'message', bluetooth: 'bluetooth', internet: 'globe', manual: 'qr' }
const STATE_TEXT: Record<ChannelState, string> = {
  idle: 'Not tried yet',
  unavailable: 'Unavailable',
  needs_user_action: 'Waiting for you',
  pending_ack: 'Sent — NOT confirmed delivered',
  failed: 'Failed',
  acked: 'Acknowledged',
}
const STATE_CLS: Record<ChannelState, string> = {
  idle: 'text-ink-600', unavailable: 'text-ink-600', needs_user_action: 'text-warning-700', pending_ack: 'text-warning-700', failed: 'text-critical-700', acked: 'text-success-800',
}

// Everything about how ONE report is being delivered: the truth about its state, every channel, and the manual options.
export default function DeliveryPanel({ report, delivery, onChanged }: { report: LocalReport; delivery?: DeliveryRecord | null; onChanged?: () => void }) {
  const { config } = useDeliveryConfig()
  const view = deliveryView(report, delivery)
  const [busy, setBusy] = useState(false)
  const [qr, setQr] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [withPhotos, setWithPhotos] = useState(true)

  const compact = delivery?.compact ?? (report.payload ? encodeCompact({ ...(report.payload as Record<string, unknown>), client_id: report.client_id } as never).text : '')
  const onServer = !!report.server_id
  const canSms = !onServer && config.enabled.sms && !!config.smsNumber
  useEffect(() => { setQr(null) }, [compact])

  if (!view || !report.payload) return null

  const sendNow = async () => {
    setBusy(true)
    setNote('')
    try {
      if (report.status !== 'synced') await retryReport(report.client_id)
      await deliverReport(report.client_id, { force: true, userGesture: true })
    } finally {
      setBusy(false)
      onChanged?.()
    }
  }
  // Must run inside the tap: browsers only open the messaging app for a real user action.
  const sendSms = () => {
    window.location.href = smsUri(config.smsNumber, compact)
    void markSmsHandedOff(report.client_id).then(() => onChanged?.())
  }
  const showQr = async () => setQr(qr ? null : await qrDataUrl(compact))
  const exportFile = async () => {
    const f = await buildExportFile(report, compact, withPhotos)
    downloadBlob(f.blob, f.filename)
    setNote(`Saved ${f.filename}${f.photos ? ` with ${f.photos} photo${f.photos > 1 ? 's' : ''}` : ''}. Give it to a rescue operator or a gateway. This does not deliver it by itself.`)
  }
  const copy = async () => setNote((await copyText(compact)) ? 'Message copied. Paste it into any messaging app or read it out over a radio.' : 'Could not copy. Select the message above and copy it by hand.')

  const toneCls = view.tone === 'bad' ? 'border-critical-700 bg-critical-100' : view.delivered ? 'border-success-700 bg-success-100' : 'border-warning-700 bg-warning-100'

  return (
    <section className="space-y-3 text-sm" aria-label="Delivery details" data-testid="delivery-panel">
      <div className={`rounded-2xl border-2 p-3 ${toneCls}`} role="status">
        <p className="font-bold text-ink-900">{view.label}</p>
        <p className="mt-0.5 text-ink-800">{view.detail}</p>
        {!view.delivered && <p className="mt-1 font-bold text-ink-900">This report has NOT been confirmed delivered. If a life is in danger and a phone call works, call for help.</p>}
      </div>

      <ul className="space-y-1.5">
        {config.order.filter((c) => config.enabled[c]).map((c) => {
          const s = delivery?.channels?.[c]
          const state: ChannelState = s?.state ?? 'idle'
          return (
            <li key={c} className="clay-inset flex items-start gap-2 p-2.5">
              <Icon name={ICON[c]} size={18} className="mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="font-bold">{CHANNEL_LABEL[c]} <span className={`font-semibold ${STATE_CLS[state]}`}>· {STATE_TEXT[state]}</span></p>
                {s?.reason && <p className="text-ink-700">{s.reason}</p>}
              </div>
            </li>
          )
        })}
      </ul>

      {!onServer && compact && (
        <div className="clay-inset p-2.5">
          <p className="font-bold">Short emergency message <span className="font-normal text-ink-600">({compact.length} characters · {incidentRef(report.client_id)})</span></p>
          <code className="mt-1 block break-all text-xs text-ink-800" data-testid="compact-message">{compact}</code>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {report.status !== 'synced' && (
          <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={() => void sendNow()}>
            <Icon name="refresh" size={16} className={busy ? 'animate-spin' : undefined} /> {busy ? 'Trying every channel…' : 'Send now'}
          </button>
        )}
        {canSms && (
          <button type="button" className="btn-ghost btn-sm" onClick={sendSms}>
            <Icon name="message" size={16} /> Send via SMS
          </button>
        )}
        {!onServer && config.enabled.sms && !config.smsNumber && <p className="w-full text-ink-700">SMS needs the gateway number: add it under “Delivery channels”.</p>}
        {!onServer && config.enabled.manual && (
          <>
            <button type="button" className="btn-ghost btn-sm" onClick={() => void showQr()}><Icon name="qr" size={16} /> {qr ? 'Hide QR code' : 'Show QR code'}</button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => void exportFile()}><Icon name="download" size={16} /> Export file</button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => void copy()}><Icon name="copy" size={16} /> Copy message</button>
            <label className="flex items-center gap-1.5 text-ink-700"><input type="checkbox" checked={withPhotos} onChange={(e) => setWithPhotos(e.target.checked)} /> Include photos in the file</label>
          </>
        )}
      </div>
      {qr && (
        <div className="clay-inset flex flex-col items-center gap-1 p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="QR code of the short emergency message" width={240} height={240} />
          <p className="text-center text-ink-700">An operator can scan this with the VYRA gateway. It carries the short message only, not photos.</p>
        </div>
      )}
      {note && <p className="font-semibold" role="status">{note}</p>}
      {delivery && delivery.attempts.length > 0 && (
        <details>
          <summary className="cursor-pointer font-bold">Delivery attempts ({delivery.attempts.length})</summary>
          <ul className="mt-1 space-y-1 text-xs text-ink-700">
            {[...delivery.attempts].reverse().map((a, i) => (
              <li key={i}>{new Date(a.at).toLocaleTimeString([], { timeStyle: 'medium' })} · {CHANNEL_LABEL[a.channel]} · <strong>{a.outcome.replace('_', ' ')}</strong> · {a.detail}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
