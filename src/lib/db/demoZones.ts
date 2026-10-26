// SIMULATED zones for the demo scenario (urban flooding in Karachi). Boundaries are invented for the
// demo and are labelled as such in each description. Never used with a real Supabase project.
import { zoneBBox } from '../zones/rules'
import type { DisasterZone, FeedStatus, Position, ZoneGeometry } from '../zones/types'

// Offsets are [dLat, dLng] from a centre, so a polygon reads as a hand-drawn shape.
const poly = (lat: number, lng: number, offsets: [number, number][]): ZoneGeometry => {
  const ring = offsets.map(([a, b]) => [lng + b, lat + a] as Position)
  return { type: 'Polygon', coordinates: [[...ring, ring[0]]] }
}
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()
const hoursAhead = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString()
const uid = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const SIM = ' (SIMULATED demo boundary)'

type Seed = Partial<DisasterZone> & Pick<DisasterZone, 'name' | 'zone_type' | 'severity' | 'hazard_type' | 'geometry' | 'description' | 'verification_status' | 'source_type'>

function make(n: number, s: Seed): DisasterZone {
  const base: DisasterZone = {
    id: uid(n), boundary_kind: s.geometry.type === 'LineString' ? 'road' : s.geometry.type === 'Point' ? 'circle' : 'drawn', boundary_quality: 'approximate',
    radius_m: null, radius_basis: null, precautions: null, status_detail: null, evacuation_status: null, source_name: null, source_url: null,
    external_id: null, feed_id: null, lifecycle: 'active', valid_from: hoursAgo(6), valid_until: hoursAhead(24), related_report_ids: [], related_shelter_ids: [], related_road_ids: [],
    bbox: [0, 0, 0, 0], revision: 1, change_reason: null, source_updated_at: null, created_by: 'seed', created_by_name: 'Demo seed', updated_by: 'seed', created_at: hoursAgo(6), updated_at: hoursAgo(1), ...s,
  }
  base.bbox = zoneBBox(base)
  return base
}

export function demoZones(): DisasterZone[] {
  return [
    make(1, {
      name: 'Lyari nullah flood area', zone_type: 'danger', severity: 'extreme', hazard_type: 'flood', verification_status: 'official', source_type: 'official_manual',
      source_name: 'Demo Flood Control Cell', source_url: 'https://example.org/simulated-warning-1', boundary_quality: 'official', boundary_kind: 'administrative',
      geometry: poly(24.868, 66.993, [[0.009, -0.012], [0.011, 0.008], [0.002, 0.014], [-0.01, 0.01], [-0.012, -0.006], [-0.003, -0.015]]),
      description: 'Water is above 1 m along the nullah and rising.' + SIM, precautions: 'Do not enter the area. Move to upper floors or roofs only if you cannot leave, and call for rescue. Never walk or drive through flood water.',
      related_report_ids: [], updated_at: hoursAgo(0.5),
    }),
    make(2, {
      name: 'Korangi low-lying streets', zone_type: 'elevated', severity: 'high', hazard_type: 'flood', verification_status: 'human_verified', source_type: 'responder',
      source_name: 'Demo field team (verified on site)', geometry: poly(24.833, 67.1, [[0.008, -0.014], [0.009, 0.012], [-0.004, 0.016], [-0.009, 0.004], [-0.007, -0.011]]),
      description: 'Knee-deep water reported by several residents and confirmed by a responder. Boundary is approximate.' + SIM, precautions: 'Avoid the area if you can. Expect closed roads.', updated_at: hoursAgo(2),
    }),
    make(3, {
      name: 'Orangi nullah bridge surroundings', zone_type: 'caution', severity: 'moderate', hazard_type: 'structural', verification_status: 'unverified', source_type: 'citizen_report',
      source_name: 'Resident report (not yet checked)', geometry: poly(24.948, 66.989, [[0.004, -0.005], [0.005, 0.006], [-0.003, 0.006], [-0.005, -0.004]]),
      description: 'Residents report cracks in the bridge structure. Not verified.' + SIM, precautions: 'Use another crossing if possible.', updated_at: hoursAgo(9),
    }),
    make(4, {
      name: 'Malir river embankment evacuation', zone_type: 'evacuation', severity: 'high', hazard_type: 'flood', evacuation_status: 'order', verification_status: 'official', source_type: 'official_manual',
      source_name: 'Demo District Administration', source_url: 'https://example.org/simulated-order-4', boundary_quality: 'official', boundary_kind: 'administrative',
      geometry: poly(24.893, 67.205, [[0.011, -0.011], [0.012, 0.012], [-0.002, 0.015], [-0.012, 0.006], [-0.01, -0.01]]),
      description: 'Residents must leave before the embankment is overtopped.' + SIM, precautions: 'Take documents, medicines and water. Follow instructions from officials. Go to a shelter marked on the map.', related_shelter_ids: [],
    }),
    make(5, {
      name: 'Gulshan block 13 - proposed evacuation', zone_type: 'evacuation', severity: 'moderate', hazard_type: 'flood', evacuation_status: 'proposed', verification_status: 'human_verified', source_type: 'responder',
      source_name: 'Demo dispatcher desk', geometry: poly(24.92, 67.098, [[0.004, -0.005], [0.005, 0.005], [-0.004, 0.006], [-0.005, -0.004]]),
      description: 'A plan being prepared in case water reaches the apartment blocks. THIS IS NOT AN ORDER.' + SIM, precautions: 'Be ready to move. Wait for an official instruction.',
    }),
    make(6, {
      name: 'Saddar community hall shelter', zone_type: 'shelter', severity: 'low', hazard_type: 'other', verification_status: 'human_verified', source_type: 'responder',
      source_name: 'Demo shelter coordinator', boundary_quality: 'surveyed', geometry: poly(24.8558, 67.0236, [[0.0008, -0.001], [0.0009, 0.001], [-0.0008, 0.001], [-0.0009, -0.001]]),
      description: 'Verified shelter with water and first aid.' + SIM, precautions: 'A shelter marker does not mean the streets around it are safe. Check the zones around you before travelling.', valid_until: null,
    }),
    make(7, {
      name: 'Keamari harbour - restricted access', zone_type: 'restricted', severity: 'unknown', hazard_type: 'infrastructure', verification_status: 'human_verified', source_type: 'responder',
      source_name: 'Demo port security', status_detail: 'Access closed by port security after the wall collapse. Exact extent of the damage is still being assessed, so the boundary is uncertain.',
      geometry: poly(24.8215, 66.978, [[0.003, -0.004], [0.004, 0.004], [-0.003, 0.005], [-0.004, -0.003]]), description: 'Part of the harbour wall collapsed.' + SIM, precautions: 'Keep clear until the area is reopened.',
    }),
    make(8, {
      name: 'Landhi gas leak exclusion circle', zone_type: 'danger', severity: 'high', hazard_type: 'chemical', verification_status: 'official', source_type: 'official_manual', source_name: 'Demo Fire Service',
      boundary_kind: 'circle', boundary_quality: 'official', geometry: { type: 'Point', coordinates: [67.198, 24.846] }, radius_m: 500,
      radius_basis: 'Standard 500 m isolation distance used by the demo fire service for a gas leak (simulated).', description: 'Gas leak at a storage yard.' + SIM, precautions: 'Move upwind and away. No flames or sparks.',
    }),
    make(9, {
      name: 'Lyari Expressway underpass - hazardous', zone_type: 'danger', severity: 'high', hazard_type: 'infrastructure', verification_status: 'human_verified', source_type: 'responder', source_name: 'Demo traffic police',
      boundary_kind: 'road', geometry: { type: 'LineString', coordinates: [[66.988, 24.862], [66.995, 24.866], [67.001, 24.87]] }, description: 'Underpass flooded; vehicles stranded.' + SIM, precautions: 'Do not drive through. Choose another route and check it is open.',
    }),
    make(10, {
      name: 'Clifton coastal surge (ended)', zone_type: 'elevated', severity: 'moderate', hazard_type: 'storm', verification_status: 'official', source_type: 'official_manual', source_name: 'Demo Weather Office',
      geometry: poly(24.814, 67.03, [[0.006, -0.008], [0.007, 0.008], [-0.006, 0.009], [-0.007, -0.006]]), description: 'Coastal surge warning that has now ended.' + SIM, valid_from: hoursAgo(30), valid_until: hoursAgo(3), updated_at: hoursAgo(30),
    }),
    make(11, {
      name: 'North Nazimabad evacuation (cancelled)', zone_type: 'evacuation', severity: 'moderate', hazard_type: 'flood', evacuation_status: 'order', verification_status: 'official', source_type: 'official_manual', source_name: 'Demo District Administration',
      lifecycle: 'cancelled', change_reason: 'Water level fell below the warning mark.', geometry: poly(24.942, 67.04, [[0.005, -0.006], [0.006, 0.006], [-0.005, 0.007], [-0.006, -0.005]]),
      description: 'Evacuation order that was lifted.' + SIM, updated_at: hoursAgo(2),
    }),
    make(12, {
      name: 'AI-suggested risk near Landhi (draft)', zone_type: 'caution', severity: 'unknown', hazard_type: 'flood', verification_status: 'ai_suggested', source_type: 'ai_suggestion', lifecycle: 'draft', source_name: 'VYRA hazard analysis',
      geometry: poly(24.845, 67.19, [[0.004, -0.005], [0.005, 0.005], [-0.004, 0.006], [-0.005, -0.004]]), description: 'Several reports cluster here. A person must review this before it is published.' + SIM,
    }),
  ]
}

export function demoFeedStatuses(): FeedStatus[] {
  return []
}
