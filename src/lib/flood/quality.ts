// Data-quality indicators, assumptions and limitations. These are generated from what was ACTUALLY used in the run, so the
// text can never claim more than the inputs support.
import type { ElevationMeta } from './elevation'
import type { RainfallResult } from './rainfall'
import { status } from './assets'
import { TIERS, type DatasetStatus, type ScenarioKind, type TierId } from './types'

export function terrainStatus(meta: ElevationMeta, effectiveCellM: number, unassessedFraction: number, maxDepthM: number | null): DatasetStatus {
  const notes: string[] = [...meta.notes]
  let level: DatasetStatus['level'] = effectiveCellM <= 10 ? 'good' : effectiveCellM <= 30 ? 'fair' : 'poor'
  let state: DatasetStatus['state'] = 'ok'
  if (effectiveCellM > 30) notes.push(`Working resolution is about ${Math.round(effectiveCellM)} m: low resolution for a city. Streets, kerbs, underpasses, drains and embankments are far smaller than one cell and are not represented.`)
  else notes.push(`Working resolution is about ${Math.round(effectiveCellM)} m.`)
  if (meta.kind === 'dsm') notes.push('This is a surface model: roofs and tree canopy are treated as ground, which distorts where water can go.')
  if (meta.verticalErrorM == null) { notes.push('The vertical accuracy of this elevation data is not recorded, so the reliability of any depth cannot be judged.'); if (level === 'good') level = 'fair' }
  else {
    notes.push(`Stated vertical error about ${meta.verticalErrorM} m.`)
    if (maxDepthM != null && maxDepthM <= meta.verticalErrorM) { level = 'poor'; notes.push(`The deepest estimated water (${maxDepthM} m) is no more than the vertical error: these depths are within the noise of the terrain data.`) }
    else if (meta.verticalErrorM >= 1) level = level === 'good' ? 'fair' : level
  }
  if (!meta.vintage) notes.push('The date of the elevation survey is not recorded. Ground in Karachi changes quickly (construction, reclamation, dredging).')
  if (!meta.verticalDatum) notes.push('The vertical datum is not recorded: a water level typed in must be in the same datum as the terrain.')
  if (unassessedFraction > 0) { state = 'partial'; if (level === 'good') level = 'fair'; notes.push(`${Math.round(unassessedFraction * 1000) / 10}% of the area has no terrain data and was not assessed.`) }
  if (meta.synthetic) { state = 'synthetic'; level = 'poor'; notes.unshift('SYNTHETIC TEST TERRAIN, NOT REAL GROUND. Results describe an invented landscape and mean nothing about Karachi.') }
  return status({ id: 'terrain', label: 'Terrain (elevation model)', group: 'terrain', state, level, source: meta.name, asOf: meta.vintage, resolutionM: Math.round(effectiveCellM * 10) / 10, notes })
}

export function rainfallStatus(r: RainfallResult): DatasetStatus {
  const manual = r.kind === 'manual'
  return status({
    id: 'rainfall', label: 'Rainfall input', group: 'rainfall', level: manual ? 'fair' : 'poor', source: r.sourceName, asOf: r.asOf, count: null,
    notes: manual ? ['A rainfall total typed in by a person. VYRA cannot check where it came from.', ...r.notes] : r.notes,
  })
}

export const missingStatus = (id: string, label: string, group: DatasetStatus['group'], note: string): DatasetStatus =>
  status({ id, label, group, state: 'not_configured', level: 'missing', notes: [note] })

export function headlineFor(tier: TierId, datasets: DatasetStatus[]): string {
  const bad = datasets.filter((d) => d.state === 'failed' || d.state === 'not_configured' || d.state === 'stale' || d.state === 'truncated' || d.level === 'poor').length
  const base = { hypothetical_overlay: 'Illustrative only: no terrain or hydrology behind this overlay.', terrain_estimate: 'Screening estimate: not a hydraulic simulation, depths are indicative.', imported_unvalidated: 'Imported model output with no complete validation record.', validated_hydraulic: 'Imported model output with a validation record supplied by the importer.' }[tier]
  return bad ? `${base} ${bad} dataset${bad > 1 ? 's are' : ' is'} missing, stale, low resolution or incomplete (see data quality).` : base
}

export function assumptionsFor(kind: ScenarioKind, ctx: { depthM?: number; level?: number; connectivity?: string; seeds?: number; effectiveMm?: number; rainfallMm?: number; runoff?: number; drainageMm?: number; infiltrationMm?: number; minDepthM: number; waterLevelUsed?: number }): string[] {
  const common = [`A location counts as flooded when the estimated depth is at least ${ctx.minDepthM} m.`, 'Counts of roads, buildings, shelters and other assets are approximate: they come from intersecting positions with the estimated extent.', 'Water is assumed to stay where the estimate puts it; the model has no time dimension, so it says nothing about when water arrives, how fast it rises or how long it stays.']
  if (kind === 'hypothetical_overlay') return [`Every point in the selected area is assumed to be under ${ctx.depthM} m of water above ground. No terrain is used, so low and high ground are treated alike.`, 'The depth was chosen by a person; VYRA has not checked that it is physically plausible for this place.', ...common]
  if (kind === 'terrain_bathtub') return [
    `The water surface is flat at ${ctx.level} m, in the vertical datum of the elevation data.`,
    ctx.connectivity === 'seeded' ? `Water spreads from ${ctx.seeds} source point(s) only through neighbouring ground lower than the water level (8-neighbour connectivity). Ground that is low but separated by higher ground stays dry.` : 'Connectivity is OFF: every cell below the water level is flooded even if water could not reach it. This over-states flooding inland.',
    'Walls, embankments, culverts, pumps, drains, tide gates and buildings are not represented unless they happen to be visible in the elevation data.',
    ...common]
  if (kind === 'terrain_rainfall') return [
    `Effective rainfall = ${ctx.rainfallMm} mm x runoff coefficient ${ctx.runoff} - drainage capacity ${ctx.drainageMm} mm - infiltration ${ctx.infiltrationMm} mm = ${Math.round((ctx.effectiveMm ?? 0) * 10) / 10} mm.`,
    'That depth is spread over the whole selected area and poured into the lowest ground first. Water moves freely inside the area, nothing flows in from outside and nothing flows out (a closed basin).',
    'The drainage capacity is a single number typed in by a person; VYRA does not model the drainage network.',
    ...common]
  return ['Depths and extent are exactly as supplied in the imported model output; VYRA did not alter them.', ...common]
}

export function limitationsFor(tier: TierId, ctx: { effectiveCellM?: number | null; maxDepthM?: number | null; kind: ScenarioKind }): string[] {
  const l: string[] = ['This is an estimate. It is not a forecast, a warning or an official flood map, and it must never be used to declare an area or route safe.']
  if (tier === 'hypothetical_overlay') l.push('No terrain, rainfall, drainage or river data is used. Depth is uniform, so depth bands and "where the water goes" are not available.', 'It shows what would be affected if the chosen depth occurred, nothing about how likely that is.')
  if (tier === 'terrain_estimate') {
    l.push('Not a hydraulic simulation: no flow routing, momentum, friction, drainage network, structures, tides, river or sewer surcharge, and no time dimension.', 'Depths are indicative. VYRA has no validation of this method against measured Karachi floods, so do not quote a depth for a street or building.', 'Elevation data errors of a metre or more are common and are comparable to the depths of an urban flood.')
    if (ctx.effectiveCellM && ctx.effectiveCellM > 30) l.push(`At about ${Math.round(ctx.effectiveCellM)} m per cell, street-scale features are invisible. Use only to compare broad areas.`)
    if (ctx.kind === 'terrain_rainfall') l.push('Rainfall ponding fills the lowest ground first and ignores where the rain actually falls and flows. It can place water in depressions that drain in reality, and miss water carried in from upstream.')
  }
  if (tier === 'imported_unvalidated') l.push('The model output was not validated in VYRA and no complete validation record was supplied. Treat it as an unverified scenario.', 'VYRA did not run the model and cannot check its inputs or settings.')
  if (tier === 'validated_hydraulic') l.push('VYRA did not run or check the hydraulic model. "Validated" reflects the validation record supplied by the importer; verify it against the cited report.', 'A model validated for one event or area may not hold for other conditions.')
  l.push('Affected-asset counts depend on the completeness and age of the asset datasets; unknowns are shown as unknown, not as zero.', 'Supplementary evidence only: nothing here changes incident priorities, dispatches, routes or shelter status. A dispatcher decides.')
  return l
}

export { TIERS }
