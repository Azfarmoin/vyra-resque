// The local emergency number comes from the deployment, never from this code.
// The existing VYRA screens already tell Karachi users to call "Rescue 1122"; that value is the default so the
// copy stays consistent. Anywhere else, set NEXT_PUBLIC_EMERGENCY_NUMBER (and NEXT_PUBLIC_EMERGENCY_LABEL).
export const EMERGENCY_NUMBER = (process.env.NEXT_PUBLIC_EMERGENCY_NUMBER ?? '1122').trim()
export const EMERGENCY_LABEL = (process.env.NEXT_PUBLIC_EMERGENCY_LABEL ?? 'Rescue 1122').trim()
export const emergencyCallText = () => (EMERGENCY_NUMBER ? `Call your local emergency service (${EMERGENCY_LABEL}) if you can.` : 'Call your local emergency service if you can.')

export const SAFETY_DISCLAIMER =
  'This guide gives general precautions. It does not replace emergency services, trained responders or official instructions. If official instructions for your area differ from this guide, follow the official instructions.'
export const LIVE_INFO_NOTE = 'Current warnings, evacuation orders and zone boundaries need an internet connection. Saved guides never show current warnings.'
