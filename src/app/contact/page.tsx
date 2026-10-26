'use client'

// Contact us: an in-app support form. The request is saved to VYRA's database and the person gets a
// reference ID on screen. Nothing is emailed.
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import SiteHeader from '@/components/common/SiteHeader'
import SiteFooter from '@/components/common/SiteFooter'
import Icon from '@/components/ui/Icon'
import { FieldError } from '@/components/auth/AuthShell'
import { useSession } from '@/lib/session'
import { supportHeaders } from '@/lib/supportClient'
import {
  SUPPORT_CATEGORIES, SUPPORT_LIMITS, SUPPORT_STATUSES, supportInputSchema,
  type SupportCategory, type SupportRequestRow,
} from '@/lib/support'

type Field = 'name' | 'email' | 'subject' | 'category' | 'message' | 'report_reference'
type Form = { name: string; email: string; subject: string; category: SupportCategory | ''; message: string; report_reference: string }
const EMPTY: Form = { name: '', email: '', subject: '', category: '', message: '', report_reference: '' }
const DRAFT_KEY = 'vyra.supportDraft.v1'
const FIELD_ORDER: Field[] = ['name', 'email', 'subject', 'category', 'message', 'report_reference']

const fmt = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export default function ContactPage() {
  const { user, ready } = useSession()
  const [form, setForm] = useState<Form>(EMPTY)
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({})
  const [banner, setBanner] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ reference: string; duplicate: boolean } | null>(null)
  const [trap, setTrap] = useState('') // honeypot: stays empty for people
  const [copied, setCopied] = useState(false)
  const [mine, setMine] = useState<SupportRequestRow[] | null>(null)
  const startedAt = useRef(Date.now())
  const sending = useRef(false) // blocks a second submit before React re-renders the disabled button
  const bannerRef = useRef<HTMLDivElement>(null)
  const doneRef = useRef<HTMLDivElement>(null)

  // Restore an unsent draft (survives a reload or a failed send), then fill name/email from the account.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY)
      if (raw) setForm({ ...EMPTY, ...JSON.parse(raw) })
    } catch { /* no storage: the form still works */ }
  }, [])
  useEffect(() => {
    if (user) setForm((f) => ({ ...f, name: f.name || user.full_name || '', email: f.email || user.email || '' }))
  }, [user])
  useEffect(() => {
    if (done) return
    try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(form)) } catch { /* ignore */ }
  }, [form, done])

  const loadMine = useCallback(async () => {
    if (!user) return setMine(null)
    try {
      const res = await fetch('/api/support?scope=mine', { headers: await supportHeaders(user), cache: 'no-store' })
      if (res.ok) setMine((await res.json()).requests)
    } catch { /* the list is a convenience; the form still works */ }
  }, [user])
  useEffect(() => { loadMine() }, [loadMine])

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value }))
    if (errors[k as Field]) setErrors((x) => ({ ...x, [k]: undefined }))
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (sending.current) return
    setBanner('')

    // Same rules as the server (shared schema), so messages match whichever side finds the problem.
    const parsed = supportInputSchema.safeParse(form)
    if (!parsed.success) {
      const errs: Partial<Record<Field, string>> = {}
      for (const i of parsed.error.issues) errs[i.path[0] as Field] ??= i.message
      setErrors(errs)
      const first = FIELD_ORDER.find((k) => errs[k])
      if (first) document.getElementById(`support-${first}`)?.focus()
      return
    }
    setErrors({})

    sending.current = true
    setBusy(true)
    try {
      const res = await fetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await supportHeaders(user)) },
        body: JSON.stringify({ ...form, website: trap, elapsed_ms: Date.now() - startedAt.current }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        // Field problems found by the server are shown next to the field; the message stays in the form.
        const fieldIssues: { path: string; message: string }[] = Array.isArray(body.details) ? body.details : []
        if (fieldIssues.length) {
          const errs: Partial<Record<Field, string>> = {}
          for (const i of fieldIssues) if (FIELD_ORDER.includes(i.path as Field)) errs[i.path as Field] ??= i.message
          setErrors(errs)
        }
        throw new Error(body.error && body.error !== 'Validation failed' ? body.error : 'Please check the highlighted fields and try again.')
      }
      try { sessionStorage.removeItem(DRAFT_KEY) } catch { /* ignore */ }
      setDone({ reference: body.reference, duplicate: !!body.duplicate })
      setForm({ ...EMPTY, name: user?.full_name ?? '', email: user?.email ?? '' })
      loadMine()
      setTimeout(() => doneRef.current?.focus(), 0)
    } catch (err) {
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false
      setBanner(
        err instanceof TypeError || offline
          ? 'Could not reach VYRA. Check your connection and try again. Your message is still here.'
          : `${(err as Error).message} Your message is still here.`,
      )
      setTimeout(() => bannerRef.current?.focus(), 0)
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  const copy = async () => {
    if (!done) return
    try {
      await navigator.clipboard.writeText(done.reference)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard blocked: the reference is on screen to copy by hand */ }
  }

  const remaining = SUPPORT_LIMITS.message.max - form.message.length

  return (
    <div className="page">
      <SiteHeader />
      <main id="main" className="container-x py-8 sm:py-12">
        <header className="rise max-w-2xl">
          <h1 className="text-4xl font-semibold sm:text-5xl">Contact us</h1>
          <p className="mt-3 text-lg text-ink-700">Send a message to VYRA support. It is saved in VYRA and you get a reference ID straight away. We do not send emails.</p>
        </header>

        <div className="rise rise-1 mt-6 max-w-3xl rounded-2xl border-2 border-critical-700 bg-critical-100 p-4 text-[15px]" role="note">
          <p className="flex items-start gap-2 font-bold">
            <Icon name="alert" size={18} className="mt-0.5 shrink-0" />
            <span>This form is not for emergencies and is not read in real time. If someone is in danger, call the emergency number for your area and <Link href="/report" className="underline underline-offset-2">send an emergency report</Link>.</span>
          </p>
        </div>

        <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
          <div>
            {done && (
              <div ref={doneRef} tabIndex={-1} role="status" className="clay mb-6 border-2 border-success-700 p-6 outline-none" style={{ borderRadius: 28 }}>
                <p className="flex items-center gap-2 text-xl font-bold text-success-800"><Icon name="check" size={22} /> {done.duplicate ? 'We already have this request' : 'Your request was saved'}</p>
                <p className="mt-3 text-sm font-bold text-ink-600">Support reference ID</p>
                <p className="font-display text-4xl font-semibold tracking-[0.08em]">{done.reference}</p>
                <p className="mt-2 text-ink-700">
                  {done.duplicate
                    ? 'You sent this same message a moment ago, so no second copy was saved.'
                    : 'Keep this ID and quote it if you contact support again.'}{' '}
                  Administrators read requests inside VYRA{user ? '; you can follow the status under “Your requests”.' : '. Without an account you cannot look it up here later, so note the ID down.'}
                </p>
                <div className="mt-4 flex flex-wrap gap-3">
                  <button type="button" className="btn-ghost btn-sm" onClick={copy}>{copied ? 'Copied' : 'Copy ID'}</button>
                  <button type="button" className="btn-ghost btn-sm" onClick={() => { setDone(null); startedAt.current = Date.now() }}>Send another message</button>
                </div>
              </div>
            )}

            {!done && (
              <form onSubmit={submit} noValidate className="clay space-y-5 p-5 sm:p-7" style={{ borderRadius: 28 }} aria-label="Support request">
                {banner && (
                  <div ref={bannerRef} tabIndex={-1} role="alert" className="flex items-start gap-2 rounded-2xl border-2 border-critical-700 bg-critical-100 p-3.5 text-[15px] font-bold outline-none">
                    <Icon name="alert" size={18} className="mt-0.5 shrink-0" /> {banner}
                  </div>
                )}

                <div className="grid gap-5 sm:grid-cols-2">
                  <div>
                    <label htmlFor="support-name" className="label">Name</label>
                    <input id="support-name" className="input" autoComplete="name" maxLength={SUPPORT_LIMITS.name.max} value={form.name} onChange={set('name')} aria-invalid={!!errors.name} aria-describedby={errors.name ? 'support-name-error' : undefined} />
                    <FieldError id="support-name-error">{errors.name}</FieldError>
                  </div>
                  <div>
                    <label htmlFor="support-email" className="label">Email <span className="font-normal text-ink-600">(optional)</span></label>
                    <input id="support-email" type="email" className="input" autoComplete="email" maxLength={SUPPORT_LIMITS.email.max} value={form.email} onChange={set('email')} aria-invalid={!!errors.email} aria-describedby={`support-email-hint${errors.email ? ' support-email-error' : ''}`} />
                    <p id="support-email-hint" className="hint mt-1.5">For reference only. VYRA does not send email.</p>
                    <FieldError id="support-email-error">{errors.email}</FieldError>
                  </div>
                </div>

                <div className="grid gap-5 sm:grid-cols-[1fr_minmax(0,14rem)]">
                  <div>
                    <label htmlFor="support-subject" className="label">Subject</label>
                    <input id="support-subject" className="input" maxLength={SUPPORT_LIMITS.subject.max} value={form.subject} onChange={set('subject')} aria-invalid={!!errors.subject} aria-describedby={errors.subject ? 'support-subject-error' : undefined} />
                    <FieldError id="support-subject-error">{errors.subject}</FieldError>
                  </div>
                  <div>
                    <label htmlFor="support-category" className="label">Category</label>
                    <select id="support-category" className="input" value={form.category} onChange={set('category')} aria-invalid={!!errors.category} aria-describedby={errors.category ? 'support-category-error' : undefined}>
                      <option value="">Choose one…</option>
                      {Object.entries(SUPPORT_CATEGORIES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                    <FieldError id="support-category-error">{errors.category}</FieldError>
                  </div>
                </div>

                <div>
                  <label htmlFor="support-message" className="label">Message</label>
                  <textarea id="support-message" rows={7} className="input resize-y" maxLength={SUPPORT_LIMITS.message.max} value={form.message} onChange={set('message')} aria-invalid={!!errors.message} aria-describedby={`support-message-hint${errors.message ? ' support-message-error' : ''}`} />
                  <p id="support-message-hint" className="hint mt-1.5 flex justify-between gap-3">
                    <span>Say what happened and what you expected. Do not include passwords.</span>
                    <span className={remaining < 100 ? 'font-bold' : ''} aria-label={`${remaining} characters left`}>{remaining}</span>
                  </p>
                  <FieldError id="support-message-error">{errors.message}</FieldError>
                </div>

                <div>
                  <label htmlFor="support-report_reference" className="label">Emergency report reference <span className="font-normal text-ink-600">(optional)</span></label>
                  <input id="support-report_reference" className="input font-mono uppercase" placeholder="e.g. 3F9A1C" maxLength={SUPPORT_LIMITS.reportReference.max} value={form.report_reference} onChange={set('report_reference')} aria-invalid={!!errors.report_reference} aria-describedby={`support-ref-hint${errors.report_reference ? ' support-report_reference-error' : ''}`} />
                  <p id="support-ref-hint" className="hint mt-1.5">The reference number shown on your report’s status page.</p>
                  <FieldError id="support-report_reference-error">{errors.report_reference}</FieldError>
                </div>

                {/* Honeypot: hidden from people and assistive technology, tempting to scripts. */}
                <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
                  <label>Leave this empty<input tabIndex={-1} autoComplete="off" value={trap} onChange={(e) => setTrap(e.target.value)} name="website" /></label>
                </div>

                <button type="submit" disabled={busy} className="btn-primary w-full py-3.5 text-base" aria-busy={busy}>
                  {busy ? 'Sending…' : 'Send to support'}
                </button>
                <p className="text-center text-xs text-ink-600">Your message is saved in VYRA and read by administrators. Do not use this form for emergencies.</p>
              </form>
            )}
          </div>

          <aside className="space-y-6" aria-label="Support help">
            <section className="clay p-5" style={{ borderRadius: 24 }} aria-labelledby="your-requests">
              <h2 id="your-requests" className="text-xl font-semibold">Your requests</h2>
              {!ready ? (
                <p className="mt-2 text-sm text-ink-700" role="status">Loading…</p>
              ) : !user ? (
                <p className="mt-2 text-sm text-ink-700"><Link href="/auth/login" className="font-bold underline underline-offset-2">Sign in</Link> to see your support requests and their status. You can still send a message without signing in.</p>
              ) : mine === null ? (
                <p className="mt-2 text-sm text-ink-700" role="status">Loading…</p>
              ) : mine.length === 0 ? (
                <p className="mt-2 text-sm text-ink-700">You have not sent a support request yet.</p>
              ) : (
                <ul className="mt-3 space-y-2.5">
                  {mine.map((r) => (
                    <li key={r.id} className="clay-inset p-3 text-sm">
                      <p className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-mono font-bold">{r.reference}</span>
                        <span className={`pill ${r.status === 'resolved' ? 'bg-success-100 text-success-800' : r.status === 'in_progress' ? 'bg-warning-100 text-warning-700' : 'bg-sand-200 text-ink-700'}`}>{SUPPORT_STATUSES[r.status]}</span>
                      </p>
                      <p className="mt-1 truncate font-semibold">{r.subject}</p>
                      <p className="text-xs text-ink-600">{SUPPORT_CATEGORIES[r.category]} · {fmt(r.created_at)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="clay p-5" style={{ borderRadius: 24 }} aria-labelledby="before-you-write">
              <h2 id="before-you-write" className="text-xl font-semibold">Before you write</h2>
              <ul className="mt-2 space-y-2 text-sm">
                <li><Link href="/faq" className="font-bold underline underline-offset-2">Read the FAQ</Link> for quick answers.</li>
                <li><Link href="/precautions" className="font-bold underline underline-offset-2">Emergency precautions</Link> for safety guidance and verified numbers.</li>
                <li><Link href="/report" className="font-bold underline underline-offset-2">Report an emergency</Link> if you need help now.</li>
              </ul>
            </section>
          </aside>
        </div>
      </main>
      <SiteFooter />
    </div>
  )
}
