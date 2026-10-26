// Multi-channel delivery model. A report is first saved on the device (see ../offline), then delivery is
// attempted through every configured channel. Nothing here ever claims "delivered" because something was
// merely saved, queued, handed to another app, or transmitted: only a verified acknowledgement counts.

export type ChannelId = 'radio' | 'sms' | 'bluetooth' | 'internet' | 'manual'

/** Default priority (configurable by the user). */
export const DEFAULT_ORDER: ChannelId[] = ['radio', 'sms', 'bluetooth', 'internet', 'manual']

export const CHANNEL_LABEL: Record<ChannelId, string> = {
  radio: 'Radio (LoRa / mesh)',
  sms: 'SMS',
  bluetooth: 'Bluetooth (nearby device)',
  internet: 'Internet (Wi-Fi or mobile data)',
  manual: 'Manual transfer (QR / file)',
}

export type DeliveryStage =
  | 'saved'
  | 'sending_radio'
  | 'sending_sms'
  | 'sending_mobile_data'
  | 'sending_internet'
  | 'transferred_nearby'
  | 'received_gateway'
  | 'acknowledged'
  | 'failed_retry'

export const STAGE_LABEL: Record<DeliveryStage, string> = {
  saved: 'Saved on Device',
  sending_radio: 'Sending via Radio',
  sending_sms: 'Sending via SMS',
  sending_mobile_data: 'Sending via Mobile Data',
  sending_internet: 'Sending via Internet',
  transferred_nearby: 'Transferred to Nearby Device',
  received_gateway: 'Received by Gateway',
  acknowledged: 'Acknowledged by Rescue Operator',
  failed_retry: 'Delivery Failed — Retry Available',
}

/** Only these two mean a verified acknowledgement exists. Everything else is "not delivered (yet)". */
export const DELIVERED_STAGES: DeliveryStage[] = ['received_gateway', 'acknowledged']

export type AttemptOutcome = 'acked' | 'transmitted' | 'handed_off' | 'failed' | 'unavailable' | 'needs_user_action'

export interface DeliveryAttempt {
  at: string
  channel: ChannelId
  outcome: AttemptOutcome
  detail: string
}

export type ChannelState = 'idle' | 'unavailable' | 'needs_user_action' | 'pending_ack' | 'failed' | 'acked'

export interface ChannelStatus {
  state: ChannelState
  reason: string | null
  at: string
}

/** Stored in the `delivery` IndexedDB store, one row per report (kept apart from the report so the sync
 *  engine and the delivery engine can never overwrite each other's data). */
export interface DeliveryRecord {
  client_id: string
  stage: DeliveryStage
  channel: ChannelId | null // channel the current stage refers to
  detail: string | null
  updated_at: string
  compact: string | null // the exact compact message used on constrained channels (stable across retries)
  attempts: DeliveryAttempt[] // newest last, capped
  channels: Partial<Record<ChannelId, ChannelStatus>>
  gateway_ack_at: string | null // a gateway (radio/Bluetooth/server) confirmed receipt
  gateway_ack_via: ChannelId | null
  operator_ack_at: string | null // a rescue operator acknowledged the report
  server_status: string | null // last status the server reported (internet only)
  runs: number
  next_retry_at: string | null
}

export interface DeliveryConfig {
  order: ChannelId[]
  enabled: Record<ChannelId, boolean>
  smsNumber: string // number of the VYRA SMS gateway (E.164)
  ackWaitMs: number // how long to wait for a radio/Bluetooth acknowledgement before moving on
}

export const MAX_ATTEMPT_LOG = 40
