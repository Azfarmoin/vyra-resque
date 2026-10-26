// Reviewed-content model for the Hazards & Precautions center. Pure types, no React.
import type { SceneId } from './scenes'

export const HAZARD_IDS = ['flood', 'urban-flood', 'earthquake', 'fire', 'collapse', 'storm', 'landslide', 'heat', 'electrical', 'road', 'chemical', 'tsunami'] as const
export type HazardId = (typeof HAZARD_IDS)[number]
export const PHASES = ['before', 'during', 'waiting', 'after'] as const
export type Phase = (typeof PHASES)[number]

export interface Step {
  id: string
  title: string // short, imperative
  scene: SceneId // illustration; its default alt text describes it
  do: string[]
  dont: string[]
  remember?: string
  detail?: string // expandable extra explanation
}

export interface WaitingScenario { id: string; label: string; when: string; steps: Step[] }

export interface Source { org: string; title: string; url: string; checked: boolean /* URL opened and read while writing this content */ }

export interface HazardGuide {
  id: HazardId
  title: string
  short: string
  icon: 'droplet' | 'flame' | 'alert' | 'wave' | 'road' | 'pulse' | 'shield' | 'pin' | 'info' | 'heart'
  group: 'water' | 'ground' | 'fire' | 'weather' | 'other'
  keywords: string[]
  scope: string // when this guide applies / geographic relevance
  before: Step[]
  during: Step[]
  waiting: WaitingScenario[]
  after: Step[]
  // Short actions used by the "What should I do right now?" checklist. Reviewed with the guide; most urgent first.
  quick: { danger: string[]; trapped: string[]; injured: string[]; waiting: string[]; safe: string[] }
  related: HazardId[] // other guides that may also apply at the same time
  sources: Source[]
  content_checked_on: string // ISO date the text was last checked against the sources
  expert_reviewed: { by: string; on: string } | null // set by an administrator after professional review
}

export type Guide = HazardGuide
