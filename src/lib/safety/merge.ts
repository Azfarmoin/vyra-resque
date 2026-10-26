// Pure merge of administrator-published guides over the built-in ones (no React, so it is unit-tested).
import { GUIDES } from './index'
import { lintGuide } from './lint'
import type { HazardGuide } from './types'

export interface Published { hazard_id: string; content: HazardGuide; revision: number; published_at: string }

export function mergePublished(published: Published[], now = Date.now()): HazardGuide[] {
  const by = new Map(published.map((p) => [p.hazard_id, p]))
  return GUIDES.map((base) => {
    const p = by.get(base.id)
    if (!p || p.content?.id !== base.id) return base
    return lintGuide(p.content, now).length ? base : p.content // never show a published guide that fails the content checks
  })
}

