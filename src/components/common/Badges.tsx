import { PRIORITY_LABELS, STATUSES, type Priority, type Status } from '@/lib/constants'
import { PRIORITY_STYLES, STATUS_STYLES } from '@/lib/client'
<<<<<<< HEAD
import Icon, { type IconName } from '@/components/ui/Icon'

// Urgency is encoded three ways: colour, a distinct shape and the word itself.
const PRIORITY_ICON: Record<Priority, IconName> = { critical: 'alert', high: 'flame', medium: 'clock', low: 'check' }

export function PriorityBadge({ priority, small = false }: { priority: Priority; small?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full font-extrabold ${PRIORITY_STYLES[priority].badge} ${small ? 'px-2.5 py-0.5 text-xs' : 'px-3.5 py-1.5 text-sm'}`}>
      <Icon name={PRIORITY_ICON[priority]} size={small ? 13 : 16} />
=======

export function PriorityBadge({ priority, small = false }: { priority: Priority; small?: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-md font-bold uppercase tracking-wide ${PRIORITY_STYLES[priority].badge} ${
        small ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-xs'
      }`}
    >
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
      {PRIORITY_LABELS[priority]}
    </span>
  )
}

export function StatusBadge({ status }: { status: Status }) {
<<<<<<< HEAD
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ${STATUS_STYLES[status]}`}>{STATUSES[status]}</span>
=======
  return <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}>{STATUSES[status]}</span>
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
}

export function VerifiedBadge({ verified }: { verified: boolean }) {
  return verified ? (
<<<<<<< HEAD
    <span className="pill bg-success-100 text-success-800"><Icon name="shield" size={13} /> Verified</span>
  ) : (
    <span className="pill bg-warning-100 text-warning-700"><Icon name="info" size={13} /> Not verified yet</span>
=======
    <span className="inline-flex rounded-md bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 ring-1 ring-green-200">Verified</span>
  ) : (
    <span className="inline-flex rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-amber-200">Unverified</span>
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
  )
}

export function UpdatedDot({ at, error }: { at: Date | null; error?: Error | null }) {
  return (
<<<<<<< HEAD
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-600" title="Refreshes every 15 seconds" role="status">
      <span className={`h-2.5 w-2.5 rounded-full ${error ? 'bg-critical' : 'bg-success'}`} />
=======
    <span className="inline-flex items-center gap-1.5 text-xs text-gray-500" title="Refreshes every 15 seconds">
      <span className={`h-2 w-2 rounded-full ${error ? 'bg-red-500' : 'animate-pulse bg-green-500'}`} />
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
      {error ? 'Connection problem' : at ? `Updated ${at.toLocaleTimeString([], { timeStyle: 'short' })}` : 'Loading...'}
    </span>
  )
}

export function DemoModeBanner({ mode }: { mode?: string }) {
  if (mode !== 'demo') return null
  return (
<<<<<<< HEAD
    <div className="mx-auto mt-3 max-w-7xl px-3 sm:px-5">
      <p className="rounded-2xl bg-warning-100 px-4 py-2 text-center text-sm font-semibold text-ink-900" role="note">
        Demo mode: you are seeing simulated cases kept in memory. Nothing is saved to the database.
      </p>
=======
    <div className="bg-amber-100 px-4 py-1.5 text-center text-xs text-amber-900">
      Demo mode: simulated data held in memory (VYRA_DATA_MODE=demo). Nothing is saved to Supabase.
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
    </div>
  )
}
