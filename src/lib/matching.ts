export const TEAM_CAPABILITIES = [
  { value: 'water_rescue', label: 'Water Rescue' },
  { value: 'medical', label: 'Medical / First Aid' },
  { value: 'search_rescue', label: 'Search & Rescue' },
  { value: 'evacuation', label: 'Evacuation / Transport' },
  { value: 'fire', label: 'Fire Response' },
  { value: 'logistics', label: 'Supplies & Logistics' }
] as const

export const RESOURCE_TYPES = [
  { value: 'boat', label: 'Boat' },
  { value: 'vehicle', label: 'Vehicle' },
  { value: 'first_aid', label: 'First Aid Kit' },
  { value: 'medical_supplies', label: 'Medical Supplies' },
  { value: 'food', label: 'Food' },
  { value: 'water', label: 'Water' }
] as const

export function capabilityLabel(value: string): string {
  return TEAM_CAPABILITIES.find(c => c.value === value)?.label ?? value
}

export function resourceTypeLabel(value: string): string {
  return RESOURCE_TYPES.find(r => r.value === value)?.label ?? value
}

export interface MatchReport {
  id: string
  location_lat: number | null
  location_lng: number | null
  location_address: string | null
  people_count: number
  immediate_danger: boolean
  injury_details: string | null
  medical_needs: string | null
}

export interface MatchTeam {
  id: string
  team_name: string
  capabilities: string[] | null
  current_location_lat: number | null
  current_location_lng: number | null
  status: string
}

export interface MatchResource {
  id: string
  resource_type: string
  quantity: number
  team_id: string | null
  status: string
  name?: string | null
}

export interface RouteHazard {
  id: string
  description: string
  location_lat: number
  location_lng: number
  radius_km: number
  severity: 'low' | 'medium' | 'high'
  active: boolean
}

export interface CaseNeeds {
  capabilities: string[]
  resourceTypes: string[]
  reasons: string[]
}

export interface TeamMatch {
  team_id: string
  team_name: string
  team_status: string
  eligible: boolean
  score: number
  distance_km: number | null
  capability_match: { required: string[]; matched: string[]; missing: string[] }
  route: { safe: boolean; hazards: { id: string; description: string; severity: string }[] }
  resources: { available: string[]; missing: string[] }
  suggested_resource_ids: string[]
  breakdown: { factor: string; points: number; max: number; detail: string }[]
  warnings: string[]
}

const MAX_USEFUL_DISTANCE_KM = 50

const toNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

// Distance (km) from point P to segment AB using a local equirectangular projection.
export function pointToSegmentKm(
  p: [number, number],
  a: [number, number],
  b: [number, number]
): number {
  const refLat = ((a[0] + b[0]) / 2) * (Math.PI / 180)
  const kmPerDegLat = 110.574
  const kmPerDegLng = 111.32 * Math.cos(refLat)
  const project = ([lat, lng]: [number, number]) => [lng * kmPerDegLng, lat * kmPerDegLat]
  const [px, py] = project(p)
  const [ax, ay] = project(a)
  const [bx, by] = project(b)
  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq))
  const cx = ax + t * dx
  const cy = ay + t * dy
  return Math.hypot(px - cx, py - cy)
}

export function inferCaseNeeds(report: MatchReport): CaseNeeds {
  const text = [report.injury_details, report.medical_needs, report.location_address]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  const capabilities = new Set<string>()
  const resourceTypes = new Set<string>()
  const reasons: string[] = []

  if (/(flood|water|drown|river|stranded|submerged|boat)/.test(text)) {
    capabilities.add('water_rescue')
    resourceTypes.add('boat')
    reasons.push('Flooding / water mentioned → water rescue team with a boat')
  }
  if (report.injury_details || report.medical_needs) {
    capabilities.add('medical')
    resourceTypes.add('first_aid')
    if (report.medical_needs) resourceTypes.add('medical_supplies')
    reasons.push('Injuries or medical needs reported → medical capability and supplies')
  }
  if (/(fire|smoke|burn)/.test(text)) {
    capabilities.add('fire')
    reasons.push('Fire mentioned → fire response capability')
  }
  if (/(trapped|collapse|rubble|debris|missing)/.test(text) || report.immediate_danger) {
    capabilities.add('search_rescue')
    reasons.push(
      report.immediate_danger
        ? 'Immediate danger to life → search & rescue capability'
        : 'Trapped / collapse mentioned → search & rescue capability'
    )
  }
  if ((report.people_count || 1) >= 5) {
    capabilities.add('evacuation')
    resourceTypes.add('vehicle')
    reasons.push(`${report.people_count} people affected → evacuation transport`)
  }
  if ((report.people_count || 1) >= 10) {
    resourceTypes.add('water')
    resourceTypes.add('food')
    reasons.push('Large group → drinking water and food')
  }
  if (capabilities.size === 0) {
    capabilities.add('search_rescue')
    reasons.push('No specific need detected → general search & rescue')
  }

  return { capabilities: Array.from(capabilities), resourceTypes: Array.from(resourceTypes), reasons }
}

export function routeHazardsBetween(
  from: [number, number],
  to: [number, number],
  hazards: RouteHazard[]
): RouteHazard[] {
  return hazards.filter(h => {
    if (!h.active) return false
    const lat = toNum(h.location_lat)
    const lng = toNum(h.location_lng)
    if (lat === null || lng === null) return false
    const radius = toNum(h.radius_km) ?? 1
    return pointToSegmentKm([lat, lng], from, to) <= radius
  })
}

export function matchTeamsToCase(
  report: MatchReport,
  teams: MatchTeam[],
  resources: MatchResource[],
  hazards: RouteHazard[]
): { needs: CaseNeeds; matches: TeamMatch[] } {
  const needs = inferCaseNeeds(report)
  const caseLat = toNum(report.location_lat)
  const caseLng = toNum(report.location_lng)
  const availableResources = resources.filter(r => r.status === 'available' && (r.quantity ?? 0) > 0)

  const matches = teams.map<TeamMatch>(team => {
    const breakdown: TeamMatch['breakdown'] = []
    const warnings: string[] = []
    const teamCaps = team.capabilities ?? []

    // Capabilities (35)
    const matched = needs.capabilities.filter(c => teamCaps.includes(c))
    const missing = needs.capabilities.filter(c => !teamCaps.includes(c))
    const capPoints = Math.round((35 * matched.length) / needs.capabilities.length)
    breakdown.push({
      factor: 'Capabilities',
      points: capPoints,
      max: 35,
      detail: missing.length
        ? `Has ${matched.length}/${needs.capabilities.length}; missing ${missing.map(capabilityLabel).join(', ')}`
        : 'Has every required capability'
    })
    if (missing.length) warnings.push(`Missing capability: ${missing.map(capabilityLabel).join(', ')}`)

    // Distance (25)
    const teamLat = toNum(team.current_location_lat)
    const teamLng = toNum(team.current_location_lng)
    const hasCoords = caseLat !== null && caseLng !== null && teamLat !== null && teamLng !== null
    let distance: number | null = null
    let distPoints = 10
    if (hasCoords) {
      distance = haversineKm(teamLat!, teamLng!, caseLat!, caseLng!)
      distPoints = Math.round(25 * Math.max(0, 1 - distance / MAX_USEFUL_DISTANCE_KM))
      breakdown.push({ factor: 'Distance', points: distPoints, max: 25, detail: `${distance.toFixed(1)} km away` })
    } else {
      breakdown.push({ factor: 'Distance', points: distPoints, max: 25, detail: 'Unknown – team or case has no GPS location' })
      warnings.push('Distance unknown (missing coordinates)')
    }

    // Route safety (20)
    let routeHazards: RouteHazard[] = []
    let routePoints = 20
    if (hasCoords) {
      routeHazards = routeHazardsBetween([teamLat!, teamLng!], [caseLat!, caseLng!], hazards)
      const worst = routeHazards.some(h => h.severity === 'high')
        ? 'high'
        : routeHazards.some(h => h.severity === 'medium')
          ? 'medium'
          : routeHazards.length
            ? 'low'
            : null
      routePoints = worst === 'high' ? 0 : worst === 'medium' ? 8 : worst === 'low' ? 14 : 20
      // A water-rescue team with a boat can cross flooded areas.
      const canCrossWater = teamCaps.includes('water_rescue')
      if (worst && canCrossWater && routeHazards.every(h => /flood|water/i.test(h.description))) {
        routePoints = Math.max(routePoints, 14)
      }
      breakdown.push({
        factor: 'Route safety',
        points: routePoints,
        max: 20,
        detail: routeHazards.length
          ? `Route passes ${routeHazards.length} hazard(s): ${routeHazards.map(h => h.description).join(', ')}`
          : 'No known hazards on direct route'
      })
      if (routeHazards.length) warnings.push(`Route hazard: ${routeHazards.map(h => `${h.description} (${h.severity})`).join(', ')}`)
    } else {
      routePoints = 10
      breakdown.push({ factor: 'Route safety', points: routePoints, max: 20, detail: 'Cannot check route without coordinates' })
    }

    // Resource availability (20)
    const suggested: string[] = []
    const availableTypes: string[] = []
    const missingTypes: string[] = []
    let resourceScore = 0
    for (const type of needs.resourceTypes) {
      const own = availableResources.find(r => r.resource_type === type && r.team_id === team.id)
      const pool = availableResources.find(r => r.resource_type === type && !r.team_id)
      if (own) {
        suggested.push(own.id)
        availableTypes.push(type)
        resourceScore += 1
      } else if (pool) {
        suggested.push(pool.id)
        availableTypes.push(type)
        resourceScore += 0.75
      } else {
        missingTypes.push(type)
      }
    }
    const resPoints = needs.resourceTypes.length
      ? Math.round((20 * resourceScore) / needs.resourceTypes.length)
      : 20
    breakdown.push({
      factor: 'Resources',
      points: resPoints,
      max: 20,
      detail: needs.resourceTypes.length
        ? missingTypes.length
          ? `Missing ${missingTypes.map(resourceTypeLabel).join(', ')}`
          : 'All required resources available'
        : 'No special resources required'
    })
    if (missingTypes.length) warnings.push(`No available ${missingTypes.map(resourceTypeLabel).join(', ')}`)

    const eligible = team.status === 'available'
    if (!eligible) warnings.unshift(`Team is ${team.status}`)

    return {
      team_id: team.id,
      team_name: team.team_name,
      team_status: team.status,
      eligible,
      score: capPoints + distPoints + routePoints + resPoints,
      distance_km: distance === null ? null : Math.round(distance * 10) / 10,
      capability_match: { required: needs.capabilities, matched, missing },
      route: {
        safe: routeHazards.length === 0,
        hazards: routeHazards.map(h => ({ id: h.id, description: h.description, severity: h.severity }))
      },
      resources: { available: availableTypes, missing: missingTypes },
      suggested_resource_ids: suggested,
      breakdown,
      warnings
    }
  })

  matches.sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.score - a.score)
  return { needs, matches }
}
