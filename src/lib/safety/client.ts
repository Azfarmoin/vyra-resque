'use client'
// Reviewed content = the guides bundled with the app (always available, work offline) plus guides an administrator has
// published through /admin/safety. A published guide replaces the bundled one only if it passes the same content lint.
// The last published set is kept in localStorage so it still works offline; if anything fails, the bundled guide is used.
import { useEffect, useState } from 'react'
import { GUIDES } from './index'
import { mergePublished, type Published } from './merge'
import type { HazardGuide } from './types'

const KEY = 'vyra-safety-published-v1'
export type { Published } from './merge'

function readCache(): Published[] {
  try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : [] } catch { return [] }
}

export function useGuides() {
  const [guides, setGuides] = useState<HazardGuide[]>(GUIDES)
  const [source, setSource] = useState<'bundled' | 'published' | 'saved'>('bundled')
  useEffect(() => {
    const cached = readCache()
    if (cached.length) { setGuides(mergePublished(cached)); setSource('saved') }
    let alive = true
    fetch('/api/safety/content', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { items: Published[] }) => {
        if (!alive || !Array.isArray(d.items)) return
        try { localStorage.setItem(KEY, JSON.stringify(d.items)) } catch { /* storage full: fine */ }
        setGuides(mergePublished(d.items)); setSource(d.items.length ? 'published' : 'bundled')
      })
      .catch(() => { /* offline or unavailable: keep bundled / saved content */ })
    return () => { alive = false }
  }, [])
  return { guides, source }
}

export function useOnline() {
  const [online, setOnline] = useState(true)
  useEffect(() => {
    const u = () => setOnline(navigator.onLine)
    u(); window.addEventListener('online', u); window.addEventListener('offline', u)
    return () => { window.removeEventListener('online', u); window.removeEventListener('offline', u) }
  }, [])
  return online
}

/** Ask the browser to fetch every guide page now so the service worker stores it. Works only while online. */
export async function saveGuidesOffline(ids: string[], onProgress?: (done: number, total: number) => void): Promise<{ ok: number; failed: number }> {
  const urls = ['/safety', '/safety/now', ...ids.map((i) => `/safety/${i}`)]
  let ok = 0, failed = 0
  for (const u of urls) {
    try { const r = await fetch(u, { cache: 'reload' }); r.ok ? ok++ : failed++ } catch { failed++ }
    onProgress?.(ok + failed, urls.length)
  }
  return { ok, failed }
}
