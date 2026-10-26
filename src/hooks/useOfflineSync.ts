'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  QueuedReport,
  SyncResult,
  discardReport,
  isIndexedDbAvailable,
  listQueuedReports,
  retryReport,
  subscribeToQueue,
  syncQueue
} from '@/lib/offlineQueue'

const RETRY_INTERVAL_MS = 20000

export function useOfflineSync() {
  const [online, setOnline] = useState(true)
  const [entries, setEntries] = useState<QueuedReport[]>([])
  const [syncing, setSyncing] = useState(false)
  const [lastSync, setLastSync] = useState<{ at: Date; result: SyncResult } | null>(null)
  const [supported, setSupported] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const list = await listQueuedReports()
      setEntries(list)
      setSyncing(list.some(e => e.status === 'syncing'))
    } catch {
      setSupported(false)
    }
  }, [])

  const syncNow = useCallback(async () => {
    if (!navigator.onLine) return null
    setSyncing(true)
    try {
      const result = await syncQueue()
      setLastSync({ at: new Date(), result })
      return result
    } finally {
      setSyncing(false)
      void refresh()
    }
  }, [refresh])

  useEffect(() => {
    setSupported(isIndexedDbAvailable())
    setOnline(navigator.onLine)
    void refresh()
    void syncNow()

    const handleOnline = () => {
      setOnline(true)
      void syncNow()
    }
    const handleOffline = () => setOnline(false)
    const handleVisible = () => {
      if (document.visibilityState === 'visible') void syncNow()
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    document.addEventListener('visibilitychange', handleVisible)
    const unsubscribe = subscribeToQueue(() => void refresh())

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      document.removeEventListener('visibilitychange', handleVisible)
      unsubscribe()
    }
  }, [refresh, syncNow])

  const pendingCount = entries.filter(e => e.status === 'pending' || e.status === 'syncing').length
  const failedCount = entries.filter(e => e.status === 'failed').length

  // Periodic retry while reports are waiting (covers flaky links where `online` never fires)
  useEffect(() => {
    if (!pendingCount || !online) return
    const timer = setInterval(() => void syncNow(), RETRY_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [pendingCount, online, syncNow])

  return {
    supported,
    online,
    entries,
    pendingCount,
    failedCount,
    syncing,
    lastSync,
    syncNow,
    retry: retryReport,
    discard: discardReport
  }
}
