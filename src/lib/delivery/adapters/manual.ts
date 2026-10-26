// Manual transfer: QR code, exported file, copied text. VYRA cannot see what happens to it afterwards, so this channel
// only ever offers the material; it never claims a delivery.
import type { ChannelAdapter } from './types'

export const manualAdapter: ChannelAdapter = {
  id: 'manual',
  async availability() {
    return { available: true, reason: null, needsUserAction: true }
  },
  async send() {
    return { outcome: 'needs_user_action', detail: 'Show the QR code, export the file or copy the message, and hand it to a rescue operator, a gateway or someone with a connection.' }
  },
}
