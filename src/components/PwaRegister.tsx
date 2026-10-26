'use client'

import { useEffect } from 'react'
import { requestPersistence } from '@/lib/offline/store'

// Registers the service worker (production builds only: in `next dev` a worker would serve stale code) and
// hands it the list of build files this page loaded, so the report form also opens with no connection.
export default function PwaRegister() {
  useEffect(() => {
    void requestPersistence() // may be refused; nothing relies on it being granted
    if (!('serviceWorker' in navigator) || process.env.NODE_ENV !== 'production') return
    let cancelled = false
    const warm = async () => {
      const reg = await navigator.serviceWorker.ready
      if (cancelled || !reg.active) return
      const urls = performance
        .getEntriesByType('resource')
        .map((e) => e.name)
        .filter((n) => n.includes('/_next/static/'))
      reg.active.postMessage({ type: 'CACHE_URLS', urls })
    }
    navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then(() => {
        // Wait a moment so lazily loaded chunks (the map picker) are included.
        const t = window.setTimeout(() => void warm().catch(() => undefined), 4000)
        return () => window.clearTimeout(t)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])
  return null
}
