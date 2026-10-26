import type { ChannelId } from '../types'
import { createBridgeAdapter } from './bridge'
import { internetAdapter } from './internet'
import { manualAdapter } from './manual'
import { smsAdapter } from './sms'
import type { ChannelAdapter, DeliveryDeps } from './types'

const real: Record<ChannelId, ChannelAdapter> = {
  radio: createBridgeAdapter('radio'),
  sms: smsAdapter,
  bluetooth: createBridgeAdapter('bluetooth'),
  internet: internetAdapter,
  manual: manualAdapter,
}

export const adapterFor = (id: ChannelId, deps?: DeliveryDeps): ChannelAdapter => deps?.adapters?.[id] ?? real[id]
