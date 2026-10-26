import { chemical, fire, heat, storm } from './content/air'
import { collapse, earthquake, landslide } from './content/ground'
import { electrical, road } from './content/other'
import { flood, tsunami, urbanFlood } from './content/water'
import { HAZARD_IDS, type HazardGuide, type HazardId } from './types'

export * from './types'
export { SCENES, SCENE_IDS, type SceneId } from './scenes'
export { PHASE_INFO, WAITING_SAFETY_FIRST, INJURY_GENERAL } from './content/common'

export const GUIDES: HazardGuide[] = [flood, urbanFlood, earthquake, fire, collapse, storm, landslide, heat, electrical, road, chemical, tsunami]
const BY_ID = new Map(GUIDES.map((g) => [g.id, g]))
export const getGuide = (id: string): HazardGuide | null => BY_ID.get(id as HazardId) ?? null
export const isHazardId = (s: string): s is HazardId => (HAZARD_IDS as readonly string[]).includes(s)

export const GROUP_LABELS = { water: 'Water', ground: 'Ground and buildings', fire: 'Fire', weather: 'Weather and heat', other: 'Other hazards' } as const

export function searchGuides(q: string, group: string, list: HazardGuide[] = GUIDES): HazardGuide[] {
  const needle = q.trim().toLowerCase()
  return list.filter((g) => (group === 'all' || g.group === group) && (!needle || [g.title, g.short, ...g.keywords].some((s) => s.toLowerCase().includes(needle))))
}

// ---- links from the rest of VYRA --------------------------------------------------------------------------------
// Report danger types (src/lib/constants.ts DANGERS) -> guide.
export const DANGER_TO_GUIDE: Record<string, HazardId | null> = {
  trapped: 'collapse', drowning: 'flood', rising_water: 'flood', building_collapse: 'collapse', fire: 'fire', electrocution: 'electrical', landslide: 'landslide',
  gas_leak: 'chemical', extreme_heat: 'heat', earthquake: 'earthquake', blocked_road: 'road', medical_emergency: null, stranded: null, no_shelter: null, no_food_water: null, other: null, none: null,
}
// Disaster zone hazard_type (src/lib/zones/types.ts) -> guide.
export const ZONE_HAZARD_TO_GUIDE: Record<string, HazardId | null> = {
  flood: 'flood', fire: 'fire', storm: 'storm', landslide: 'landslide', earthquake: 'earthquake', heat: 'heat', chemical: 'chemical', structural: 'collapse', infrastructure: 'road', other: null,
}
export const guidesForDangers = (dangers: string[]): HazardId[] => [...new Set(dangers.map((d) => DANGER_TO_GUIDE[d]).filter((x): x is HazardId => !!x))]

// Free-text labels (for example from an image classifier). The result is only a pointer to a guide: it never means the hazard is real.
const LABELS: [RegExp, HazardId][] = [
  [/urban.?flood|waterlog|(street|road|city|town)s?\W.*flood|flood\w*\W+(street|road|city|town)/i, 'urban-flood'], [/flood|inundat|rising water/i, 'flood'], [/earthquake|quake/i, 'earthquake'], [/fire|smoke|flame|burn/i, 'fire'],
  [/collapse|rubble|crack|structural|debris/i, 'collapse'], [/cyclone|storm|hurricane|wind/i, 'storm'], [/landslide|mudslide|rockfall/i, 'landslide'], [/heat/i, 'heat'],
  [/power.?line|electric|wire|live cable|transformer/i, 'electrical'], [/road|accident|crash|vehicle|blocked/i, 'road'], [/chemical|spill|gas|fumes|toxic/i, 'chemical'], [/tsunami/i, 'tsunami'],
]
export const guideFromLabel = (label: string): HazardId | null => LABELS.find(([re]) => re.test(label))?.[1] ?? null
export const guideHref = (id: HazardId, phase?: string) => `/safety/${id}${phase ? `#${phase}` : ''}`
