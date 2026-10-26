'use client'

// SMS channel. A web app cannot send an SMS by itself: the browser can only open the phone's messaging app with the
// text ready, and the person must press Send there. So this channel is "hand-off", and it never reports delivery.
// A native wrapper (Capacitor/Cordova) may expose window.VyraNative.sendSms to send silently on Android.
import type { AdapterContext, Availability, ChannelAdapter, SendResult } from './types'

interface NativeBridge { sendSms?: (to: string, body: string) => Promise<{ accepted: boolean; error?: string }> }
const native = () => (typeof window === 'undefined' ? undefined : (window as unknown as { VyraNative?: NativeBridge }).VyraNative)
const isPhone = () => typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)

export function smsUri(number: string, body: string): string {
  const ios = typeof navigator !== 'undefined' && /iPhone|iPad|iPod/i.test(navigator.userAgent)
  return `sms:${number}${ios ? '&' : '?'}body=${encodeURIComponent(body)}`
}

export const smsAdapter: ChannelAdapter = {
  id: 'sms',
  async availability(ctx: AdapterContext): Promise<Availability> {
    if (!ctx.config.smsNumber) return { available: false, reason: 'No SMS gateway number is set. Add it under Delivery channels.' }
    if (native()?.sendSms) return { available: true, reason: null }
    if (!isPhone()) return { available: false, reason: 'This device cannot send SMS from the browser (phones only).' }
    return { available: true, reason: null, needsUserAction: true }
  },
  async send(ctx: AdapterContext): Promise<SendResult> {
    const body = ctx.compact
    const n = native()
    if (n?.sendSms) {
      try {
        const r = await n.sendSms(ctx.config.smsNumber, body)
        return r.accepted
          ? { outcome: 'transmitted', detail: 'Handed to the mobile network. An SMS gives no delivery confirmation, so it is NOT confirmed delivered.' }
          : { outcome: 'failed', detail: r.error || 'The phone refused to send the SMS.' }
      } catch (e) {
        return { outcome: 'failed', detail: `The phone could not send the SMS: ${(e as Error).message}` }
      }
    }
    if (!ctx.userGesture) return { outcome: 'needs_user_action', detail: 'Tap "Send via SMS" to open your messaging app with the report ready. You must press Send there.' }
    window.location.href = smsUri(ctx.config.smsNumber, body)
    return { outcome: 'handed_off', detail: 'Opened your messaging app with the report ready. Press Send there. VYRA cannot see whether it was sent or delivered.' }
  },
}
