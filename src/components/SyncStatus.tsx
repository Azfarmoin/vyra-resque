'use client'

<<<<<<< HEAD
import { useState } from 'react'
import Link from 'next/link'
import { useOfflineReports } from '@/hooks/useOfflineReports'
import StatusChip from '@/components/offline/StatusChip'
import Icon from '@/components/ui/Icon'

// Floating connection + sync indicator. Always says plainly whether reports are only on this device.
export default function SyncStatus() {
  const { supported, online, reports, deliveries, stats, syncing, lastSyncAt, syncNow } = useOfflineReports()
  const [open, setOpen] = useState(false)
  if (!supported) return null

  const waiting = stats.pendingReports + stats.failedReports
  const idle = online && !syncing && !waiting
  const summary = !online
    ? `No internet${stats.pendingReports ? ` · ${stats.pendingReports} saved, trying other channels` : ''}`
    : syncing
      ? 'Syncing…'
      : stats.failedReports
        ? `${stats.failedReports} report${stats.failedReports > 1 ? 's' : ''} need attention`
        : stats.needsAuth
          ? `${stats.needsAuth} waiting for sign-in`
          : stats.pendingReports
            ? `${stats.pendingReports} not yet delivered`
            : 'Online · nothing waiting'
  const recent = reports.filter((r) => r.status !== 'draft').slice(0, 3)

  return (
    <div
      className={`fixed bottom-24 right-3 z-[1000] flex-col items-end gap-2 sm:bottom-4 sm:right-4 ${idle && !open ? 'hidden sm:flex' : 'flex'}`}
      data-testid="sync-status"
    >
      {open && (
        <section className="clay max-h-[65vh] w-[min(22rem,calc(100vw-1.5rem))] overflow-y-auto p-4 text-sm" aria-label="Offline reports">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold">Reports on this device</h2>
            <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-1 text-ink-600 hover:bg-sand-200" aria-label="Close">
              <Icon name="close" size={18} />
            </button>
          </div>
          <p className="mb-3 flex items-start gap-2 text-ink-800" role="status">
            <Icon name={online ? 'info' : 'offline'} size={16} className="mt-0.5 shrink-0" />
            {online
              ? 'Connected. Saved reports are sent automatically over every available channel. A report only counts as received once a gateway or the server acknowledges it.'
              : 'No internet. Reports are saved on this device, then VYRA tries radio, SMS, Bluetooth and any other connection that works. Nothing counts as delivered until it is acknowledged.'}
          </p>
          <dl className="mb-3 grid grid-cols-2 gap-2 text-xs">
            <div className="clay-inset p-2.5"><dt className="font-bold text-ink-600">Reports waiting</dt><dd className="text-xl font-extrabold tabular-nums">{stats.pendingReports}</dd></div>
            <div className="clay-inset p-2.5"><dt className="font-bold text-ink-600">Photos waiting</dt><dd className="text-xl font-extrabold tabular-nums">{stats.pendingImages}</dd></div>
          </dl>
          <p className="mb-3 text-xs text-ink-600">
            {lastSyncAt ? `Last successful sync: ${new Date(lastSyncAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}` : 'Nothing has been synced from this device yet.'}
          </p>
          <div className="mb-3 flex gap-2">
            <button type="button" onClick={() => void syncNow(true)} disabled={syncing || !waiting} className="btn-primary btn-sm flex-1">
              <Icon name="refresh" size={16} className={syncing ? 'animate-spin' : undefined} /> {syncing ? 'Syncing…' : 'Sync now'}
            </button>
            <Link href="/report/saved" className="btn-ghost btn-sm" onClick={() => setOpen(false)}>
              <Icon name="list" size={16} /> All
            </Link>
          </div>
          {recent.length === 0 ? (
            <p className="py-1 text-center text-ink-600">No reports on this device.</p>
          ) : (
            <ul className="space-y-2">
              {recent.map((r) => (
                <li key={r.client_id} className="clay-inset p-2.5">
                  <p className="truncate font-bold">{String(r.form.locationAddress || '') || 'Report'}</p>
                  <div className="mt-1"><StatusChip report={r} delivery={deliveries[r.client_id]} /></div>
                  {r.last_error && r.status !== 'synced' && <p className="mt-1 text-xs text-critical-700">{r.last_error}</p>}
                  {r.status === 'needs_auth' && <Link href="/auth/login" className="mt-1 inline-block text-xs font-bold underline">Sign in</Link>}
=======
import { useEffect, useState } from 'react'
import { useOfflineSync } from '@/hooks/useOfflineSync'
import { clearSyncedReports, QueuedReport } from '@/lib/offlineQueue'

const STATUS_STYLES: Record<QueuedReport['status'], string> = {
  pending: 'bg-warning-100 text-warning-700',
  syncing: 'bg-sand-200 text-ink-800',
  synced: 'bg-success-100 text-success-800',
  failed: 'bg-critical-100 text-critical-700'
}

const STATUS_LABELS: Record<QueuedReport['status'], string> = {
  pending: 'Waiting to upload',
  syncing: 'Uploading…',
  synced: 'Uploaded',
  failed: 'Failed'
}

export default function SyncStatus() {
  const { supported, online, entries, pendingCount, failedCount, syncing, lastSync, syncNow, retry, discard } =
    useOfflineSync()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined)
    }
    navigator.storage?.persist?.().catch(() => undefined)
  }, [])

  if (!supported) return null

  const dotColor = !online ? 'bg-critical' : syncing ? 'bg-ink-700 animate-pulse' : pendingCount || failedCount ? 'bg-warning' : 'bg-success-700'
  // When everything is synced the pill is only shown on larger screens, so it never covers form buttons on phones.
  const idle = online && !syncing && !pendingCount && !failedCount
  const summary = !online
    ? `Offline${pendingCount ? ` · ${pendingCount} queued` : ''}`
    : syncing
      ? 'Syncing reports…'
      : failedCount
        ? `${failedCount} report${failedCount > 1 ? 's' : ''} need attention`
        : pendingCount
          ? `${pendingCount} waiting to sync`
          : 'Online · All synced'

  return (
    <div className={`fixed bottom-24 right-3 sm:bottom-4 sm:right-4 z-[1000] flex-col items-end gap-2 ${idle && !open ? 'hidden sm:flex' : 'flex'}`} data-testid="sync-status">
      {open && (
        <div className="w-80 max-h-[60vh] overflow-y-auto bg-white rounded-lg shadow-xl border p-4 text-sm">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-ink-900">Offline report queue</h3>
            <button onClick={() => setOpen(false)} className="text-ink-400 hover:text-ink-600" aria-label="Close">
              ✕
            </button>
          </div>
          <p className="text-ink-600 mb-3">
            {online
              ? 'Connected. Queued reports upload automatically.'
              : 'No connection. Reports are saved on this device and will upload when the connection returns.'}
          </p>
          {lastSync && (
            <p className="text-xs text-ink-500 mb-3">
              Last sync {lastSync.at.toLocaleTimeString()}: {lastSync.result.synced} uploaded
              {lastSync.result.duplicates ? `, ${lastSync.result.duplicates} already on server` : ''}
              {lastSync.result.failed ? `, ${lastSync.result.failed} failed` : ''}
            </p>
          )}
          <div className="flex gap-2 mb-3">
            <button
              onClick={() => void syncNow()}
              disabled={!online || syncing || !pendingCount}
              className="flex-1 px-3 py-1.5 bg-primary text-ink-900 font-bold rounded-md hover:bg-primary-600 disabled:opacity-50"
            >
              {syncing ? 'Syncing…' : 'Sync now'}
            </button>
            <button
              onClick={() => void clearSyncedReports()}
              disabled={!entries.some(e => e.status === 'synced')}
              className="px-3 py-1.5 bg-ink-100 text-ink-700 rounded-md hover:bg-ink-200 disabled:opacity-50"
            >
              Clear uploaded
            </button>
          </div>
          {entries.length === 0 ? (
            <p className="text-ink-500 text-center py-2">No reports stored on this device.</p>
          ) : (
            <ul className="space-y-2">
              {entries.map(entry => (
                <li key={entry.client_id} className="border rounded-md p-2">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium text-ink-900 truncate">
                      {entry.payload.location_address || 'GPS location'}
                    </span>
                    <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[entry.status]}`}>
                      {STATUS_LABELS[entry.status]}
                    </span>
                  </div>
                  <div className="text-xs text-ink-500 mt-1">
                    {entry.payload.people_count} people · saved {new Date(entry.created_at).toLocaleString()}
                    {entry.attempts > 0 && entry.status !== 'synced' ? ` · ${entry.attempts} attempt(s)` : ''}
                  </div>
                  {entry.duplicate && (
                    <div className="text-xs text-ink-600 mt-1">Server already had this report – not duplicated.</div>
                  )}
                  {entry.last_error && entry.status !== 'synced' && (
                    <div className="text-xs text-critical-700 mt-1">{entry.last_error}</div>
                  )}
                  {entry.status === 'failed' && (
                    <div className="flex gap-2 mt-2">
                      <button onClick={() => void retry(entry.client_id)} className="text-xs text-ink-900 underline font-medium">
                        Retry
                      </button>
                      <button onClick={() => void discard(entry.client_id)} className="text-xs text-critical-700 font-medium">
                        Discard
                      </button>
                    </div>
                  )}
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
                </li>
              ))}
            </ul>
          )}
<<<<<<< HEAD
        </section>
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="clay-sm flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold text-ink-900"
      >
        <Icon name={online ? (waiting ? 'clock' : 'check') : 'offline'} size={16} className={!online ? 'text-critical-700' : undefined} />
=======
        </div>
      )}
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-4 py-2 bg-white rounded-full shadow-lg border text-sm font-medium text-ink-800 hover:bg-ink-50"
      >
        <span className={`w-2.5 h-2.5 rounded-full ${dotColor}`} />
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
        {summary}
      </button>
    </div>
  )
}
