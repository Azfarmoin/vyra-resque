// A provider for any official CAP feed (RSS/Atom index of CAP messages, or a single CAP document).
// Feed URLs are supplied by deployers through environment variables; none is hard-coded here, because a
// wrong or unverified endpoint would be worse than none. See docs/EARLY_WARNING.md for how to find the
// official feed of an alerting authority (WMO Register of Alerting Authorities: https://alertingauthority.wmo.int/).

import { AlertValidationError, parseCapDocument, readFeedEntries, parseCapAlert } from '../cap'
import type { AlertCandidate, HazardType } from '../types'
import { XmlError } from '../xml'
import type { AlertProvider, ProviderContext, ProviderResult, RejectedItem } from './types'

export interface CapFeedConfig {
  id: string
  name: string
  url: string
  coverage: string
  hazards?: HazardType[]
  updateFrequency?: string
  docsUrl?: string
  language?: string
  minIntervalMinutes?: number
  // Name of an environment variable holding a bearer token, if the feed needs one. The token itself is never stored in config.
  authTokenEnv?: string
}

const MAX_LINKS = 50

function sameSite(feedUrl: string, link: string): boolean {
  try {
    const a = new URL(feedUrl), b = new URL(link)
    if (b.protocol !== 'https:' && b.protocol !== 'http:') return false
    // Links inside a feed are untrusted input: only follow ones on the feed's own host.
    return a.hostname === b.hostname
  } catch {
    return false
  }
}

export function createCapFeedProvider(cfg: CapFeedConfig, envReader: (k: string) => string | undefined = (k) => process.env[k]): AlertProvider {
  const minInterval = cfg.minIntervalMinutes ?? 10
  const token = cfg.authTokenEnv ? envReader(cfg.authTokenEnv) : undefined
  let reason: string | null = null
  try {
    const u = new URL(cfg.url)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') reason = 'Feed URL must be http(s)'
  } catch {
    reason = 'Feed URL is not a valid URL'
  }
  if (!reason && cfg.authTokenEnv && !token) reason = `Credential missing: set ${cfg.authTokenEnv}`

  return {
    id: cfg.id,
    name: cfg.name,
    origin: 'official',
    minIntervalMinutes: minInterval,
    staleAfterMinutes: Math.max(minInterval * 3, 30),
    unconfiguredReason: reason,
    docs: {
      feedUrl: cfg.url,
      docsUrl: cfg.docsUrl ?? 'https://alertingauthority.wmo.int/',
      coverage: cfg.coverage,
      hazards: cfg.hazards ?? ['heavy_rain', 'river_flood', 'cyclone', 'heatwave', 'thunderstorm_wind', 'landslide', 'wildfire', 'earthquake', 'other'],
      updateFrequency: cfg.updateFrequency ?? `Polled every ${minInterval} minutes; the authority publishes when it chooses to`,
      authentication: cfg.authTokenEnv ? `Bearer token from environment variable ${cfg.authTokenEnv}` : 'None configured',
      limitations: 'Shows only what the authority publishes in CAP. No alert here does not mean no hazard. Publication can lag the authority\'s own website or broadcasts.',
    },

    async fetchAlerts(ctx: ProviderContext): Promise<ProviderResult> {
      const headers: Record<string, string> = { Accept: 'application/xml, application/rss+xml, application/atom+xml, text/xml' }
      if (token) headers.Authorization = `Bearer ${token}`
      const base = { provider: cfg.id, sourceName: cfg.name, now: ctx.now, preferredLanguage: cfg.language, sourceUrl: null as string | null }
      const candidates: AlertCandidate[] = []
      const rejected: RejectedItem[] = []
      const take = (fn: () => AlertCandidate[], id: string | null) => {
        try { candidates.push(...fn()) } catch (e) {
          if (e instanceof AlertValidationError) rejected.push({ kind: e.kind, detail: e.message, externalId: e.externalId ?? id })
          else if (e instanceof XmlError) rejected.push({ kind: 'malformed', detail: `XML: ${e.message}`, externalId: id })
          else throw e
        }
      }

      const feedText = await ctx.fetchText(cfg.url, { headers }) // a failure here is a provider failure
      let entries: ReturnType<typeof readFeedEntries>
      try {
        entries = readFeedEntries(feedText)
      } catch (e) {
        throw new Error(`Feed could not be read: ${e instanceof Error ? e.message : 'invalid XML'}`)
      }
      for (const node of entries.inline) take(() => parseCapAlert(node, base), null)

      const links = entries.links.filter((l) => sameSite(cfg.url, l)).slice(0, MAX_LINKS)
      const skipped = entries.links.length - links.length
      if (skipped > 0) rejected.push({ kind: 'other', detail: `${skipped} feed link(s) ignored (other host or over the ${MAX_LINKS} per-run limit)`, externalId: null })
      let failures = 0
      for (let i = 0; i < links.length; i += 5) {
        await Promise.all(links.slice(i, i + 5).map(async (link) => {
          try {
            const xml = await ctx.fetchText(link, { headers })
            take(() => parseCapDocument(xml, { ...base, sourceUrl: link }), null)
          } catch {
            failures++
            rejected.push({ kind: 'provider_error', detail: 'A CAP message listed in the feed could not be fetched', externalId: null })
          }
        }))
      }
      if (links.length && failures === links.length && !candidates.length) throw new Error('None of the CAP messages in the feed could be fetched')
      return { candidates, rejected }
    },
  }
}
