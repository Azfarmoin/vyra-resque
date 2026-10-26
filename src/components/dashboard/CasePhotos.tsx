'use client'

import { useEffect, useState } from 'react'
import Icon from '@/components/ui/Icon'
import { getIdentity } from '@/lib/offline/identity'

type Meta = { id: string; mime_type: string; size_bytes: number }

// Photos sent with a report. They sit in a private bucket, so each one is fetched through the API with the
// responder's own sign-in token and shown from a temporary in-memory URL. Nothing is cached.
export default function CasePhotos({ reportId }: { reportId: string }) {
  const [urls, setUrls] = useState<{ id: string; url: string }[]>([])
  const [note, setNote] = useState('')

  useEffect(() => {
    let alive = true
    const made: string[] = []
    setUrls([])
    setNote('')
    ;(async () => {
      try {
        const { token } = await getIdentity()
        const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {}
        const res = await fetch(`/api/reports/${reportId}/attachments`, { headers, cache: 'no-store' })
        if (res.status === 401 || res.status === 403) return alive && setNote('Sign in as a responder to view photos.')
        if (!res.ok) return
        const { attachments } = (await res.json()) as { attachments: Meta[] }
        const out: { id: string; url: string }[] = []
        for (const a of attachments) {
          const img = await fetch(`/api/reports/${reportId}/attachments/${a.id}`, { headers, cache: 'no-store' })
          if (!img.ok) {
            if (alive) setNote('Some photos could not be loaded.')
            continue
          }
          const url = URL.createObjectURL(await img.blob())
          made.push(url)
          out.push({ id: a.id, url })
        }
        if (alive) setUrls(out)
      } catch {
        /* offline or unavailable: photos simply do not show */
      }
    })()
    return () => {
      alive = false
      made.forEach((u) => URL.revokeObjectURL(u))
    }
  }, [reportId])

  if (!urls.length && !note) return null
  return (
    <section className="mt-4" aria-label="Photos from the reporter">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-ink-700"><Icon name="camera" size={16} /> Photos from the reporter (unverified)</h3>
      {note && <p className="hint">{note}</p>}
      <ul className="flex flex-wrap gap-2">
        {urls.map((p, i) => (
          <li key={p.id}>
            <a href={p.url} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt={`Reporter photo ${i + 1}`} className="h-24 w-24 rounded-xl object-cover" />
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}
