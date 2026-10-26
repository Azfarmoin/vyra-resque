// Twilio request signature check (https://www.twilio.com/docs/usage/security#validating-requests).
import { createHmac } from 'node:crypto'
import { safeEqual } from './auth'

export function twilioSignature(token: string, url: string, params: Record<string, string>): string {
  const data = Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], url)
  return createHmac('sha1', token).update(data).digest('base64')
}

export const verifyTwilioSignature = (token: string, url: string, params: Record<string, string>, header: string | null) =>
  !!header && safeEqual(twilioSignature(token, url, params), header)

export const xmlEscape = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!)
