// Manual transfer material: a QR code, an exported file and copyable text. Works with no connection at all.
import { listAttachments } from '../offline/store'
import type { LocalReport } from '../offline/types'
import { incidentRef } from './compact'

export const EXPORT_FORMAT = 'vyra-report/1'

export async function qrDataUrl(text: string): Promise<string> {
  const QR = await import('qrcode')
  return QR.toDataURL(text, { errorCorrectionLevel: 'M', margin: 2, width: 320 })
}

const toBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })

export interface ExportFile { filename: string; blob: Blob; photos: number }

/** The whole report (and, if asked, its photos) as one file a person can carry on a USB stick or send by any app.
 *  The account id is left out: an operator imports it as an ordinary report. */
export async function buildExportFile(report: LocalReport, compact: string, includePhotos: boolean): Promise<ExportFile> {
  const { reporter_id: _drop, ...payload } = (report.payload ?? {}) as Record<string, unknown>
  void _drop
  const photos: { name: string; type: string; data_base64: string }[] = []
  if (includePhotos) {
    for (const a of await listAttachments(report.client_id)) if (a.blob) photos.push({ name: a.name, type: a.type, data_base64: await toBase64(a.blob) })
  }
  const body = { format: EXPORT_FORMAT, exported_at: new Date().toISOString(), client_id: report.client_id, reference: incidentRef(report.client_id), compact, queued_at: report.queued_at, payload, photos }
  return { filename: `vyra-${incidentRef(report.client_id)}.vyra.json`, blob: new Blob([JSON.stringify(body)], { type: 'application/json' }), photos: photos.length }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
