// Canned model outputs for the photo-analysis tests (no real model, no paid calls).
import type { ModelOutput, PhotoAnalysisResult } from '../../src/lib/photoAnalysis/schema'
import { sanitizeOutput } from '../../src/lib/photoAnalysis/safety'
import type { ModelCall } from '../../src/lib/photoAnalysis/model'

export const SCENARIOS: Record<string, ModelOutput> = {
  flood: {
    detected_incident_types: ['flooding', 'road_blockage'],
    visual_observations: ['Water is covering part of a road.', 'Several parked cars stand in the water.'],
    possible_hazards: ['Road access may be obstructed.', 'Water may be deeper than it looks.'],
    damage_indicators: [],
    possible_road_blockages: ['Floodwater covers the carriageway.'],
    suggested_report_title: 'Floodwater reported on road',
    suggested_description: 'Water is visibly covering a section of the road in the uploaded image.',
    suggested_severity: 'moderate',
    confidence: 'medium',
    limitations: ['Water depth and current conditions cannot be established from the image.'],
  },
  fire: {
    detected_incident_types: ['fire', 'smoke'],
    visual_observations: ['Flames are visible at the upper floor of a building.', 'Dark smoke rises above the roof.'],
    possible_hazards: ['Fire may spread to neighbouring buildings.'],
    damage_indicators: ['Scorching around the window frames.'],
    possible_road_blockages: [],
    suggested_report_title: 'Building fire with heavy smoke',
    suggested_description: 'Flames and dark smoke are visible from the upper floor of a building.',
    suggested_severity: 'high',
    confidence: 'high',
    limitations: ['Whether anyone is inside cannot be determined.'],
  },
  structural: {
    detected_incident_types: ['building_collapse', 'debris'],
    visual_observations: ['Part of a multi-storey wall has fallen, leaving exposed floors.', 'Rubble covers the ground in front.'],
    possible_hazards: ['Remaining structure may be unstable.', 'People could be trapped under rubble.'],
    damage_indicators: ['Collapsed wall section', 'Cracked columns'],
    possible_road_blockages: ['Rubble partly covers the street.'],
    suggested_report_title: 'Partially collapsed building',
    suggested_description: 'A section of a building has collapsed and rubble covers the area in front of it.',
    suggested_severity: 'high',
    confidence: 'medium',
    limitations: ['Structural condition cannot be judged from a photo.'],
  },
  blockedRoad: {
    detected_incident_types: ['road_blockage', 'fallen_tree'],
    visual_observations: ['A large tree lies across the full width of a road.'],
    possible_hazards: ['Vehicles may not be able to pass.'],
    damage_indicators: [],
    possible_road_blockages: ['Fallen tree blocks both lanes.'],
    suggested_report_title: 'Fallen tree blocking road',
    suggested_description: 'A tree has fallen across the road and appears to block both lanes.',
    suggested_severity: 'low',
    confidence: 'medium',
    limitations: ['Whether a way around exists cannot be seen.'],
  },
  none: {
    detected_incident_types: ['no_disaster_evidence'],
    visual_observations: ['A street with parked cars on a dry day.'],
    possible_hazards: [],
    damage_indicators: [],
    possible_road_blockages: [],
    suggested_report_title: '',
    suggested_description: '',
    suggested_severity: 'not_determined',
    confidence: 'medium',
    limitations: [],
  },
  ambiguous: {
    detected_incident_types: ['unclear'],
    visual_observations: ['A dark, blurry image.'],
    possible_hazards: [],
    damage_indicators: [],
    possible_road_blockages: [],
    suggested_report_title: '',
    suggested_description: '',
    suggested_severity: 'high', // the model overreaches: code must ignore it
    confidence: 'low',
    limitations: ['Image is too dark to tell what it shows.'],
  },
}

export function callFor(name: keyof typeof SCENARIOS | ModelOutput, at = '2026-10-24T09:00:00.000Z'): ModelCall {
  const raw = typeof name === 'string' ? SCENARIOS[name] : name
  const { result, removed } = sanitizeOutput(raw)
  const full: PhotoAnalysisResult = { ...result, removed_statements: removed, analysis_status: 'completed', analyzed_at: at, model_provider: 'anthropic', model_version: 'mock-vision-1' }
  return { ok: true, result: full }
}

/** A fetch that answers like the Anthropic Messages API with a forced tool call. */
export function mockAnthropic(input: unknown, calls: { body: Record<string, unknown> }[] = []): typeof fetch {
  return async (_url, init) => {
    calls.push({ body: JSON.parse(String(init?.body)) })
    return new Response(JSON.stringify({ content: [{ type: 'tool_use', name: 'submit_photo_analysis', input }] }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
}
