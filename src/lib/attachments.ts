// Shared rules for report photos (used by the upload endpoint and mirrored on the device).
// Configurable with NEXT_PUBLIC_MAX_PHOTO_MB (1-5, the storage bucket and database allow at most 5 MB)
// and NEXT_PUBLIC_MAX_PHOTOS (1-20). The same numbers apply in the browser and on the server.
const intEnv = (v: string | undefined, def: number, min: number, max: number) => {
  const n = Number(v)
  return Number.isFinite(n) && n >= min ? Math.min(Math.floor(n), max) : def
}
export const MAX_ATTACHMENT_BYTES = intEnv(process.env.NEXT_PUBLIC_MAX_PHOTO_MB, 5, 1, 5) * 1024 * 1024
export const MAX_ATTACHMENTS_PER_REPORT = intEnv(process.env.NEXT_PUBLIC_MAX_PHOTOS, 8, 1, 20)
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number]

// Identify an image from its first bytes instead of trusting the file name or declared type.
export function sniffImageType(b: Uint8Array): AllowedImageType | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png'
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp'
  return null
}
