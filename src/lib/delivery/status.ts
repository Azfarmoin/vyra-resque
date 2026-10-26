// What the interface says about a report. One pure function so every screen tells the same truth.
import type { LocalReport } from '../offline/types'
import { DELIVERED_STAGES, STAGE_LABEL, type DeliveryRecord, type DeliveryStage } from './types'

export type Tone = 'neutral' | 'progress' | 'ok' | 'warn' | 'bad'
export interface DeliveryView {
  stage: DeliveryStage
  label: string
  detail: string
  delivered: boolean // a VERIFIED acknowledgement exists. Saved, queued, handed-off and transmitted are all false.
  tone: Tone
}

type R = Pick<LocalReport, 'status' | 'server_id' | 'last_error'> & { server_ingest_channel?: string | null }

const make = (stage: DeliveryStage, detail: string, tone: Tone): DeliveryView => ({ stage, label: STAGE_LABEL[stage], detail, delivered: DELIVERED_STAGES.includes(stage), tone })

export function deliveryView(r: R, d?: DeliveryRecord | null): DeliveryView | null {
  if (r.status === 'draft') return null

  if (d?.operator_ack_at) return make('acknowledged', 'A rescue operator has acknowledged this report.', 'ok')

  if (r.server_id) {
    const earlier = r.server_ingest_channel ? ` The server already had the short message sent by ${r.server_ingest_channel}.` : ''
    if (r.status === 'failed') return make('received_gateway', `The VYRA server has the report, but a photo could not be uploaded. Retry is available.${earlier}`, 'warn')
    if (r.status === 'synced') return make('received_gateway', `The VYRA server confirmed receipt of the full report. A rescue operator has not acknowledged it yet.${earlier}`, 'ok')
    return make('received_gateway', `The VYRA server has the report. Photos are still uploading.${earlier}`, 'ok')
  }

  if (d?.gateway_ack_at) {
    const via = d.gateway_ack_via === 'radio' ? 'over radio' : d.gateway_ack_via === 'bluetooth' ? 'over Bluetooth' : 'by the server'
    return make('received_gateway', `A gateway confirmed it received the short emergency message ${via}. The full report and photos will upload when an internet connection is available.`, 'ok')
  }

  if (r.status === 'syncing') {
    const stage: DeliveryStage = d?.stage === 'sending_mobile_data' ? 'sending_mobile_data' : 'sending_internet'
    return make(stage, 'Sending to the VYRA server. Not confirmed yet.', 'progress')
  }

  if (r.status === 'failed' && !d?.channels?.radio && !d?.channels?.sms && !d?.channels?.bluetooth) {
    return make('failed_retry', `NOT delivered. ${r.last_error ?? 'The server rejected the report.'} Retry is available.`, 'bad')
  }

  if (!d) return make('saved', 'Saved on this device. It has NOT been delivered yet.', 'neutral')

  const tone: Tone = d.stage === 'failed_retry' ? 'bad' : d.stage === 'saved' ? 'neutral' : d.stage === 'transferred_nearby' ? 'warn' : 'progress'
  return make(d.stage, d.detail ?? STAGE_LABEL[d.stage], tone)
}
