'use client'

import Link from 'next/link'
import { useOfflineReports } from '@/hooks/useOfflineReports'
import StatusChip from '@/components/offline/StatusChip'
import DeliveryPanel from '@/components/offline/DeliveryPanel'
import { deliveryView } from '@/lib/delivery/status'
import Icon from '@/components/ui/Icon'
import { shortId } from '@/lib/client'

// Shown right after "Send". It follows the real state of the report and only claims what is true:
// "saved on this device" until the server has actually confirmed it.
export default function SavedConfirmation({ clientId, onAnother }: { clientId: string; onAnother: () => void }) {
  const { reports, deliveries, refresh } = useOfflineReports()
  const report = reports.find((r) => r.client_id === clientId)
  const delivery = deliveries[clientId]

  if (!report) {
    return <div className="clay mx-auto max-w-2xl p-8 text-center" role="status">Checking this device…</div>
  }
  const onServer = report.status === 'synced' && report.server_id
  const view = deliveryView(report, delivery)
  const acknowledged = !!view?.delivered
  return (
    <section className="clay mx-auto max-w-2xl space-y-4 p-6 sm:p-8" aria-live="polite">
      <div className="flex items-start gap-3">
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white ${onServer ? 'bg-success-700' : 'bg-ink-900'}`}>
          <Icon name={onServer ? 'check' : 'save'} size={22} />
        </span>
        <div>
          <h1 className="text-2xl font-semibold sm:text-3xl">
            {onServer ? 'Received by the VYRA server' : acknowledged ? 'Received — a gateway confirmed it' : report.status === 'needs_auth' ? 'Saved on this device — not delivered yet' : view?.stage === 'failed_retry' ? 'Saved on this device — NOT delivered yet' : 'Saved on this device — delivery in progress'}
          </h1>
          <div className="mt-2"><StatusChip report={report} delivery={delivery} /></div>
        </div>
      </div>

      {onServer ? (
        <>
          <p className="text-[15px]">
            The server has your report. Reference number: <strong className="font-display text-xl tracking-widest">{shortId(report.server_id!)}</strong>.
            This does not mean a responder has seen it yet. Check its status on the status page.
          </p>
          <Link href={`/report/${report.server_id}?sent=1`} className="btn-primary">Open status page <Icon name="arrow" size={18} /></Link>
        </>
      ) : (
        <>
          <DeliveryPanel report={report} delivery={delivery} onChanged={() => void refresh()} />
          {report.last_error && report.status === 'failed' && <p className="field-error"><Icon name="alert" size={16} className="mt-0.5 shrink-0" /> {report.last_error}</p>}
          <p className="flex items-start gap-2 rounded-2xl bg-warning-100 p-3.5 text-sm font-semibold">
            <Icon name="phone" size={18} className="mt-0.5 shrink-0" /> If a life is in danger and phones work, call Rescue 1122. A saved report does not alert anyone by itself.
          </p>
          <div className="flex flex-wrap gap-3">
            {report.status === 'needs_auth' && <Link href="/auth/login" className="btn-primary"><Icon name="lock" size={18} /> Sign in to also send over the internet</Link>}
            <Link href="/report/saved" className="btn-ghost"><Icon name="list" size={18} /> Reports on this device</Link>
          </div>
        </>
      )}
      <button type="button" className="btn-ghost btn-sm" onClick={onAnother}>Write another report</button>
    </section>
  )
}
