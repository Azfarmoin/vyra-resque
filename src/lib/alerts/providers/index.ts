import { createCapFeedProvider, type CapFeedConfig } from './capFeed'
import { createOpenMeteoProvider } from './openMeteo'
import { createUsgsProvider } from './usgs'
import type { AlertProvider } from './types'
import type { HazardType } from '../types'

export * from './types'

type Env = Record<string, string | undefined>

interface KnownAuthority {
  id: string
  name: string
  urlEnv: string
  tokenEnv: string
  coverage: string
  hazards: HazardType[]
  docsUrl: string
  note: string
}

// Pakistan-focused authorities. NO feed URL is hard-coded: none could be verified as a stable machine-readable CAP
// endpoint when this was written, and a guessed URL would be worse than none. Each stays "unconfigured" until a
// deployer sets the URL taken from the authority itself (or the WMO Register of Alerting Authorities).
const KNOWN: KnownAuthority[] = [
  {
    id: 'pmd-cap', name: 'Pakistan Meteorological Department (CAP alerts)', urlEnv: 'ALERT_PMD_CAP_URL', tokenEnv: 'ALERT_PMD_CAP_TOKEN',
    coverage: 'Pakistan (national)', hazards: ['heavy_rain', 'river_flood', 'cyclone', 'heatwave', 'thunderstorm_wind', 'landslide', 'earthquake', 'other'],
    docsUrl: 'https://www.pmd.gov.pk/',
    note: 'PMD\'s website has an "Alerts (CAP)" section and Pakistan is listed in the WMO Register of Alerting Authorities (https://alertingauthority.wmo.int/). Confirm the machine-readable CAP feed URL with PMD or the WMO Register before setting ALERT_PMD_CAP_URL.',
  },
  {
    id: 'ndma-cap', name: 'National Disaster Management Authority (NDMA)', urlEnv: 'ALERT_NDMA_CAP_URL', tokenEnv: 'ALERT_NDMA_CAP_TOKEN',
    coverage: 'Pakistan (national)', hazards: ['heavy_rain', 'river_flood', 'landslide', 'heatwave', 'cyclone', 'earthquake', 'other'],
    docsUrl: 'https://ndma.gov.pk/',
    note: 'NDMA publishes advisories through press releases and its Pak NDMA Disaster Alert app. No public machine-readable feed was confirmed. Ask NDMA for an official data-sharing arrangement, then set ALERT_NDMA_CAP_URL.',
  },
  {
    id: 'ffd-cap', name: 'Flood Forecasting Division, PMD (Lahore)', urlEnv: 'ALERT_FFD_CAP_URL', tokenEnv: 'ALERT_FFD_CAP_TOKEN',
    coverage: 'Pakistan river basins', hazards: ['river_flood', 'heavy_rain'],
    docsUrl: 'https://ffd.pmd.gov.pk/',
    note: 'FFD publishes flood bulletins, advisories and river-flow data on its website. No machine-readable feed was confirmed; ask FFD for one, then set ALERT_FFD_CAP_URL.',
  },
]

function stub(k: KnownAuthority, reason: string): AlertProvider {
  return {
    id: k.id, name: k.name, origin: 'official', minIntervalMinutes: 10, staleAfterMinutes: 60, unconfiguredReason: reason,
    docs: { feedUrl: null, docsUrl: k.docsUrl, coverage: k.coverage, hazards: k.hazards, updateFrequency: 'Unknown until configured', authentication: `Optional bearer token in ${k.tokenEnv}`, limitations: k.note },
    async fetchAlerts() { throw new Error('Provider is not configured') },
  }
}

export function buildProviders(env: Env = process.env): AlertProvider[] {
  const out: AlertProvider[] = []
  for (const k of KNOWN) {
    const url = env[k.urlEnv]?.trim()
    if (!url) { out.push(stub(k, `Not configured: set ${k.urlEnv} to the authority's official CAP feed URL.`)); continue }
    const cfg: CapFeedConfig = { id: k.id, name: k.name, url, coverage: k.coverage, hazards: k.hazards, docsUrl: k.docsUrl, authTokenEnv: env[k.tokenEnv] ? k.tokenEnv : undefined }
    out.push(createCapFeedProvider(cfg, (n) => env[n]))
  }
  // Any other official CAP feed (another country's met service, a provincial authority, ...).
  try {
    const extra = JSON.parse(env.ALERT_CAP_FEEDS || '[]')
    if (Array.isArray(extra)) {
      for (const raw of extra.slice(0, 20)) {
        if (!raw || typeof raw.id !== 'string' || typeof raw.url !== 'string' || typeof raw.name !== 'string') continue
        const id = `cap-${raw.id.replace(/[^a-z0-9-]/gi, '').toLowerCase().slice(0, 40)}`
        if (out.some((p) => p.id === id)) continue
        out.push(createCapFeedProvider({ ...raw, id, coverage: typeof raw.coverage === 'string' ? raw.coverage : 'Not stated' } as CapFeedConfig, (n) => env[n]))
      }
    }
  } catch { /* malformed ALERT_CAP_FEEDS: ignore; the admin page shows no extra feeds */ }
  out.push(createUsgsProvider(env), createOpenMeteoProvider(env))
  return out
}
