// Which imagery providers exist and whether they can be used right now. Configured by environment variables;
// tests replace the whole set with setSatelliteProviders.
import { getStore } from '../../db'
import { openUrl } from '../raster/geotiffIo'
import { cdseSentinelHub } from './cdse'
import { demoEnabled, demoProvider } from './demo'
import { planetaryComputer } from './planetaryComputer'
import { uploadProvider } from './userUpload'
import type { ImageryProvider, ProviderDeps } from './types'
import type { ProviderId } from '../types'

const defaultDeps = (): ProviderDeps => ({ fetch: (...a) => fetch(...a), openTiff: openUrl, now: () => Date.now() })
let override: ImageryProvider[] | null = null
export const setSatelliteProviders = (p: ImageryProvider[] | null) => { override = p }

export function getProviders(deps: ProviderDeps = defaultDeps(), env: NodeJS.ProcessEnv = process.env): ImageryProvider[] {
  if (override) return override
  const enabled = new Set((env.SATELLITE_PROVIDERS || 'planetary-computer,cdse-sentinelhub,user-upload').split(',').map((s) => s.trim()).filter(Boolean))
  const all: ImageryProvider[] = [planetaryComputer(deps, env), cdseSentinelHub(deps, env), uploadProvider(), demoProvider(() => demoEnabled(env, getStore().mode))]
  return all.filter((p) => p.id === 'demo' || enabled.has(p.id))
}
export const getProvider = (id: ProviderId | string) => getProviders().find((p) => p.id === id) ?? null
