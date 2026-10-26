'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import SiteHeader from '@/components/common/SiteHeader'
import StatusChip from '@/components/offline/StatusChip'
import DeliveryPanel from '@/components/offline/DeliveryPanel'
import ChannelSettings from '@/components/offline/ChannelSettings'
import Icon from '@/components/ui/Icon'
import { useOfflineReports } from '@/hooks/useOfflineReports'
import { api, shortId } from '@/lib/client'
import { STATUSES } from '@/lib/constants'
import { clearSynced, deleteAllUnsynced, deleteLocalReport, requestPersistence, storageInfo } from '@/lib/offline/store'
import type { LocalReport } from '@/lib/offline/types'
import type { DeliveryRecord } from '@/lib/delivery/types'

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '')
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(n > 10 * 1024 * 1024 ? 0 : 1)} MB`

// What the SERVER says about a synced report right now (never assumed from the local copy).
function ServerStatus({ id }: { id: string }) {
  const [text, setText] = useState('Checking…')
  useEffect(() => {
    let alive = true
    api.publicStatus(id).then((r) => alive && setText(`Server status: ${STATUSES[r.report.status] ?? r.report.status}`)).catch(() => alive && setText('Server status unavailable right now'))
    return () => { alive = false }
  }, [id])
  return <span className="text-sm font-semibold text-ink-700">{text}</span>
}

function Card({ r, photos, online, delivery, onRetry, onChanged }: { r: LocalReport; photos: number; online: boolean; delivery?: DeliveryRecord; onRetry: (id: string) => void; onChanged: () => void }) {
  const [confirm, setConfirm] = useState(false)
  const editable = !r.server_id && r.status !== 'synced' && r.status !== 'syncing'
  const title = String(r.form.locationAddress || '') || (r.status === 'draft' ? 'Draft report' : 'Emergency report')
  return (
    <li className="clay p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="font-display text-lg font-semibold">{title}</h3>
        <StatusChip report={r} delivery={delivery} />
      </div>
      <p className="mt-1 text-sm text-ink-600">
        {r.status === 'draft' ? 'Last edited' : 'Saved'} {when(r.status === 'draft' ? r.updated_at : r.queued_at ?? r.created_at)}
        {photos ? ` · ${photos} photo${photos > 1 ? 's' : ''}` : ''}
        {r.attempts > 0 && r.status !== 'synced' ? ` · ${r.attempts} attempt${r.attempts > 1 ? 's' : ''}` : ''}
      </p>
      {r.status === 'waiting' && r.next_attempt_at && <p className="mt-1 text-sm text-ink-600">Next automatic try after {when(r.next_attempt_at)}.</p>}
      {r.last_error && r.status !== 'synced' && <p className="field-error"><Icon name="alert" size={16} className="mt-0.5 shrink-0" /> {r.last_error}</p>}
      {r.status === 'synced' && r.server_id && (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <span className="text-sm">Reference <strong className="font-display tracking-widest">{shortId(r.server_id)}</strong> · received {when(r.synced_at)}</span>
          {online && <ServerStatus id={r.server_id} />}
          <Link href={`/report/${r.server_id}`} className="btn-ghost btn-sm">Status page</Link>
        </div>
      )}
      {r.status === 'draft' && <p className="mt-1 text-sm text-ink-600">Not sent. Open it to finish and send.</p>}
      {r.status !== 'draft' && !(r.server_id && r.status === 'synced') && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-bold">Delivery details and other ways to send</summary>
          <div className="mt-2"><DeliveryPanel report={r} delivery={delivery} onChanged={onChanged} /></div>
        </details>
      )}
      {r.status === 'needs_auth' && <Link href="/auth/login" className="btn-primary btn-sm mt-3"><Icon name="lock" size={16} /> Sign in to send</Link>}

      {!confirm ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {editable && <Link href={`/report?edit=${r.client_id}`} className="btn-ghost btn-sm"><Icon name="edit" size={16} /> {r.status === 'draft' ? 'Continue' : 'Edit'}</Link>}
          {['failed', 'waiting', 'saved_locally'].includes(r.status) && <button type="button" className="btn-primary btn-sm" onClick={() => onRetry(r.client_id)}><Icon name="refresh" size={16} /> Send now</button>}
          {r.status !== 'syncing' && <button type="button" className="btn-ghost btn-sm" onClick={() => setConfirm(true)}><Icon name="trash" size={16} /> {r.status === 'synced' ? 'Remove from this device' : 'Delete'}</button>}
        </div>
      ) : (
        <div className="mt-3 rounded-2xl border-2 border-critical-700 bg-critical-100 p-3.5" role="alertdialog" aria-label="Confirm delete">
          <p className="font-bold text-ink-900">
            {r.status === 'synced' ? 'Remove this copy from the device? The server keeps the report.' : 'Delete this report from the device? It has NOT been sent, and it cannot be recovered.'}
          </p>
          <div className="mt-2 flex gap-2">
            <button type="button" className="btn-primary btn-sm" onClick={() => void deleteLocalReport(r.client_id)}>Yes, delete</button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setConfirm(false)}>Keep it</button>
          </div>
        </div>
      )}
    </li>
  )
}

export default function SavedReportsPage() {
  const { supported, online, identity, reports, attachments, deliveries, stats, lastSyncAt, syncing, syncNow, retry, refresh } = useOfflineReports()
  const [confirmAll, setConfirmAll] = useState(false)
  const [info, setInfo] = useState<{ usage: number; quota: number; persisted: boolean | null } | null>(null)
  const [persistMsg, setPersistMsg] = useState('')
  useEffect(() => { void storageInfo().then(setInfo) }, [reports.length])

  const unsynced = reports.filter((r) => r.status !== 'synced')
  const photosOf = (id: string) => attachments.filter((a) => a.report_id === id).length

  return (
    <div className="page">
      <SiteHeader />
      <main id="main" className="container-x py-8 sm:py-12">
        <header className="rise max-w-2xl">
          <h1 className="text-4xl font-semibold sm:text-5xl">Reports on this device</h1>
          <p className="mt-3 text-lg text-ink-700">
            {identity?.userId ? `Showing reports saved while signed in as ${identity.email || 'your account'}.` : 'Showing reports saved while signed out.'} Reports saved under another account are hidden.
          </p>
        </header>

        {!supported && (
          <p className="clay mt-6 p-5 font-bold">This browser cannot keep reports on the device. Reports can only be sent while you are online.</p>
        )}

        <section className="rise rise-1 mt-6 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="space-y-4">
            <div className="clay p-4 sm:p-5">
              <p className="flex items-start gap-2 font-semibold"><Icon name={online ? 'info' : 'offline'} size={18} className="mt-0.5 shrink-0" />
                {online ? 'Internet reported.' : 'No internet.'} {stats.pendingReports ? `${stats.pendingReports} report${stats.pendingReports > 1 ? 's are' : ' is'} not confirmed delivered and ${stats.pendingImages} photo${stats.pendingImages === 1 ? ' is' : 's are'} still on this device.` : 'Nothing is waiting to be sent.'}
              </p>
              <p className="mt-1 text-sm text-ink-600">{lastSyncAt ? `Last successful sync: ${when(lastSyncAt)}` : 'No successful sync from this device yet.'}</p>
              <button type="button" className="btn-primary btn-sm mt-3" disabled={syncing || !(stats.pendingReports + stats.failedReports)} onClick={() => void syncNow(true)}>
                <Icon name="refresh" size={16} className={syncing ? 'animate-spin' : undefined} /> {syncing ? 'Trying every channel…' : 'Send everything now'}
              </button>
            </div>

            {reports.length === 0 ? (
              <p className="clay p-6 text-center text-ink-700">No reports on this device. <Link href="/report" className="font-bold underline">Write one</Link>.</p>
            ) : (
              <ul className="space-y-4">
                {reports.map((r) => <Card key={r.client_id} r={r} photos={photosOf(r.client_id)} online={online} delivery={deliveries[r.client_id]} onRetry={(id) => void retry(id)} onChanged={() => void refresh()} />)}
              </ul>
            )}
          </div>

          <aside className="space-y-4">
            <ChannelSettings />
            <div className="clay p-4 text-sm sm:p-5">
              <h2 className="font-display text-lg font-semibold">Keeping your data safe</h2>
              <ul className="mt-2 list-disc space-y-1.5 pl-5 text-ink-800">
                <li>Unsent reports exist <strong>only on this device</strong>. If you clear browser data, uninstall the app, or lose the phone, they are gone.</li>
                <li>Do not use a shared or public device for personal details. Sign out when you finish.</li>
                <li>A report is “received” only when a gateway or the server acknowledges it. Saved, queued, sent by SMS or transmitted by radio do not count. Even “received” is not the same as a responder seeing it.</li>
              </ul>
              {info && (
                <p className="mt-3 text-ink-700">
                  Storage used: {mb(info.usage)}{info.quota ? ` of about ${mb(info.quota)}` : ''}.{' '}
                  {info.persisted ? 'The browser promised to keep this data.' : 'The browser may delete this data if the device runs low on space.'}
                </p>
              )}
              {info && !info.persisted && (
                <button type="button" className="btn-ghost btn-sm mt-2" onClick={async () => { const ok = await requestPersistence(); setPersistMsg(ok ? 'Protected from automatic cleanup.' : 'The browser did not agree. Installing VYRA to your home screen often helps.'); setInfo(await storageInfo()) }}>
                  <Icon name="lock" size={16} /> Ask the browser to keep my data
                </button>
              )}
              {persistMsg && <p className="mt-2 font-semibold" role="status">{persistMsg}</p>}
            </div>

            <div className="clay p-4 text-sm sm:p-5">
              <h2 className="font-display text-lg font-semibold">Clear local data</h2>
              {reports.some((r) => r.status === 'synced') && (
                <button type="button" className="btn-ghost btn-sm mt-2" onClick={() => identity && void clearSynced(identity.owner)}>Remove received reports from this device</button>
              )}
              {!confirmAll ? (
                <button type="button" className="btn-ghost btn-sm mt-2" disabled={!unsynced.length} onClick={() => setConfirmAll(true)}><Icon name="trash" size={16} /> Delete all unsent reports</button>
              ) : (
                <div className="mt-2 rounded-2xl border-2 border-critical-700 bg-critical-100 p-3.5" role="alertdialog" aria-label="Confirm delete all unsent reports">
                  <p className="font-bold text-ink-900">Delete {unsynced.length} unsent report{unsynced.length > 1 ? 's' : ''} and their photos? They have NOT reached the server and cannot be recovered.</p>
                  <div className="mt-2 flex gap-2">
                    <button type="button" className="btn-primary btn-sm" onClick={async () => { if (identity) await deleteAllUnsynced(identity.owner); setConfirmAll(false) }}>Yes, delete them</button>
                    <button type="button" className="btn-ghost btn-sm" onClick={() => setConfirmAll(false)}>Keep them</button>
                  </div>
                </div>
              )}
            </div>
          </aside>
        </section>
      </main>
    </div>
  )
}
