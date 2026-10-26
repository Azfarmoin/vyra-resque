'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getIdentity, type Identity } from '@/lib/offline/identity'
import { getLastSyncAt, listAttachmentsForOwner, listReports, retryReport, summarize, storageInfo } from '@/lib/offline/store'
import { isIndexedDbAvailable } from '@/lib/offline/db'
import { subscribe } from '@/lib/offline/events'
import { deliverPending, deliverReport, refreshOperatorAcks, resetStaleSending } from '@/lib/delivery/orchestrator'
import { listDeliveries } from '@/lib/delivery/store'
import { onBridgeChange, restoreBridges } from '@/lib/delivery/adapters/bridge'
import type { DeliveryRecord } from '@/lib/delivery/types'
import type { LocalAttachment, LocalReport } from '@/lib/offline/types'

const TICK_MS = 15_000
const OPERATOR_POLL_MS = 30_000

// One place that knows: are we online, who owns the reports on screen, what is waiting, and how to sync.
export function useOfflineReports() {
  const [supported, setSupported] = useState(true)
  const [online, setOnline] = useState(true)
  const [identity, setIdentity] = useState<Identity | null>(null)
  const [reports, setReports] = useState<LocalReport[]>([])
  const [attachments, setAttachments] = useState<LocalAttachment[]>([])
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [deliveries, setDeliveries] = useState<Record<string, DeliveryRecord>>({})
  const [storage, setStorage] = useState<{ usage: number; quota: number; persisted: boolean | null } | null>(null)
  const mounted = useRef(true)

  const refresh = useCallback(async () => {
    if (!isIndexedDbAvailable()) return setSupported(false)
    try {
      const id = await getIdentity()
      const [list, atts, last, dl] = await Promise.all([listReports(id.owner), listAttachmentsForOwner(id.owner), getLastSyncAt(), listDeliveries()])
      if (!mounted.current) return
      setDeliveries(Object.fromEntries(dl.map((d) => [d.client_id, d])))
      setIdentity(id)
      setReports(list)
      setAttachments(atts)
      setLastSyncAt(last)
      setSyncing(list.some((r) => r.status === 'syncing'))
    } catch {
      if (mounted.current) setSupported(false)
    }
  }, [])

  // "Sync now" runs the whole delivery engine (radio, SMS, Bluetooth, internet), not just the internet upload.
  // It never waits for Wi-Fi: it tries whatever the device has.
  const syncNow = useCallback(
    async (force = true) => {
      setSyncing(true)
      try {
        await deliverPending({ force })
        await refreshOperatorAcks()
      } finally {
        if (mounted.current) setSyncing(false)
        void refresh()
      }
    },
    [refresh]
  )

  useEffect(() => {
    mounted.current = true
    setOnline(navigator.onLine)
    void refresh()
    // Turn a stale "sending" left by a closed app into an honest "retry available", reopen a radio that was
    // plugged in before (no tap needed), then try to deliver whatever is waiting.
    void resetStaleSending()
      .then(() => restoreBridges())
      .catch(() => undefined)
      .finally(() => void syncNow(false))
    void storageInfo().then((s) => mounted.current && setStorage(s))

    const up = () => {
      setOnline(true)
      void syncNow(true) // a connection just appeared: do not wait for the backoff timer
    }
    const down = () => setOnline(false)
    const visible = () => {
      if (document.visibilityState === 'visible') {
        setOnline(navigator.onLine)
        void syncNow(false)
      }
    }
    const session = () => {
      void refresh().then(() => syncNow(false)) // signing in may unlock reports that were waiting for it
    }
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    window.addEventListener('vyra:session', session)
    document.addEventListener('visibilitychange', visible)
    const off = subscribe(() => void refresh())
    const offBridge = onBridgeChange(() => void syncNow(true)) // a radio or relay was just connected: send right away
    return () => {
      mounted.current = false
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
      window.removeEventListener('vyra:session', session)
      document.removeEventListener('visibilitychange', visible)
      off()
      offBridge()
    }
  }, [refresh, syncNow])

  const stats = useMemo(() => summarize(reports, attachments), [reports, attachments])

  // Keep trying while anything is waiting. NOT gated on navigator.onLine: that flag is wrong on Wi-Fi without
  // internet, and radio hardware or a later SMS hand-off does not need it at all.
  const waitingForDelivery = useMemo(
    () => reports.some((r) => r.status !== 'draft' && r.status !== 'failed' && !(r.server_id && r.status === 'synced')),
    [reports]
  )
  useEffect(() => {
    if (!waitingForDelivery) return
    const t = setInterval(() => void syncNow(false), TICK_MS)
    return () => clearInterval(t)
  }, [waitingForDelivery, syncNow])

  // Has a rescue operator picked up the reports the server already holds? (internet only, read-only)
  const hasServerCopies = useMemo(() => reports.some((r) => r.server_id && !deliveries[r.client_id]?.operator_ack_at), [reports, deliveries])
  useEffect(() => {
    if (!hasServerCopies) return
    const t = setInterval(() => void refreshOperatorAcks().then(() => refresh()), OPERATOR_POLL_MS)
    void refreshOperatorAcks().then(() => refresh())
    return () => clearInterval(t)
  }, [hasServerCopies, refresh])

  const retry = useCallback(
    async (id: string) => {
      await retryReport(id)
      void deliverReport(id, { force: true, userGesture: true }).finally(() => void refresh())
    },
    [refresh]
  )

  return { supported, online, identity, reports, attachments, deliveries, stats, lastSyncAt, syncing, storage, syncNow, retry, refresh }
}
