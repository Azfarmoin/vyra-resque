'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from '@/components/ui/Icon'
import { addAttachment, listAttachments, patchAttachment, removeAttachment, storageInfo } from '@/lib/offline/store'
import { analysisLine } from '@/components/photo/PhotoAnalysisPanel'
import { subscribe } from '@/lib/offline/events'
import { ImageRejected } from '@/lib/offline/images'
import { LocalSaveError, type LocalAttachment } from '@/lib/offline/types'
import { MAX_ATTACHMENTS_PER_REPORT } from '@/lib/attachments'

const LOW_SPACE_BYTES = 100 * 1024 * 1024
const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

const STATUS_TEXT: Record<LocalAttachment['status'], string> = {
  local: 'Saved on this device. Not uploaded yet.',
  uploading: 'Uploading…',
  uploaded: 'Uploaded to the VYRA server.',
  failed: 'Upload failed.',
}

function Thumb({ att }: { att: LocalAttachment }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!att.blob) return setUrl(null)
    const u = URL.createObjectURL(att.blob) // local preview only: the photo is not uploaded to show it
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [att.blob])
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt={`Preview of ${att.name}`} className="h-16 w-16 shrink-0 rounded-xl object-cover" />
  ) : (
    <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-sand-200 text-ink-600"><Icon name="check" size={20} /></span>
  )
}

export default function PhotoAttachments({ reportId, owner, ensureDraft, consent = false, onConsent }: { reportId: string; owner: string; ensureDraft: () => Promise<void>; consent?: boolean; onConsent?: (v: boolean) => void }) {
  const [items, setItems] = useState<LocalAttachment[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [lowSpace, setLowSpace] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const replaceRef = useRef<HTMLInputElement>(null)
  const replacing = useRef<string | null>(null)

  const load = useCallback(async () => {
    try {
      setItems(await listAttachments(reportId))
    } catch {
      /* IndexedDB unavailable: the form shows its own warning */
    }
  }, [reportId])

  useEffect(() => {
    void load()
    return subscribe(() => void load())
  }, [load])

  useEffect(() => {
    void storageInfo().then((s) => setLowSpace(!!s.quota && s.quota - s.usage < LOW_SPACE_BYTES))
  }, [items.length])

  const setConsent = async (v: boolean) => {
    onConsent?.(v)
    // photos already on the device follow the choice (turning it off also drops any shown suggestions)
    for (const a of await listAttachments(reportId)) if (!!a.analysis_consent !== v) await patchAttachment(a.id, { analysis_consent: v, ...(v ? {} : { analysis: null }) })
  }

  const add = async (files: FileList | null) => {
    if (!files?.length) return
    setBusy(true)
    setError('')
    const problems: string[] = []
    try {
      await ensureDraft() // the photo needs a report record to belong to
      for (const file of Array.from(files)) {
        try {
          const saved = await addAttachment(reportId, owner, file)
          if (consent) await patchAttachment(saved.id, { analysis_consent: true })
          if (replacing.current) {
            await removeAttachment(replacing.current) // replaced: the old photo is gone
            replacing.current = null
          }
        } catch (e) {
          problems.push(e instanceof ImageRejected || e instanceof LocalSaveError ? e.message : `Could not save "${file.name}" on this device.`)
          if (e instanceof LocalSaveError && e.quota) break
        }
      }
    } finally {
      setBusy(false)
      if (problems.length) setError(problems.join(' '))
      if (inputRef.current) inputRef.current.value = ''
      if (cameraRef.current) cameraRef.current.value = ''
      if (replaceRef.current) replaceRef.current.value = ''
      replacing.current = null
    }
  }

  const full = items.length >= MAX_ATTACHMENTS_PER_REPORT
  return (
    <fieldset className="space-y-3">
      <legend className="label">Photos (optional)</legend>
      <p className="hint">Photos are saved on this device first and uploaded when you are online. They are not analysed on the device, and a photo is only marked uploaded after the server confirms it.</p>
      <div className="flex flex-wrap gap-3">
        <button type="button" className="btn-ghost btn-sm" disabled={busy || full} onClick={() => cameraRef.current?.click()}>
          <Icon name="camera" size={16} /> Take a photo
        </button>
        <button type="button" className="btn-ghost btn-sm" disabled={busy || full} onClick={() => inputRef.current?.click()}>
          <Icon name="plus" size={16} /> Choose photos
        </button>
        <input ref={replaceRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} aria-label="Choose a replacement photo" onChange={(e) => void add(e.target.files)} />
        <input ref={cameraRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="sr-only" tabIndex={-1} aria-label="Take a photo" onChange={(e) => void add(e.target.files)} />
        <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" tabIndex={-1} aria-label="Choose photos from this device" onChange={(e) => void add(e.target.files)} />
      </div>
      {onConsent && (
        <label className="flex items-start gap-2 rounded-xl bg-sand-100 p-3 text-sm">
          <input type="checkbox" className="mt-1" checked={consent} onChange={(e) => void setConsent(e.target.checked)} />
          <span>
            <span className="font-bold">Let VYRA&apos;s AI look at my photos and suggest what they show.</span>{' '}
            When this is on, your photos are sent securely to an AI service run by the app&apos;s operator to suggest a title, description and hazards. It is optional: reports work the same without it, and suggestions are never added unless you choose them.
          </span>
        </label>
      )}
      {busy && <p className="hint" role="status">Saving photo on this device…</p>}
      {lowSpace && (
        <p className="flex items-start gap-1.5 text-sm font-semibold text-warning-700" role="status">
          <Icon name="alert" size={16} className="mt-0.5 shrink-0" /> This device is running low on storage. Photos may fail to save, so keep only the most useful ones.
        </p>
      )}
      {error && (
        <p className="field-error" role="alert"><Icon name="alert" size={16} className="mt-0.5 shrink-0" /> {error}</p>
      )}
      {full && <p className="hint">Maximum of {MAX_ATTACHMENTS_PER_REPORT} photos reached.</p>}
      {items.length > 0 && (
        <ul className="space-y-2">
          {items.map((a) => (
            <li key={a.id} className="clay-inset flex items-center gap-3 p-2.5">
              <Thumb att={a} />
              <div className="min-w-0 flex-1 text-sm">
                <p className="truncate font-bold">{a.name}</p>
                <p className="text-ink-600">{kb(a.size)} · {STATUS_TEXT[a.status]}</p>
                {onConsent && <p className="text-ink-600">{analysisLine(a)}</p>}
                {a.error && a.status !== 'uploaded' && <p className="text-critical-700">{a.error}</p>}
              </div>
              {a.status !== 'uploaded' && (
                <button type="button" className="btn-ghost btn-sm" onClick={() => { replacing.current = a.id; replaceRef.current?.click() }} aria-label={`Replace photo ${a.name}`}>
                  <Icon name="refresh" size={16} />
                </button>
              )}
              {a.status !== 'uploaded' && (
                <button type="button" className="btn-ghost btn-sm" onClick={() => void removeAttachment(a.id)} aria-label={`Remove photo ${a.name}`}>
                  <Icon name="trash" size={16} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  )
}
