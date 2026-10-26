import Icon, { type IconName } from '@/components/ui/Icon'
import { deliveryView, type Tone } from '@/lib/delivery/status'
import type { DeliveryRecord } from '@/lib/delivery/types'
import { STATUS_LABEL, type LocalReport, type LocalStatus } from '@/lib/offline/types'

const STYLE: Record<LocalStatus, { cls: string; icon: IconName }> = {
  draft: { cls: 'bg-sand-200 text-ink-800', icon: 'edit' },
  saved_locally: { cls: 'bg-warning-100 text-warning-700', icon: 'save' },
  waiting: { cls: 'bg-warning-100 text-warning-700', icon: 'clock' },
  syncing: { cls: 'bg-primary-100 text-primary-800', icon: 'refresh' },
  synced: { cls: 'bg-success-100 text-success-800', icon: 'check' },
  failed: { cls: 'bg-critical-100 text-critical-700', icon: 'alert' },
  needs_auth: { cls: 'bg-warning-100 text-warning-700', icon: 'lock' },
}

const TONE: Record<Tone, { cls: string; icon: IconName }> = {
  neutral: { cls: 'bg-warning-100 text-warning-700', icon: 'save' },
  progress: { cls: 'bg-primary-100 text-primary-800', icon: 'refresh' },
  ok: { cls: 'bg-success-100 text-success-800', icon: 'check' },
  warn: { cls: 'bg-warning-100 text-warning-700', icon: 'clock' },
  bad: { cls: 'bg-critical-100 text-critical-700', icon: 'alert' },
}

/** Label with more precision than the status alone: "received, but photos failed" is not "failed". */
export function statusLabel(r: Pick<LocalReport, 'status' | 'server_id'>): string {
  if (r.status === 'failed' && r.server_id) return 'Received by server, photo failed — retry available'
  if (r.status === 'syncing' && r.server_id) return 'Received by server, uploading photos'
  if (r.status === 'waiting' && r.server_id) return 'Received by server, photos waiting'
  return STATUS_LABEL[r.status]
}

type ChipReport = Pick<LocalReport, 'status' | 'server_id'> & Partial<Pick<LocalReport, 'last_error' | 'server_ingest_channel'>>

// Shows the delivery stage (Saved on Device / Sending via ... / Received by Gateway / ...). "Received" and
// "Acknowledged" appear ONLY when a verified acknowledgement exists; saving or sending alone never shows them.
export default function StatusChip({ report, delivery }: { report: ChipReport; delivery?: DeliveryRecord | null }) {
  const view = deliveryView({ last_error: null, ...report }, delivery)
  if (!view) {
    const { cls, icon } = STYLE[report.status]
    return (
      <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${cls}`}>
        <Icon name={icon} size={14} />
        {statusLabel(report)}
      </span>
    )
  }
  const { cls, icon } = TONE[view.tone]
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${cls}`} data-testid="delivery-chip" data-stage={view.stage}>
      <Icon name={icon} size={14} className={view.tone === 'progress' ? 'animate-spin' : undefined} />
      {view.label}
    </span>
  )
}
