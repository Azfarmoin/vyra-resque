import Icon from '@/components/ui/Icon'
import type { Status } from '@/lib/constants'

const STEPS = [
  { key: 'pending', label: 'Received', text: 'Your report is in the queue.' },
  { key: 'investigating', label: 'Under review', text: 'A responder is checking the details.' },
  { key: 'assigned', label: 'Team assigned', text: 'A rescue team has been sent.' },
  { key: 'resolved', label: 'Resolved', text: 'The case is closed.' },
] as const

// Progress is shown by position, a check mark and text, so it never depends on colour alone.
export default function StatusTrack({ status }: { status: Status }) {
  if (status === 'cancelled') {
    return (
      <p className="clay-inset flex items-start gap-2 p-4 font-semibold" role="status">
        <Icon name="info" size={20} className="mt-0.5 shrink-0" />
        This report was cancelled. If you still need help, send a new report.
      </p>
    )
  }
  const current = STEPS.findIndex((s) => s.key === status)
  return (
    <ol className="grid gap-4 sm:grid-cols-4 sm:gap-2" aria-label="Report progress">
      {STEPS.map((s, i) => {
        const done = i < current || status === 'resolved'
        const isCurrent = i === current && status !== 'resolved'
        return (
          <li key={s.key} aria-current={isCurrent ? 'step' : undefined} className="relative flex gap-3 sm:block">
            {i < STEPS.length - 1 && (
              <span
                className={`absolute left-[19px] top-10 h-[calc(100%-1rem)] w-1 rounded-full sm:left-12 sm:top-[19px] sm:h-1 sm:w-[calc(100%-3rem)] ${i < current || status === 'resolved' ? 'bg-success-700' : 'bg-sand-300'}`}
                aria-hidden="true"
              />
            )}
            <span
              className={`status-fill relative z-[1] flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-4 border-sand-100 font-display text-lg font-semibold ${
                done ? 'bg-success-700 text-white' : isCurrent ? 'cta-ring bg-primary-500 text-ink-900' : 'bg-sand-300 text-ink-700'
              }`}
            >
              {done ? <Icon name="check" size={20} /> : i + 1}
            </span>
            <span className="block sm:mt-3">
              <span className="block font-bold">
                {s.label}
                {done && <span className="sr-only"> (done)</span>}
                {isCurrent && <span className="sr-only"> (current step)</span>}
              </span>
              <span className="block text-sm text-ink-700">{s.text}</span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}
