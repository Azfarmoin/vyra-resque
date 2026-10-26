'use client'

import Icon, { type IconName } from '@/components/ui/Icon'
import { ORIGIN_LABELS, SEVERITY_LABELS, SEVERITY_MEANING, type Origin, type Severity } from '@/lib/alerts/types'

// Severity is shown by colour, icon AND word, never colour alone.
const SEV_ICON: Record<Severity, IconName> = { information: 'info', watch: 'eye', warning: 'alert', emergency: 'flame' }
export const SEV_STYLE: Record<Severity, string> = {
  information: 'bg-sand-200 text-ink-800',
  watch: 'bg-warning-100 text-warning-700',
  warning: 'bg-primary-100 text-primary-800',
  emergency: 'bg-critical-100 text-critical-700 ring-2 ring-critical',
}
export const SEV_COLOR: Record<Severity, string> = { information: '#8A9BA9', watch: '#E9B94D', warning: '#E2603D', emergency: '#C0392B' }

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span className={`pill !text-sm ${SEV_STYLE[severity]}`} title={SEVERITY_MEANING[severity]}>
      <Icon name={SEV_ICON[severity]} size={14} /> {SEVERITY_LABELS[severity]}
    </span>
  )
}

const ORIGIN_STYLE: Record<Origin, string> = {
  official: 'bg-success-100 text-success-800',
  observation: 'bg-success-50 text-success-800',
  manual: 'bg-primary-100 text-primary-800',
  internal_estimate: 'bg-warning-100 text-warning-700 border border-warning',
}
export function OriginBadge({ origin }: { origin: Origin }) {
  return <span className={`pill ${ORIGIN_STYLE[origin]}`}>{ORIGIN_LABELS[origin]}</span>
}

export const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'not stated')
