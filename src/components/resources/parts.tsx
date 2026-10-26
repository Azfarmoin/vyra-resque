'use client'

import { useRef } from 'react'
import Icon from '@/components/ui/Icon'
import { useDialog } from '@/components/ui/useDialog'

// Every status is a word first; colour only reinforces it.
export function statusPill(status: string) {
  switch (status) {
    case 'available':
    case 'open':
      return 'bg-success-100 text-success-800'
    case 'assigned':
      return 'bg-primary-100 text-primary-800'
    case 'in_use':
      return 'bg-warning-100 text-warning-700'
    case 'maintenance':
    case 'unavailable':
    case 'full':
      return 'bg-critical-100 text-critical-700'
    default:
      return 'bg-sand-200 text-ink-700'
  }
}

export function StatusPill({ status }: { status: string }) {
  return <span className={`pill ${statusPill(status)}`}>{status.replace(/_/g, ' ')}</span>
}

/** Stock bar: available / in use / out of service, with the numbers in text beside it. */
export function StockBar({ available, inUse, other, total }: { available: number; inUse: number; other: number; total: number }) {
  const pct = (n: number) => (total ? (n / total) * 100 : 0)
  return (
    <div>
      <div className="flex h-3.5 gap-0.5 overflow-hidden rounded-full bg-sand-200" role="img" aria-label={`${available} available, ${inUse} in use, ${other} out of service, ${total} in total`}>
        <span className="status-fill bg-success-700" style={{ width: `${pct(available)}%` }} />
        <span className="status-fill bg-warning" style={{ width: `${pct(inUse)}%` }} />
        <span className="status-fill bg-critical" style={{ width: `${pct(other)}%` }} />
      </div>
      <p className="mt-1.5 text-sm font-semibold text-ink-700">
        <span className="text-ink-900">{available} available</span> of {total}
        {inUse > 0 && ` · ${inUse} in use`}
        {other > 0 && ` · ${other} out of service`}
      </p>
    </div>
  )
}

export function Dialog({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useDialog(ref, onClose)
  return (
    <div className="fixed inset-0 z-[2000] flex items-end justify-center bg-ink-900/55 sm:items-center sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        tabIndex={-1}
        className={`clay max-h-[92vh] w-full overflow-y-auto p-5 outline-none sm:p-7 ${wide ? 'max-w-2xl' : 'max-w-lg'}`}
        style={{ borderRadius: 32 }}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 id="dialog-title" className="text-2xl font-semibold sm:text-3xl">{title}</h2>
          <button type="button" onClick={onClose} className="btn-ghost btn-sm !px-2.5" aria-label="Close"><Icon name="close" size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <p className="hint mt-1">{hint}</p>}
    </div>
  )
}
