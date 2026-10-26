'use client'

// Flood-Depth and Impact Simulator panel (responders and administrators). Everything it shows is an ESTIMATE: the banner is
// always on screen, results name their model tier, and nothing here touches incidents, priorities, routes or dispatch.
import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from '@/components/ui/Icon'
import { AREAS } from '@/lib/constants'
import { FloodApiError, floodApi, type FloodConfigInfo } from '@/lib/flood/client'
import type { Comparison } from '@/lib/flood/compare'
import type { RouteFloodResult, ShelterFloodResult } from '@/lib/flood/integration'
import type { ScenarioListItem } from '@/lib/flood/repo'
import type { ScenarioInput } from '@/lib/flood/schema'
import { DEPTH_BANDS, ESTIMATE_BANNER, type DatasetStatus, type LatLng, type PointExposure, type ScenarioLayers, type ScenarioResult } from '@/lib/flood/types'
import type { AnalysisResult } from '@/lib/routing/types'
import type { FloodLayerToggles } from './toggles'

export interface FloodView { result: ScenarioResult | null; layers: ScenarioLayers | null; id: string | null; name: string }
export type FloodPick = null | 'area' | 'seed'
type AreaMode = 'operational_area' | 'polygon' | 'vyra_zone'
type Kind = 'hypothetical_overlay' | 'terrain_bathtub' | 'terrain_rainfall'

const num = (v: string) => (v.trim() === '' ? NaN : Number(v))
const fmt = (n: number | null | undefined, unit = '') => (n == null ? 'unknown' : `${n}${unit}`)
const STATE: Record<DatasetStatus['state'], string> = { ok: 'OK', empty: 'Empty', not_configured: 'Not configured', failed: 'Failed to load', stale: 'Stale', truncated: 'Truncated', synthetic: 'SYNTHETIC', partial: 'Partial' }
const LEVEL_CLASS: Record<DatasetStatus['level'], string> = { good: 'bg-success-100 text-success-700', fair: 'bg-warning-100 text-warning-700', poor: 'bg-critical-100 text-critical-700', missing: 'bg-critical-100 text-critical-700' }

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return <label className="block"><span className="label">{label}</span>{children}{hint && <span className="mt-1 block text-xs text-ink-600">{hint}</span>}</label>
}

function Count({ label, p }: { label: string; p: PointExposure }) {
  return <tr><th className="py-1 pr-2 text-left font-semibold">{label}</th><td>{p.available ? `${p.affected} of ${p.total}` : 'unknown'}</td><td className="pl-2 text-xs text-ink-600">{p.available ? (p.unassessed ? `${p.unassessed} outside assessed area` : '') : p.reason}</td></tr>
}

export default function FloodPanel({
  view, setView, toggles, setToggles, opacity, setOpacity, pick, setPick, areaPoints, setAreaPoints, seeds, setSeeds,
  zones, analysis, routeEvidence, setRouteEvidence, setShelterEvidence, onZoomTo, onClose,
}: {
  view: FloodView; setView: (v: FloodView) => void
  toggles: FloodLayerToggles; setToggles: (t: FloodLayerToggles) => void
  opacity: number; setOpacity: (n: number) => void
  pick: FloodPick; setPick: (p: FloodPick) => void
  areaPoints: LatLng[]; setAreaPoints: (p: LatLng[]) => void
  seeds: LatLng[]; setSeeds: (p: LatLng[]) => void
  zones: { id: string; name: string }[]
  analysis: AnalysisResult | null
  routeEvidence: RouteFloodResult | null; setRouteEvidence: (r: RouteFloodResult | null) => void
  setShelterEvidence: (r: ShelterFloodResult | null) => void
  onZoomTo: (bbox: [number, number, number, number]) => void
  onClose: () => void
}) {
  const [cfg, setCfg] = useState<FloodConfigInfo | null>(null)
  const [cfgError, setCfgError] = useState<string | null>(null)
  const [tab, setTab] = useState<'new' | 'saved' | 'compare'>('new')
  const [areaMode, setAreaMode] = useState<AreaMode>('operational_area')
  const [areaName, setAreaName] = useState(AREAS[0].name)
  const [radiusM, setRadiusM] = useState('3000')
  const [zoneId, setZoneId] = useState('')
  const [kind, setKind] = useState<Kind>('hypothetical_overlay')
  const [depthM, setDepthM] = useState('0.5')
  const [level, setLevel] = useState('')
  const [connectivity, setConnectivity] = useState<'seeded' | 'none'>('seeded')
  const [rainSource, setRainSource] = useState<'manual' | 'open_meteo'>('manual')
  const [mm, setMm] = useState('100')
  const [hours, setHours] = useState('24')
  const [rainStart, setRainStart] = useState('')
  const [rainEnd, setRainEnd] = useState('')
  const [runoff, setRunoff] = useState('0.8')
  const [drain, setDrain] = useState('0')
  const [infil, setInfil] = useState('0')
  const [minDepth, setMinDepth] = useState('0.1')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [list, setList] = useState<ScenarioListItem[] | null>(null)
  const [pickedForCompare, setPickedForCompare] = useState<string[]>([])
  const [comparison, setComparison] = useState<Comparison | null>(null)

  useEffect(() => { floodApi.config().then(setCfg).catch((e) => setCfgError(e instanceof Error ? e.message : 'Could not load the simulator settings.')) }, [])
  const refresh = () => floodApi.list().then((r) => setList(r.scenarios)).catch((e) => setError({ message: e.message }))
  useEffect(() => { if (tab !== 'new' && !list) refresh() }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps
  // An earlier route/shelter check belongs to an earlier analysis: never leave it looking current.
  useEffect(() => { setRouteEvidence(null) }, [analysis]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (kind !== 'terrain_bathtub' && pick === 'seed') setPick(null) }, [kind]) // eslint-disable-line react-hooks/exhaustive-deps

  const cap = cfg?.capabilities[kind]
  const resultRef = useRef<HTMLElement>(null)
  // A new result appears below the form: bring it into view so it is not missed.
  useEffect(() => { if (view.result) resultRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }) }, [view.result, view.id])
  const r = view.result

  const buildInput = (): { input?: ScenarioInput; problem?: string } => {
    let areaSource: ScenarioInput['areaSource']
    if (areaMode === 'operational_area') {
      const rad = num(radiusM)
      if (!Number.isFinite(rad)) return { problem: 'Enter a radius in metres.' }
      areaSource = { kind: 'operational_area', name: areaName, radiusM: rad }
    } else if (areaMode === 'vyra_zone') {
      if (!zoneId) return { problem: 'Choose a zone.' }
      areaSource = { kind: 'vyra_zone', zoneId }
    } else {
      if (areaPoints.length < 3) return { problem: 'Click at least 3 points on the map to draw the area.' }
      const ringPts = areaPoints.map(([la, ln]) => [ln, la])
      areaSource = { kind: 'polygon', geometry: { type: 'Polygon', coordinates: [[...ringPts, ringPts[0]]] } }
    }
    const minD = num(minDepth)
    if (!Number.isFinite(minD)) return { problem: 'Enter the flooded threshold in metres.' }
    const options: ScenarioInput['options'] = { minDepthM: minD }
    let scenario: ScenarioInput['scenario']
    if (kind === 'hypothetical_overlay') {
      const d = num(depthM)
      if (!Number.isFinite(d)) return { problem: 'Enter a water depth in metres.' }
      scenario = { kind, depthM: d }
    } else if (kind === 'terrain_bathtub') {
      const l = num(level)
      if (!Number.isFinite(l)) return { problem: 'Enter the water surface elevation in metres.' }
      scenario = { kind, waterSurfaceElevationM: l, connectivity, seeds: connectivity === 'seeded' ? seeds : [], elevationSource: 'auto' }
    } else {
      const rc = num(runoff), dc = num(drain), inf = num(infil)
      if (![rc, dc, inf].every(Number.isFinite)) return { problem: 'Fill in the runoff, drainage and infiltration values (0 is allowed).' }
      let rainfall: Extract<ScenarioInput['scenario'], { kind: 'terrain_rainfall' }>['rainfall']
      if (rainSource === 'manual') {
        const m = num(mm), h = num(hours)
        if (!Number.isFinite(m) || !Number.isFinite(h)) return { problem: 'Enter the rainfall and its duration.' }
        rainfall = { kind: 'manual', mm: m, durationHours: h }
      } else {
        if (!rainStart || !rainEnd) return { problem: 'Choose the start and end of the rainfall period.' }
        rainfall = { kind: 'open_meteo', start: new Date(rainStart).toISOString(), end: new Date(rainEnd).toISOString() }
      }
      scenario = { kind, rainfall, runoffCoefficient: rc, drainageCapacityMm: dc, infiltrationMm: inf, elevationSource: 'auto' }
    }
    return { input: { description: description || undefined, areaSource, scenario, options } }
  }

  const fail = (e: unknown) => setError(e instanceof FloodApiError ? { message: e.message, hint: e.hint } : { message: e instanceof Error ? e.message : 'Something went wrong.' })

  const run = async (save: boolean) => {
    setError(null); setNotice(null); setComparison(null); setRouteEvidence(null); setShelterEvidence(null)
    const b = buildInput()
    if (!b.input) return setError({ message: b.problem! })
    if (save && name.trim().length < 3) return setError({ message: 'Give the scenario a name of at least 3 characters before saving.' })
    setBusy(save ? 'Running and saving...' : 'Running...')
    try {
      if (save) {
        const { scenario } = await floodApi.save({ ...b.input, name: name.trim() })
        setView({ result: scenario.results, layers: scenario.layers, id: scenario.id, name: scenario.name })
        setNotice('Saved as a simulation. It is stored separately from real incidents.')
        setList(null)
        onZoomTo(scenario.results.area.bbox)
      } else {
        const res = await floodApi.simulate(b.input)
        setView({ result: res.result, layers: res.layers, id: null, name: res.name })
        onZoomTo(res.result.area.bbox)
      }
    } catch (e) { fail(e) } finally { setBusy(null) }
  }

  const open = async (id: string) => {
    setError(null); setBusy('Opening...'); setRouteEvidence(null); setShelterEvidence(null)
    try {
      const { scenario } = await floodApi.get(id)
      setView({ result: scenario.results, layers: scenario.layers, id: scenario.id, name: scenario.name })
      onZoomTo(scenario.results.area.bbox)
      setTab('new')
    } catch (e) { fail(e) } finally { setBusy(null) }
  }
  const del = async (item: ScenarioListItem) => {
    if (!window.confirm(`Delete the simulation "${item.name}"? Real incidents are not affected.`)) return
    try { await floodApi.remove(item.id); if (view.id === item.id) setView({ result: null, layers: null, id: null, name: '' }); setPickedForCompare((p) => p.filter((x) => x !== item.id)); refresh() } catch (e) { fail(e) }
  }
  const doCompare = async () => {
    setError(null); setBusy('Comparing...')
    try { setComparison(await floodApi.compare(pickedForCompare[0], pickedForCompare[1])) } catch (e) { fail(e) } finally { setBusy(null) }
  }
  const exportAs = async (f: 'pdf' | 'html' | 'json' | 'geojson') => {
    if (!view.id) return
    setError(null); setBusy(`Preparing ${f.toUpperCase()}...`)
    try { await floodApi.download(view.id, f) } catch (e) { fail(e) } finally { setBusy(null) }
  }
  const checkRoutes = async () => {
    if (!view.id || !analysis) return
    setError(null); setBusy('Checking routes...')
    try {
      const ev = await floodApi.routes(view.id, analysis.candidates.filter((c) => c.geometry.length >= 2).map((c) => ({ id: c.id, geometry: c.geometry })))
      setRouteEvidence(ev)
    } catch (e) { fail(e) } finally { setBusy(null) }
  }
  const checkShelters = async () => {
    if (!view.id) return
    setError(null); setBusy('Checking shelters...')
    try { setShelterEvidence(await floodApi.shelters(view.id)); setNotice('Shelter markers now show what this estimate says about them. Nothing was ranked or changed.') } catch (e) { fail(e) } finally { setBusy(null) }
  }

  const bandRows = useMemo(() => (r ? DEPTH_BANDS.map((b) => ({ b, km2: r.summary.bandAreasKm2[b.id] ?? 0 })) : []), [r])

  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-extrabold"><Icon name="wave" size={20} /> Flood simulator</h2>
        <button type="button" className="btn-ghost btn-sm" onClick={onClose} aria-label="Close the flood simulator"><Icon name="close" size={16} /></button>
      </div>
      <p className="rounded-xl bg-critical-100 p-2.5 text-center text-xs font-extrabold uppercase tracking-wide text-critical-700" role="note">{ESTIMATE_BANNER}</p>
      <p className="text-xs text-ink-600">Simulations are kept apart from real incidents. They never change an incident&apos;s priority and never dispatch anyone.</p>
      {cfgError && <p className="rounded-xl bg-critical-100 p-2.5 font-semibold text-critical-700" role="alert">{cfgError}</p>}

      <div className="flex gap-1.5" role="tablist" aria-label="Simulator sections">
        {([['new', 'Scenario'], ['saved', 'Saved'], ['compare', 'Compare']] as const).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={`btn-sm flex-1 ${tab === id ? 'btn-dark' : 'btn-ghost'}`} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {error && <div className="rounded-xl bg-critical-100 p-2.5 font-semibold text-critical-700" role="alert">{error.message}{error.hint && <p className="mt-1 text-xs font-normal">{error.hint}</p>}</div>}
      {notice && <p className="rounded-xl bg-success-100 p-2.5 font-semibold text-success-700" role="status">{notice}</p>}
      {busy && <p className="font-semibold text-ink-600" role="status">{busy}</p>}

      {tab === 'new' && (
        <>
          <fieldset className="space-y-2.5 rounded-2xl bg-sand-100 p-3">
            <legend className="px-1 text-xs font-extrabold uppercase text-ink-600">1. Area</legend>
            <Field label="How to choose the area">
              <select className="input" value={areaMode} onChange={(e) => { setAreaMode(e.target.value as AreaMode); setPick(null) }}>
                <option value="operational_area">Karachi zone (area and radius)</option>
                <option value="vyra_zone">An existing VYRA zone</option>
                <option value="polygon">Draw on the map</option>
              </select>
            </Field>
            {areaMode === 'operational_area' && (
              <div className="grid grid-cols-2 gap-2">
                <Field label="Zone"><select className="input" value={areaName} onChange={(e) => setAreaName(e.target.value)}>{AREAS.map((a) => <option key={a.name}>{a.name}</option>)}</select></Field>
                <Field label="Radius (m)"><input className="input" inputMode="numeric" value={radiusM} onChange={(e) => setRadiusM(e.target.value)} /></Field>
              </div>
            )}
            {areaMode === 'vyra_zone' && (
              <Field label="Zone" hint={zones.length ? undefined : 'No zones are loaded right now.'}>
                <select className="input" value={zoneId} onChange={(e) => setZoneId(e.target.value)}><option value="">Choose...</option>{zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}</select>
              </Field>
            )}
            {areaMode === 'polygon' && (
              <div className="space-y-2">
                <p className="text-xs text-ink-600">Click the map to add corners. At least 3. Limit {cfg?.limits.maxAreaKm2 ?? 300} km2, inside Karachi{cfg?.region.anyRegionAllowed ? ' (region check is off on this server)' : ''}.</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={`btn-sm ${pick === 'area' ? 'btn-dark' : 'btn-ghost'}`} onClick={() => setPick(pick === 'area' ? null : 'area')}><Icon name="pin" size={15} /> {pick === 'area' ? 'Stop drawing' : 'Draw area'}</button>
                  <button type="button" className="btn-ghost btn-sm" disabled={!areaPoints.length} onClick={() => setAreaPoints(areaPoints.slice(0, -1))}>Undo point</button>
                  <button type="button" className="btn-ghost btn-sm" disabled={!areaPoints.length} onClick={() => setAreaPoints([])}>Clear</button>
                  <span className="self-center text-xs font-semibold">{areaPoints.length} point(s)</span>
                </div>
              </div>
            )}
          </fieldset>

          <fieldset className="space-y-2.5 rounded-2xl bg-sand-100 p-3">
            <legend className="px-1 text-xs font-extrabold uppercase text-ink-600">2. Scenario</legend>
            <Field label="Type">
              <select className="input" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
                <option value="hypothetical_overlay">Hypothetical water level (no terrain)</option>
                <option value="terrain_bathtub">Terrain: water level on the elevation model</option>
                <option value="terrain_rainfall">Terrain: rainfall ponding</option>
              </select>
            </Field>
            {cfg && cap && !cap.available && <p className="rounded-xl bg-warning-100 p-2 text-xs font-semibold text-warning-700">Not available here: {cap.reason}</p>}
            {kind === 'hypothetical_overlay' && <Field label="Water depth above ground (m)" hint="Applied evenly to the whole area. No terrain, no depth bands. It shows what would be affected IF this happened."><input className="input" inputMode="decimal" value={depthM} onChange={(e) => setDepthM(e.target.value)} /></Field>}
            {kind === 'terrain_bathtub' && (
              <>
                <Field label="Water surface elevation (m)" hint="In the datum of the elevation data (usually height above sea level), not depth above ground."><input className="input" inputMode="decimal" value={level} onChange={(e) => setLevel(e.target.value)} /></Field>
                <Field label="Connectivity"><select className="input" value={connectivity} onChange={(e) => setConnectivity(e.target.value as 'seeded' | 'none')}><option value="seeded">Only ground connected to a water source point</option><option value="none">Every cell below the level (can overstate flooding)</option></select></Field>
                {connectivity === 'seeded' && (
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className={`btn-sm ${pick === 'seed' ? 'btn-dark' : 'btn-ghost'}`} onClick={() => setPick(pick === 'seed' ? null : 'seed')}><Icon name="pin" size={15} /> {pick === 'seed' ? 'Stop adding' : 'Add water source'}</button>
                      <button type="button" className="btn-ghost btn-sm" disabled={!seeds.length} onClick={() => setSeeds([])}>Clear</button>
                      <span className="self-center text-xs font-semibold">{seeds.length} source point(s)</span>
                    </div>
                    <p className="text-xs text-ink-600">Click the map where the water comes from (a river, creek or outfall) inside the area.</p>
                  </div>
                )}
              </>
            )}
            {kind === 'terrain_rainfall' && (
              <>
                <Field label="Rainfall"><select className="input" value={rainSource} onChange={(e) => setRainSource(e.target.value as 'manual' | 'open_meteo')}><option value="manual">Type it in</option><option value="open_meteo" disabled={!cfg?.sources.rainfallApi}>Open-Meteo model rainfall{cfg?.sources.rainfallApi ? '' : ' (not enabled)'}</option></select></Field>
                {rainSource === 'manual' ? (
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Rainfall (mm)"><input className="input" inputMode="decimal" value={mm} onChange={(e) => setMm(e.target.value)} /></Field>
                    <Field label="Over (hours)"><input className="input" inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} /></Field>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="From"><input className="input" type="datetime-local" value={rainStart} onChange={(e) => setRainStart(e.target.value)} /></Field>
                    <Field label="To"><input className="input" type="datetime-local" value={rainEnd} onChange={(e) => setRainEnd(e.target.value)} /></Field>
                  </div>
                )}
                <div className="grid grid-cols-3 gap-2">
                  <Field label="Runoff (0-1)"><input className="input" inputMode="decimal" value={runoff} onChange={(e) => setRunoff(e.target.value)} /></Field>
                  <Field label="Drainage (mm)"><input className="input" inputMode="decimal" value={drain} onChange={(e) => setDrain(e.target.value)} /></Field>
                  <Field label="Infiltr. (mm)"><input className="input" inputMode="decimal" value={infil} onChange={(e) => setInfil(e.target.value)} /></Field>
                </div>
                <p className="text-xs text-ink-600">Drainage capacity and infiltration are your own assumptions (0 = none removed). VYRA has no measured values for them.</p>
              </>
            )}
            <Field label="Flooded threshold (m)" hint="Cells shallower than this are not counted as flooded."><input className="input" inputMode="decimal" value={minDepth} onChange={(e) => setMinDepth(e.target.value)} /></Field>
          </fieldset>

          <fieldset className="space-y-2.5 rounded-2xl bg-sand-100 p-3">
            <legend className="px-1 text-xs font-extrabold uppercase text-ink-600">3. Run</legend>
            <Field label="Name (needed to save)"><input className="input" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Lyari 0.5 m overlay" /></Field>
            <Field label="Description (optional)"><textarea className="input" rows={2} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
            <div className="flex gap-2">
              <button type="button" className="btn-ghost flex-1" disabled={!!busy || (cfg ? !cap?.available : false)} onClick={() => run(false)}><Icon name="eye" size={17} /> Preview</button>
              <button type="button" className="btn-primary flex-1" disabled={!!busy || (cfg ? !cap?.available : false)} onClick={() => run(true)}><Icon name="save" size={17} /> Run and save</button>
            </div>
          </fieldset>

          {r && (
            <section ref={resultRef} className="space-y-3 rounded-2xl border-2 border-critical-700 p-3" aria-label="Scenario result">
              <p className="rounded-lg bg-critical-700 px-2 py-1 text-center text-xs font-extrabold uppercase text-white">{r.banner}</p>
              <div>
                <h3 className="text-base font-extrabold">{view.name}{!view.id && <span className="ml-2 rounded-md bg-warning-100 px-1.5 py-0.5 text-xs text-warning-700">not saved</span>}</h3>
                <p className="text-xs text-ink-600">Computed {new Date(r.computedAt).toLocaleString()} · {r.modelVersion}</p>
              </div>
              <div className="rounded-xl bg-sand-100 p-2.5"><p className="font-bold">{r.tier.title}</p><p className="mt-1 text-xs">{r.tier.summary}</p></div>
              <p className={`rounded-xl p-2.5 text-xs font-semibold ${r.dataQuality.reliability === 'validated' ? 'bg-success-100 text-success-700' : 'bg-warning-100 text-warning-700'}`}>{r.dataQuality.headline}</p>
              {r.warnings.length > 0 && <ul className="list-disc space-y-1 pl-5 text-xs font-semibold text-warning-700">{r.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}

              <table className="w-full text-sm"><tbody>
                <tr><th className="py-0.5 text-left font-semibold">Selected area</th><td>{r.summary.areaKm2} km2</td></tr>
                <tr><th className="py-0.5 text-left font-semibold">Assessed</th><td>{r.summary.assessedAreaKm2} km2{r.summary.unassessedFraction > 0 && ` (${Math.round(r.summary.unassessedFraction * 1000) / 10}% no terrain data)`}</td></tr>
                <tr><th className="py-0.5 text-left font-semibold">Flooded (estimate)</th><td>{r.summary.floodedAreaKm2} km2 ({Math.round(r.summary.floodedFractionOfAssessed * 100)}%)</td></tr>
                <tr><th className="py-0.5 text-left font-semibold">Max depth (estimate)</th><td>{fmt(r.summary.maxDepthM, ' m')}</td></tr>
                <tr><th className="py-0.5 text-left font-semibold">Mean depth (estimate)</th><td>{fmt(r.summary.meanDepthM, ' m')}</td></tr>
                <tr><th className="py-0.5 text-left font-semibold">Water volume</th><td>{r.summary.volumeM3 == null ? 'unknown' : `${r.summary.volumeM3.toLocaleString('en')} m3`}</td></tr>
                <tr><th className="py-0.5 text-left font-semibold">Cell size</th><td>{r.summary.cellSizeM == null ? 'not applicable' : `about ${r.summary.cellSizeM} m`}</td></tr>
              </tbody></table>

              <div>
                <h4 className="mb-1 text-xs font-extrabold uppercase text-ink-600">Depth bands (legend)</h4>
                {r.tier.depthBands === 'not_supported' ? <p className="text-xs">Depth bands are not supported: depth is one typed-in value, not a calculation.</p> : (
                  <ul className="space-y-1">{bandRows.map(({ b, km2 }) => <li key={b.id} className="flex items-center gap-2 text-xs"><span className="inline-block h-3.5 w-6 rounded border border-ink-400" style={{ background: b.color }} aria-hidden /> <span className="font-semibold">{b.label}</span><span className="ml-auto">{km2} km2</span></li>)}</ul>
                )}
                {r.tier.depthBands === 'indicative' && <p className="mt-1 text-xs text-ink-600">Bands are indicative only.</p>}
              </div>

              <div>
                <h4 className="mb-1 text-xs font-extrabold uppercase text-ink-600">Potentially affected (approximate)</h4>
                <table className="w-full text-sm"><tbody>
                  <Count label="Shelters" p={r.exposure.shelters} />
                  <Count label="Hospitals" p={r.exposure.hospitals} />
                  <tr><th className="py-1 pr-2 text-left font-semibold">Roads</th><td>{r.exposure.roads.available ? `${r.exposure.roads.affectedCount} of ${r.exposure.roads.totalCount}` : 'unknown'}</td><td className="pl-2 text-xs text-ink-600">{r.exposure.roads.available ? `${r.exposure.roads.floodedLengthKm} km flooded${r.exposure.roads.truncated ? ' (lower bound)' : ''}` : r.exposure.roads.reason}</td></tr>
                  <tr><th className="py-1 pr-2 text-left font-semibold">Reported blocked roads</th><td>{r.exposure.blockedRoadRegister.available ? `${r.exposure.blockedRoadRegister.affectedCount} of ${r.exposure.blockedRoadRegister.totalCount}` : 'unknown'}</td><td className="pl-2 text-xs text-ink-600">{r.exposure.blockedRoadRegister.available ? '' : r.exposure.blockedRoadRegister.reason}</td></tr>
                  <tr><th className="py-1 pr-2 text-left font-semibold">Buildings</th><td>{r.exposure.buildings.available ? `${r.exposure.buildings.affected} of ${r.exposure.buildings.total}${r.exposure.buildings.truncated ? '+' : ''}` : 'unknown'}</td><td className="pl-2 text-xs text-ink-600">{r.exposure.buildings.available ? (r.exposure.buildings.truncated ? 'lower bound' : '') : r.exposure.buildings.reason}</td></tr>
                  <tr><th className="py-1 pr-2 text-left font-semibold">Rescue teams inside</th><td>{r.exposure.resources.available ? `${r.exposure.resources.teamsInExtent} of ${r.exposure.resources.teamsTotal}` : 'unknown'}</td><td className="pl-2 text-xs text-ink-600">{r.exposure.resources.available ? '' : r.exposure.resources.reason}</td></tr>
                  <tr><th className="py-1 pr-2 text-left font-semibold">Open incidents inside</th><td>{r.exposure.incidents.available ? r.exposure.incidents.openInExtent : 'unknown'}</td><td className="pl-2 text-xs text-ink-600">context only</td></tr>
                </tbody></table>
                <p className="mt-1 text-xs text-ink-600">&quot;unknown&quot; means the dataset is missing or failed. It is never shown as zero.</p>
              </div>

              <div>
                <h4 className="mb-1 text-xs font-extrabold uppercase text-ink-600">Data quality</h4>
                <ul className="space-y-1.5">{r.dataQuality.datasets.map((d) => (
                  <li key={d.id} className="rounded-lg bg-sand-100 p-2 text-xs">
                    <span className="font-bold">{d.label}</span> <span className={`ml-1 rounded px-1.5 py-0.5 font-bold ${LEVEL_CLASS[d.level]}`}>{STATE[d.state]}</span>
                    <p className="mt-0.5 text-ink-600">{d.source ?? 'no source'} · {d.asOf ? `as of ${d.asOf.slice(0, 10)}` : 'date unknown'}{d.resolutionM ? ` · ${d.resolutionM} m` : ''}{d.count != null ? ` · ${d.count} records` : ''}</p>
                    {d.notes.map((n) => <p key={n} className="text-ink-600">{n}</p>)}
                    {d.error && <p className="font-semibold text-critical-700">{d.error}</p>}
                  </li>
                ))}</ul>
              </div>

              {r.observations.comparison && <p className="rounded-xl bg-sand-100 p-2.5 text-xs"><strong>Observation comparison (not validation).</strong> {r.observations.comparison.n} recorded, {r.observations.comparison.usable} usable; mean error {fmt(r.observations.comparison.meanErrorM, ' m')}, RMSE {fmt(r.observations.comparison.rmseM, ' m')}. {r.observations.comparison.note}</p>}
              {r.observations.inArea.length > 0 && !r.observations.comparison && <p className="text-xs text-ink-600">{r.observations.inArea.length} recorded observation(s) are shown on the map. No comparison was requested.</p>}

              <details className="rounded-xl bg-sand-100 p-2.5"><summary className="cursor-pointer font-bold">Inputs and assumptions</summary>
                <ul className="mt-1.5 list-disc space-y-1 pl-5 text-xs">{r.provenance.map((p) => <li key={p.label}><strong>{p.label}:</strong> {p.value}</li>)}{r.assumptions.map((a) => <li key={a}>{a}</li>)}</ul></details>
              <details className="rounded-xl bg-sand-100 p-2.5" open><summary className="cursor-pointer font-bold">Limitations</summary><ul className="mt-1.5 list-disc space-y-1 pl-5 text-xs">{r.limitations.map((a) => <li key={a}>{a}</li>)}</ul></details>

              <div>
                <h4 className="mb-1 text-xs font-extrabold uppercase text-ink-600">Map layers</h4>
                <div className="grid grid-cols-2 gap-1">
                  {([['extent', 'Flood extent'], ['roads', 'Roads'], ['buildings', 'Buildings'], ['shelters', 'Shelters'], ['hospitals', 'Hospitals'], ['observations', 'Observations']] as const).map(([k, l]) => (
                    <label key={k} className="flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={toggles[k]} onChange={(e) => setToggles({ ...toggles, [k]: e.target.checked })} /> {l}</label>
                  ))}
                </div>
                <label className="mt-2 flex items-center gap-2 text-xs font-semibold">Opacity <input type="range" min={0.2} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} className="flex-1" aria-label="Flood extent opacity" /></label>
              </div>

              <div className="space-y-2 rounded-xl bg-sand-100 p-2.5">
                <h4 className="text-xs font-extrabold uppercase text-ink-600">Supplementary evidence (changes nothing)</h4>
                <p className="text-xs text-ink-600">Adds an estimate-based note to the route analysis and to shelter markers. It does not rank, recommend, reorder or dispatch.</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn-ghost btn-sm" disabled={!view.id || !analysis || !!busy} onClick={checkRoutes}><Icon name="route" size={15} /> Check current routes</button>
                  <button type="button" className="btn-ghost btn-sm" disabled={!view.id || !!busy} onClick={checkShelters}><Icon name="home" size={15} /> Check shelters</button>
                </div>
                {!view.id && <p className="text-xs text-ink-600">Save the scenario to use it with routes and shelters.</p>}
                {view.id && !analysis && <p className="text-xs text-ink-600">Run a route analysis first to check its routes.</p>}
                {routeEvidence && <p className="text-xs font-semibold">Route evidence from this scenario is shown in the route panel.</p>}
              </div>

              <div>
                <h4 className="mb-1 text-xs font-extrabold uppercase text-ink-600">Export report</h4>
                {view.id ? (
                  <div className="flex flex-wrap gap-2">{(['pdf', 'html', 'geojson', 'json'] as const).map((f) => <button key={f} type="button" className="btn-ghost btn-sm" disabled={!!busy} onClick={() => exportAs(f)}>{f.toUpperCase()}</button>)}</div>
                ) : <p className="text-xs text-ink-600">Save the scenario to export a report.</p>}
              </div>
              <p className="text-xs text-ink-600">{r.disclaimer}</p>
            </section>
          )}
        </>
      )}

      {tab === 'saved' && (
        <div className="space-y-2">
          {!list ? <p className="font-semibold text-ink-600">Loading...</p> : list.length === 0 ? <p className="rounded-xl bg-sand-200 p-3 font-semibold">No saved simulations yet.</p> : list.map((s) => (
            <div key={s.id} className="rounded-xl bg-sand-100 p-2.5">
              <p className="font-bold">{s.name}</p>
              <p className="text-xs text-ink-600">{s.tierTitle} · {s.reliability} · {s.zoneLabel ?? 'custom area'}</p>
              <p className="text-xs text-ink-600">Flooded {fmt(s.floodedAreaKm2, ' km2')} · max depth {fmt(s.maxDepthM, ' m')} · {new Date(s.createdAt).toLocaleString()} · {s.createdByName ?? 'unknown'}</p>
              <div className="mt-1.5 flex gap-2"><button type="button" className="btn-ghost btn-sm" onClick={() => open(s.id)}>Open</button><button type="button" className="btn-ghost btn-sm" onClick={() => del(s)} aria-label={`Delete ${s.name}`}><Icon name="trash" size={15} /></button></div>
            </div>
          ))}
        </div>
      )}

      {tab === 'compare' && (
        <div className="space-y-2">
          <p className="text-xs text-ink-600">Choose exactly two saved simulations.</p>
          {!list ? <p className="font-semibold text-ink-600">Loading...</p> : list.length < 2 ? <p className="rounded-xl bg-sand-200 p-3 font-semibold">Save at least two simulations to compare them.</p> : (
            <>
              {list.map((s) => (
                <label key={s.id} className="chip">
                  <input type="checkbox" checked={pickedForCompare.includes(s.id)} disabled={!pickedForCompare.includes(s.id) && pickedForCompare.length >= 2} onChange={(e) => { setComparison(null); setPickedForCompare((p) => (e.target.checked ? [...p, s.id] : p.filter((x) => x !== s.id))) }} />
                  <span>{s.name}<span className="block text-xs text-ink-600">{s.tierTitle}</span></span>
                </label>
              ))}
              <button type="button" className="btn-primary w-full" disabled={pickedForCompare.length !== 2 || !!busy} onClick={doCompare}>Compare</button>
            </>
          )}
          {comparison && (
            <div className="space-y-2 rounded-2xl border-2 border-critical-700 p-3">
              <p className="rounded-lg bg-critical-700 px-2 py-1 text-center text-xs font-extrabold uppercase text-white">{ESTIMATE_BANNER}</p>
              <p className="text-xs"><strong>A:</strong> {comparison.a.name} ({comparison.a.tier}) · <strong>B:</strong> {comparison.b.name} ({comparison.b.tier})</p>
              {comparison.warnings.map((w) => <p key={w} className="text-xs font-semibold text-warning-700">{w}</p>)}
              <table className="w-full text-xs"><thead><tr className="text-left"><th>Measure</th><th>A</th><th>B</th><th>B - A</th></tr></thead><tbody>
                {comparison.deltas.map((d) => <tr key={d.metric} className="border-t border-sand-300"><td className="py-1 pr-1 font-semibold">{d.metric} ({d.unit})</td><td>{fmt(d.a)}</td><td>{fmt(d.b)}</td><td className="font-bold">{d.delta == null ? 'unknown' : d.delta > 0 ? `+${d.delta}` : d.delta}</td></tr>)}
              </tbody></table>
              <p className="text-xs text-ink-600">{comparison.spatial.note}</p>
              {comparison.spatial.sampled && <p className="text-xs">Flooded in both: {fmt(comparison.spatial.bothKm2, ' km2')} · only A: {fmt(comparison.spatial.onlyAKm2, ' km2')} · only B: {fmt(comparison.spatial.onlyBKm2, ' km2')}</p>}
              <p className="text-xs text-ink-600">&quot;unknown&quot; means a value is missing in one of the scenarios, not zero.</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
