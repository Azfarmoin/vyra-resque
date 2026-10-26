import type { LocalReport } from '../../offline/types'
import type { SyncDeps } from '../../offline/sync'
import type { AttemptOutcome, ChannelId, DeliveryConfig } from '../types'

export interface DeliveryDeps {
  now: () => number
  /** Replace adapters (tests inject fakes here; production never does). */
  adapters?: Partial<Record<ChannelId, ChannelAdapter>>
  syncDeps?: Partial<SyncDeps>
  /** What kind of link the browser reports (Network Information API; often unknown). */
  connection?: () => 'cellular' | 'wifi' | 'other' | 'unknown'
  /** The browser's own "is there any network" flag. It is a hint, never proof. */
  isOnline?: () => boolean
}

export interface AdapterContext {
  report: LocalReport
  compact: string
  config: DeliveryConfig
  /** The user pressed Retry / Send (ignore backoff, try even when the browser claims to be offline). */
  force: boolean
  /** A tap or click is happening right now (needed to open the SMS app or a Bluetooth chooser). */
  userGesture: boolean
  deps: DeliveryDeps
}

export interface Availability {
  available: boolean
  reason: string | null
  needsUserAction?: boolean
}

export interface SendResult {
  outcome: AttemptOutcome
  detail: string
  ack?: { operator?: boolean }
}

export interface ChannelAdapter {
  id: ChannelId
  availability(ctx: AdapterContext): Promise<Availability>
  send(ctx: AdapterContext): Promise<SendResult>
}
