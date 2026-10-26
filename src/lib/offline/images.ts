// Validate and shrink photos on the device before they are stored. Nothing here uses the network.
import { ALLOWED_IMAGE_TYPES, MAX_ATTACHMENT_BYTES, sniffImageType, type AllowedImageType } from '../attachments'

export const MAX_INPUT_BYTES = 40 * 1024 * 1024 // refuse absurd files before even decoding them
const SHRINK_ABOVE_BYTES = 1.5 * 1024 * 1024
const MAX_SIDE = 1600
const JPEG_QUALITY = 0.82

export class ImageRejected extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImageRejected'
  }
}

export interface PreparedImage {
  blob: Blob
  type: AllowedImageType
  width: number | null
  height: number | null
  name: string
}

type Shrinker = (file: Blob) => Promise<{ blob: Blob; width: number; height: number } | null>

// Browser-only: decode, scale to MAX_SIDE and re-encode as JPEG. Returns null when unsupported.
const browserShrink: Shrinker = async (file) => {
  if (typeof createImageBitmap !== 'function') return null
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  let blob: Blob | null = null
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(bitmap, 0, 0, width, height)
    blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY })
  } else if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(bitmap, 0, 0, width, height)
    blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', JPEG_QUALITY))
  }
  bitmap.close?.()
  return blob ? { blob, width, height } : null
}

export async function prepareImage(file: Blob & { name?: string }, shrink: Shrinker = browserShrink): Promise<PreparedImage> {
  const name = (file.name || 'photo').slice(0, 120)
  if (!file.size) throw new ImageRejected('That file is empty.')
  if (file.size > MAX_INPUT_BYTES) throw new ImageRejected('That photo is too large (over 40 MB). Choose a smaller one.')

  // Trust the file's first bytes, not its name or declared type.
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer())
  const type = sniffImageType(head)
  if (!type) {
    throw new ImageRejected(`"${name}" is not a JPEG, PNG or WebP photo. (iPhone HEIC photos: set Camera > Formats > Most Compatible, or share as JPEG.)`)
  }

  let blob: Blob = file.slice(0, file.size, type)
  let width: number | null = null
  let height: number | null = null
  if (file.size > SHRINK_ABOVE_BYTES) {
    try {
      const small = await shrink(file)
      if (small && small.blob.size < file.size) ({ blob, width, height } = small)
    } catch {
      /* decoding failed: fall through and keep the original if it is small enough */
    }
  }
  if (blob.size > MAX_ATTACHMENT_BYTES) {
    throw new ImageRejected(`"${name}" is over 5 MB and this browser could not shrink it. Choose a smaller photo.`)
  }
  const outType = (ALLOWED_IMAGE_TYPES as readonly string[]).includes(blob.type) ? (blob.type as AllowedImageType) : type
  return { blob, type: outType, width, height, name }
}
