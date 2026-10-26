// Persistence for scenarios, observations and the audit log. Completely separate from incident storage:
//  * Supabase mode: tables from migration 012, written through the signed-in user's own client so Row Level Security applies.
//  * Demo mode: in-memory maps on globalThis (never touches the demo incident store).
import { randomUUID } from 'node:crypto'
import type { Responder } from '../routing/auth'
import type { AreaGeometry, BBox, ObservationRecord, ScenarioLayers, ScenarioResult, ScenarioSummary } from './types'
import type { RunOutput } from './scenario'
import { pointInArea } from './geo'

export type Actor = Pick<Responder, 'id' | 'name' | 'role' | 'db' | 'email'>

export interface StoredScenario {
  id: string
  name: string
  description: string | null
  kind: ScenarioResult['kind']
  zoneLabel: string | null
  isSimulation: true
  modelVersion: string
  computedAt: string
  createdBy: string | null
  createdByName: string | null
  createdAt: string
  updatedAt: string
  area: AreaGeometry
  inputs: unknown
  results: ScenarioResult
  layers: ScenarioLayers | null
}

export interface ScenarioListItem {
  id: string
  name: string
  kind: ScenarioResult['kind']
  tierTitle: string
  reliability: string
  zoneLabel: string | null
  createdAt: string
  createdBy: string | null
  createdByName: string | null
  floodedAreaKm2: number | null
  maxDepthM: number | null
  isSimulation: true
}

export type AuditAction = 'simulate' | 'create' | 'update' | 'delete' | 'export' | 'compare' | 'import' | 'observation'

export interface FloodRepo {
  save(run: RunOutput, meta: { name: string; description?: string | null }, actor: Actor): Promise<StoredScenario>
  list(actor: Actor): Promise<ScenarioListItem[]>
  get(id: string, actor: Actor): Promise<StoredScenario | null>
  update(id: string, patch: { name?: string; description?: string | null }, actor: Actor): Promise<StoredScenario | null>
  remove(id: string, actor: Actor): Promise<boolean>
  observations(actor: Actor, bbox?: BBox): Promise<ObservationRecord[]>
  addObservation(o: Omit<ObservationRecord, 'id' | 'verified' | 'recordedByName'>, actor: Actor): Promise<ObservationRecord>
  setObservationVerified(id: string, verified: boolean, actor: Actor): Promise<ObservationRecord | null>
  removeObservation(id: string, actor: Actor): Promise<boolean>
  audit(entry: { scenarioId?: string | null; action: AuditAction; detail?: unknown }, actor: Actor): Promise<void>
}

const listItem = (s: StoredScenario): ScenarioListItem => ({
  id: s.id, name: s.name, kind: s.kind, tierTitle: s.results.tier.title, reliability: s.results.dataQuality.reliability, zoneLabel: s.zoneLabel, createdAt: s.createdAt,
  createdBy: s.createdBy, createdByName: s.createdByName, floodedAreaKm2: s.results.summary.floodedAreaKm2, maxDepthM: s.results.summary.maxDepthM, isSimulation: true,
})
const clone = <T,>(v: T): T => structuredClone(v)

// ---- in-memory (demo) ------------------------------------------------------------------------------------------------

interface MemState { scenarios: Map<string, StoredScenario>; observations: Map<string, ObservationRecord & { recordedBy: string }>; audit: { id: string; scenarioId: string | null; action: AuditAction; actor: string; actorRole: string; detail: unknown; at: string }[] }
const g = globalThis as unknown as { __vyraFlood?: MemState }
const mem = (): MemState => (g.__vyraFlood ??= { scenarios: new Map(), observations: new Map(), audit: [] })
export const resetFloodMemory = () => { g.__vyraFlood = undefined }
export const floodAuditLog = () => mem().audit.slice()

export const memoryRepo: FloodRepo = {
  async save(run, meta, actor) {
    const now = new Date().toISOString()
    const s: StoredScenario = {
      id: randomUUID(), name: meta.name, description: meta.description ?? null, kind: run.result.kind, zoneLabel: run.result.area.label, isSimulation: true, modelVersion: run.result.modelVersion,
      computedAt: run.result.computedAt, createdBy: actor.id, createdByName: actor.name, createdAt: now, updatedAt: now, area: run.result.area.geometry, inputs: run.result.inputs, results: clone(run.result), layers: clone(run.layers),
    }
    mem().scenarios.set(s.id, s)
    return clone(s)
  },
  async list() { return [...mem().scenarios.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(listItem) },
  async get(id) { const s = mem().scenarios.get(id); return s ? clone(s) : null },
  async update(id, patch, actor) {
    const s = mem().scenarios.get(id)
    if (!s || (s.createdBy !== actor.id && actor.role !== 'admin')) return null
    if (patch.name !== undefined) s.name = patch.name
    if (patch.description !== undefined) s.description = patch.description
    s.updatedAt = new Date().toISOString()
    return clone(s)
  },
  async remove(id, actor) {
    const s = mem().scenarios.get(id)
    if (!s || (s.createdBy !== actor.id && actor.role !== 'admin')) return false
    return mem().scenarios.delete(id)
  },
  async observations(_a, bbox) {
    return [...mem().observations.values()].filter((o) => !bbox || (o.lng >= bbox[0] && o.lng <= bbox[2] && o.lat >= bbox[1] && o.lat <= bbox[3])).map(({ recordedBy: _r, ...o }) => clone(o))
  },
  async addObservation(o, actor) {
    const rec = { ...o, id: randomUUID(), verified: false, recordedByName: actor.name, recordedBy: actor.id }
    mem().observations.set(rec.id, rec)
    const { recordedBy: _r, ...out } = rec
    return out
  },
  async setObservationVerified(id, verified, actor) {
    const o = mem().observations.get(id)
    if (!o || actor.role !== 'admin') return null
    o.verified = verified
    const { recordedBy: _r, ...out } = o
    return clone(out)
  },
  async removeObservation(id, actor) {
    const o = mem().observations.get(id)
    if (!o || !(actor.role === 'admin' || (o.recordedBy === actor.id && !o.verified))) return false
    return mem().observations.delete(id)
  },
  async audit(entry, actor) {
    const a = mem().audit
    a.push({ id: randomUUID(), scenarioId: entry.scenarioId ?? null, action: entry.action, actor: actor.name, actorRole: actor.role, detail: entry.detail ?? null, at: new Date().toISOString() })
    if (a.length > 2000) a.shift()
  },
}

// ---- Supabase --------------------------------------------------------------------------------------------------------

type Row = Record<string, unknown>
const toStored = (r: Row): StoredScenario => ({
  id: r.id as string, name: r.name as string, description: (r.description as string | null) ?? null, kind: r.scenario_kind as ScenarioResult['kind'], zoneLabel: (r.zone_label as string | null) ?? null, isSimulation: true,
  modelVersion: (r.model_version as string) ?? '', computedAt: r.computed_at as string, createdBy: (r.created_by as string | null) ?? null, createdByName: (r.created_by_name as string | null) ?? null,
  createdAt: r.created_at as string, updatedAt: r.updated_at as string, area: r.area as AreaGeometry, inputs: r.inputs, results: r.results as ScenarioResult, layers: (r.layers as ScenarioLayers | null) ?? null,
})
const toObs = (r: Row): ObservationRecord => ({ id: r.id as string, lat: Number(r.lat), lng: Number(r.lng), depthM: Number(r.depth_m), observedAt: r.observed_at as string, source: r.source as string, sourceUrl: (r.source_url as string | null) ?? null, method: (r.method as string | null) ?? null, notes: (r.notes as string | null) ?? null, verified: !!r.verified, recordedByName: (r.recorded_by_name as string | null) ?? null })

const need = (a: Actor) => { if (!a.db) throw new Error('No database session for this user.'); return a.db }

export const supabaseRepo: FloodRepo = {
  async save(run, meta, actor) {
    const { data, error } = await need(actor).from('flood_scenarios').insert({
      name: meta.name, description: meta.description ?? null, scenario_kind: run.result.kind, is_simulation: true, zone_label: run.result.area.label, area: run.result.area.geometry,
      inputs: run.result.inputs, results: run.result, layers: run.layers, model_version: run.result.modelVersion, computed_at: run.result.computedAt, created_by: actor.id, created_by_name: actor.name,
    }).select('*').single()
    if (error) throw new Error(`The scenario could not be saved: ${error.message}`)
    return toStored(data as Row)
  },
  async list(actor) {
    const { data, error } = await need(actor).from('flood_scenarios').select('id,name,scenario_kind,zone_label,created_at,created_by,created_by_name,summary:results->summary,tier:results->tier,quality:results->dataQuality').order('created_at', { ascending: false }).limit(200)
    if (error) throw new Error(`Scenarios could not be loaded: ${error.message}`)
    return (data as Row[]).map((r) => ({
      id: r.id as string, name: r.name as string, kind: r.scenario_kind as ScenarioResult['kind'], tierTitle: (r.tier as { title?: string } | null)?.title ?? '', reliability: (r.quality as { reliability?: string } | null)?.reliability ?? '',
      zoneLabel: (r.zone_label as string | null) ?? null, createdAt: r.created_at as string, createdBy: (r.created_by as string | null) ?? null, createdByName: (r.created_by_name as string | null) ?? null,
      floodedAreaKm2: (r.summary as ScenarioSummary | null)?.floodedAreaKm2 ?? null, maxDepthM: (r.summary as ScenarioSummary | null)?.maxDepthM ?? null, isSimulation: true as const,
    }))
  },
  async get(id, actor) {
    const { data, error } = await need(actor).from('flood_scenarios').select('*').eq('id', id).maybeSingle()
    if (error) throw new Error(error.message)
    return data ? toStored(data as Row) : null
  },
  async update(id, patch, actor) {
    const upd: Row = {}
    if (patch.name !== undefined) upd.name = patch.name
    if (patch.description !== undefined) upd.description = patch.description
    const { data, error } = await need(actor).from('flood_scenarios').update(upd).eq('id', id).select('*').maybeSingle()
    if (error) throw new Error(error.message)
    return data ? toStored(data as Row) : null
  },
  async remove(id, actor) {
    const { data, error } = await need(actor).from('flood_scenarios').delete().eq('id', id).select('id')
    if (error) throw new Error(error.message)
    return (data?.length ?? 0) > 0
  },
  async observations(actor, bbox) {
    let q = need(actor).from('flood_observations').select('*').order('observed_at', { ascending: false }).limit(2000)
    if (bbox) q = q.gte('lng', bbox[0]).lte('lng', bbox[2]).gte('lat', bbox[1]).lte('lat', bbox[3])
    const { data, error } = await q
    if (error) throw new Error(error.message)
    return (data as Row[]).map(toObs)
  },
  async addObservation(o, actor) {
    const { data, error } = await need(actor).from('flood_observations').insert({ lat: o.lat, lng: o.lng, depth_m: o.depthM, observed_at: o.observedAt, source: o.source, source_url: o.sourceUrl ?? null, method: o.method ?? null, notes: o.notes ?? null, verified: false, recorded_by: actor.id, recorded_by_name: actor.name }).select('*').single()
    if (error) throw new Error(`The observation could not be saved: ${error.message}`)
    return toObs(data as Row)
  },
  async setObservationVerified(id, verified, actor) {
    const { data, error } = await need(actor).from('flood_observations').update({ verified }).eq('id', id).select('*').maybeSingle()
    if (error) throw new Error(error.message)
    return data ? toObs(data as Row) : null
  },
  async removeObservation(id, actor) {
    const { data, error } = await need(actor).from('flood_observations').delete().eq('id', id).select('id')
    if (error) throw new Error(error.message)
    return (data?.length ?? 0) > 0
  },
  async audit(entry, actor) {
    // Best effort: a missing audit table must not block a responder in an emergency, but it is logged.
    const { error } = await need(actor).from('flood_audit_log').insert({ scenario_id: entry.scenarioId ?? null, action: entry.action, actor_id: actor.id, actor: actor.name, actor_role: actor.role, detail: entry.detail ?? null })
    if (error) console.error('flood_audit_log insert failed:', error.message)
  },
}

export const insideArea = (o: ObservationRecord, area: AreaGeometry) => pointInArea(o.lat, o.lng, area)
