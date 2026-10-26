// Places a person can choose to receive warnings for. Coordinates are approximate city / area centres,
// which is exactly how the matching treats them ("area_centre": a stand-in for the whole area).
import type { SavedLocation } from './types'

export const PLACE_CHOICES: { label: string; lat: number; lng: number }[] = [
  { label: 'Karachi', lat: 24.8607, lng: 67.0011 },
  { label: 'Lahore', lat: 31.5204, lng: 74.3587 },
  { label: 'Islamabad', lat: 33.6844, lng: 73.0479 },
  { label: 'Rawalpindi', lat: 33.5651, lng: 73.0169 },
  { label: 'Peshawar', lat: 34.0151, lng: 71.5249 },
  { label: 'Quetta', lat: 30.1798, lng: 66.975 },
  { label: 'Multan', lat: 30.1575, lng: 71.5249 },
  { label: 'Hyderabad', lat: 25.396, lng: 68.3578 },
  { label: 'Faisalabad', lat: 31.4504, lng: 73.135 },
  { label: 'Gilgit', lat: 35.9208, lng: 74.308 },
]

export const LOCATIONS_KEY = 'vyra.alerts.locations.v1'
export const MAX_LOCATIONS = 5

export function readLocations(storage: Pick<Storage, 'getItem'>): SavedLocation[] {
  try {
    const arr = JSON.parse(storage.getItem(LOCATIONS_KEY) || '[]')
    return Array.isArray(arr) ? arr.filter((l) => l && typeof l.label === 'string' && Math.abs(l.lat) <= 90 && Math.abs(l.lng) <= 180).slice(0, MAX_LOCATIONS) : []
  } catch { return [] }
}
export function writeLocations(storage: Pick<Storage, 'setItem'>, list: SavedLocation[]) {
  try { storage.setItem(LOCATIONS_KEY, JSON.stringify(list.slice(0, MAX_LOCATIONS))) } catch { /* ignore */ }
}
export const newLocationId = () => `loc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
