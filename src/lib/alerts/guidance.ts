// General preparedness guidance per hazard.
//
// IMPORTANT - review status: these checklists were drafted from the public guidance pages listed in `sources`,
// but they have NOT been reviewed by a qualified emergency-management professional or checked against Pakistan's
// NDMA / PDMA guidance. `reviewedAt` is therefore null and the UI says "pending review". An authorised reviewer
// should compare each item with the sources (and local authority guidance), then set `reviewedAt` and `reviewedBy`.
//
// The guidance is deliberately generic. It never names an evacuation destination or route: those must come from the
// authority's own instructions, which VYRA shows verbatim in the alert.

import type { HazardType } from './types'

export interface GuidanceSource { title: string; organisation: string; url: string }
export interface Guidance {
  hazard: HazardType
  steps: string[]
  sources: GuidanceSource[]
  reviewedAt: string | null
  reviewedBy: string | null
}

const READY = (title: string, path: string): GuidanceSource => ({ title, organisation: 'Ready.gov (U.S. Federal Emergency Management Agency)', url: `https://www.ready.gov/${path}` })

const COMMON = [
  'Keep your phone charged and your emergency contacts written down as well as saved.',
  'Prepare drinking water, essential supplies and any regular medicines.',
  'Follow official evacuation or shelter instructions from your local authorities. VYRA does not choose a destination or route for you.',
]

export const GUIDANCE: Record<HazardType, Guidance> = {
  heavy_rain: {
    hazard: 'heavy_rain',
    steps: [
      'Avoid walking or driving through floodwater; even shallow moving water can knock a person down and a car can be swept away.',
      'Move away from flood-prone areas, drains and low ground when authorities advise it.',
      'Keep valuables and documents above floor level.',
      ...COMMON,
      'Stay away from downed or hanging power lines and anything touching floodwater.',
    ],
    sources: [READY('Floods', 'floods')],
    reviewedAt: null, reviewedBy: null,
  },
  river_flood: {
    hazard: 'river_flood',
    steps: [
      'Stay away from riverbanks, bridges and low-lying land near rivers while levels are rising.',
      'Do not cross floodwater on foot or by vehicle.',
      ...COMMON,
      'Check official river-level and flood bulletins from the relevant authority rather than relying on social media.',
    ],
    sources: [READY('Floods', 'floods')],
    reviewedAt: null, reviewedBy: null,
  },
  cyclone: {
    hazard: 'cyclone',
    steps: [
      'Secure or bring inside loose objects; stay away from windows and the coast during strong winds and surge.',
      ...COMMON,
      'Listen for updates from the national meteorological service; conditions can change quickly.',
    ],
    sources: [READY('Hurricanes', 'hurricanes')],
    reviewedAt: null, reviewedBy: null,
  },
  heatwave: {
    hazard: 'heatwave',
    steps: [
      'Drink water regularly, even if you do not feel thirsty; avoid strenuous activity in the hottest part of the day.',
      'Stay in shade or cooled spaces where possible; check on older people, young children and anyone who lives alone.',
      'Never leave a person or pet in a parked vehicle.',
      'Seek medical help urgently for confusion, fainting, very high body temperature or stopped sweating.',
    ],
    sources: [READY('Extreme Heat', 'heat'), { title: 'Climate change, heat and health', organisation: 'World Health Organization', url: 'https://www.who.int/news-room/fact-sheets/detail/climate-change-heat-and-health' }],
    reviewedAt: null, reviewedBy: null,
  },
  thunderstorm_wind: {
    hazard: 'thunderstorm_wind',
    steps: [
      'Go indoors during thunderstorms; stay away from windows, trees, poles and open water.',
      'Secure loose objects that strong wind could throw.',
      'Stay away from downed power lines and damaged structures.',
      ...COMMON.slice(0, 1),
    ],
    sources: [READY('Thunderstorms and Lightning', 'thunderstorms-lightning')],
    reviewedAt: null, reviewedBy: null,
  },
  landslide: {
    hazard: 'landslide',
    steps: [
      'Stay away from steep slopes, cuttings and drainage channels during and after heavy rain.',
      'Watch for warning signs such as new cracks, tilting trees or poles, or unusual sounds, and leave the area if you notice them.',
      'Do not return to a slope area until authorities say it is safe.',
      ...COMMON,
    ],
    sources: [READY('Landslides and Debris Flow', 'landslides-debris-flow')],
    reviewedAt: null, reviewedBy: null,
  },
  wildfire: {
    hazard: 'wildfire',
    steps: [
      'Follow evacuation orders immediately when issued; do not wait to see the fire.',
      'Limit time outdoors if smoke is heavy; keep windows closed where possible.',
      ...COMMON.slice(0, 2),
    ],
    sources: [READY('Wildfires', 'wildfires')],
    reviewedAt: null, reviewedBy: null,
  },
  earthquake: {
    hazard: 'earthquake',
    steps: [
      'During shaking: drop, cover under sturdy furniture and hold on; stay away from windows and heavy objects that can fall.',
      'Afterwards, expect aftershocks. Stay away from damaged buildings, unstable slopes and downed power lines.',
      'Earthquakes cannot currently be predicted. A recorded-earthquake notice reports something that already happened.',
      ...COMMON.slice(0, 1),
    ],
    sources: [READY('Earthquakes', 'earthquakes')],
    reviewedAt: null, reviewedBy: null,
  },
  other: {
    hazard: 'other',
    steps: ['Read the full alert and follow the instructions given by the authority that issued it.', ...COMMON],
    sources: [],
    reviewedAt: null, reviewedBy: null,
  },
}

// Shown wherever guidance appears.
export const GUIDANCE_DISCLAIMER =
  'General preparedness guidance, drafted from the public sources listed and not yet reviewed by VYRA\'s emergency-management reviewer. Always follow instructions from your local authorities.'
