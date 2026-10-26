import type { PhotoAnalysisResult } from '../photoAnalysis/schema'
// Data model for reports kept on the device (IndexedDB database "vyra-offline", version 2).

/** Owner key used for reports saved while nobody was signed in. */
export const ANON = 'anon'

/**
 * Lifecycle of a local report:
 *
 *   draft ──queue──▶ saved_locally ──sync──▶ syncing ──server confirms──▶ synced
 *                          ▲                    │
 *                          │ retry              ├─ temporary failure ─▶ waiting (backoff, retries on its own)
 *                          └──── failed ◀───────┤─ rejected by server ─▶ failed  (user must fix / retry)
 *                                               └─ not signed in / session expired ─▶ needs_auth
 *
 * A report is only "synced" after the server answered 200/201 AND every photo was confirmed stored.
 */
export type LocalStatus = 'draft' | 'saved_locally' | 'waiting' | 'syncing' | 'synced' | 'failed' | 'needs_auth'

export interface LocalReport {
  client_id: string // collision-resistant id made on the device; also the server idempotency key
  owner: string // user id, or ANON. Reports are only listed/synced for their owner.
  status: LocalStatus
  form: Record<string, unknown> // exact form answers, so the report can be edited before it is sent
  payload: Record<string, unknown> | null // what is POSTed to /api/reports (null while still a draft)
  step: number // wizard step to resume a draft on
  created_at: string
  updated_at: string
  queued_at: string | null
  attempts: number
  next_attempt_at: string | null // earliest automatic retry (exponential backoff + jitter)
  last_error: string | null
  server_id: string | null // set only after the server confirmed the report
  server_status: string | null // authoritative status last returned by the server
  synced_at: string | null
  duplicate: boolean // the server already had this client_id (a retry after a lost response)
  server_ingest_channel?: string | null // set when the server already had a compact copy (radio/SMS/Bluetooth/manual) before this sync
  created_offline: boolean
}

export type AttachmentStatus = 'local' | 'uploading' | 'uploaded' | 'failed'

// What this device knows about the AI analysis of one photo. 'waiting' = no internet yet: the analysis
// has NOT happened (it is never faked offline). Results here are suggestions only.
export type LocalAnalysisStatus = 'waiting' | 'processing' | 'completed' | 'failed' | 'not_configured'
export interface LocalAnalysis {
  status: LocalAnalysisStatus
  result: PhotoAnalysisResult | null
  reason: string | null
  at: string | null
  choice: 'none' | 'used' | 'edited' | 'ignored' // what the reporter did with the suggestions
  server_checked: boolean // the stored copy on the server was analysed too
}

export interface LocalAttachment {
  id: string // also the server idempotency key for this photo
  report_id: string // LocalReport.client_id
  owner: string
  name: string
  type: string
  size: number
  width: number | null
  height: number | null
  blob: Blob | null // dropped once the server confirmed the upload (frees space, avoids lingering private photos)
  status: AttachmentStatus
  error: string | null
  created_at: string
  uploaded_at: string | null
  server_attachment_id: string | null
  analysis_consent?: boolean // reporter agreed to AI processing of THIS photo
  analysis?: LocalAnalysis | null
}

export const PENDING_STATUSES: LocalStatus[] = ['saved_locally', 'waiting', 'syncing', 'needs_auth']

export const STATUS_LABEL: Record<LocalStatus, string> = {
  draft: 'Draft',
  saved_locally: 'Saved on this device',
  waiting: 'Waiting to sync',
  syncing: 'Synchronizing',
  synced: 'Received by VYRA server',
  failed: 'Sync failed — retry available',
  needs_auth: 'Sign in to sync',
}

export class LocalSaveError extends Error {
  constructor(message: string, public quota = false) {
    super(message)
    this.name = 'LocalSaveError'
  }
}
