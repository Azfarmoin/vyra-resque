'use client'
// Step by step: choose a source, an area and two date ranges, look at the scenes that exist, pick a pair, run the analysis.
import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Icon from '@/components/ui/Icon'
import { formatTime } from '@/lib/client'
import { DEFAULT_CENTER } from '@/lib/constants'
import { satApi, SatApiError, type SceneRow, type SearchResponse } from '@/lib/satellite/client'
import type { ProviderStatus } from '@/lib/satellite/providers/types'
import { COLLECTION_KIND, COLLECTION_LABELS, DEFAULT_OPTICAL_PARAMS, DEFAULT_SAR_PARAMS, type AnalysisView, type Bbox, type CollectionId } from '@/lib/satellite/types'
import { bboxAreaKm2, validateAoi, validateRanges } from '@/lib/satellite/validation'

const AoiMap = dynamic(() => import('./AoiMap'), { ssr: false, loading: () => <div className="flex h-full items-center justify-center bg-sand-200 font-semibold">Loading map...</div> })
const iso = (d: Date) => d.toISOString().slice(0, 10)
const addDays = (n: number) => iso(new Date(Date.now() + n * 86_400_000))
const HINT: Record<string, string> = { good: 'bg-success-100 text-success-700', fair: 'bg-amber-100 text-amber-800', poor: 'bg-critical-100 text-critical-700', 'n/a': 'bg-sand-200 text-ink-700' }

function SceneTable({ title, rows, value, onPick }: { title: string; rows: SceneRow[]; value: string; onPick: (id: string) => void }) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1 text-base font-bold">{title}: pick one scene</legend>
      {rows.length === 0 ? <p className="rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-900">No imagery found for these dates over this area.</p> : (
        <div className="max-h-64 overflow-auto rounded-xl border-2 border-sand-300">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-sand-100"><tr><th className="p-2"><span className="sr-only">Pick</span></th><th className="p-2">Acquired (UTC)</th><th className="p-2">Source</th><th className="p-2">Res.</th><th className="p-2">Cloud</th><th className="p-2">Quality</th></tr></thead>
            <tbody>{rows.map((s) => (
              <tr key={s.id} className={`border-t border-sand-200 ${value === s.id ? 'bg-primary-50' : ''}`}>
                <td className="p-2"><input type="radio" name={title} checked={value === s.id} onChange={() => onPick(s.id)} aria-label={`${title} scene ${s.acquiredAt}`} /></td>
                <td className="p-2 font-semibold">{s.acquiredAt.slice(0, 16).replace('T', ' ')}</td>
                <td className="p-2">{s.platform}{s.orbitDirection && <span className="block text-xs text-ink-600">{s.orbitDirection} · orbit {s.relativeOrbit ?? '?'}</span>}{s.synthetic && <span className="block text-xs font-bold text-critical-700">SYNTHETIC</span>}</td>
                <td className="p-2">{s.resolutionM} m</td>
                <td className="p-2">{s.cloudCover == null ? '–' : `${Math.round(s.cloudCover)}%`}</td>
                <td className="p-2"><span className={`rounded-full px-2 py-0.5 text-xs font-bold ${HINT[s.qualityHint]}`}>{s.qualityHint}</span></td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
    </fieldset>
  )
}

export default function Workbench({ initialBbox, onDone }: { initialBbox?: Bbox | null; onDone: (a: AnalysisView) => void }) {
  const [providers, setProviders] = useState<ProviderStatus[] | null>(null)
  const [limits, setLimits] = useState({ maxRangeDays: 45, maxAoiKm2: 400, maxUploadBytes: 40 * 1048576 })
  const [loadErr, setLoadErr] = useState('')
  const [providerId, setProviderId] = useState('')
  const [collection, setCollection] = useState<CollectionId>('sentinel-2-l2a')
  const [bbox, setBbox] = useState<Bbox | null>(initialBbox ?? null)
  const [beforeR, setBeforeR] = useState({ start: addDays(-75), end: addDays(-45) })
  const [afterR, setAfterR] = useState({ start: addDays(-14), end: addDays(0) })
  const [maxCloud, setMaxCloud] = useState(60)
  const [found, setFound] = useState<SearchResponse | null>(null)
  const [beforeId, setBeforeId] = useState(''); const [afterId, setAfterId] = useState('')
  const [opt, setOpt] = useState({ ...DEFAULT_OPTICAL_PARAMS }); const [sar, setSar] = useState({ ...DEFAULT_SAR_PARAMS })
  const [busy, setBusy] = useState<'' | 'search' | 'run'>('')
  const [errors, setErrors] = useState<string[]>([])
  // user-supplied imagery
  const [files, setFiles] = useState<{ before: File | null; after: File | null }>({ before: null, after: null })
  const [decl, setDecl] = useState({ platform: '', beforeDate: '', afterDate: '', bands: 'green,red,nir,swir', sarUnit: 'linear', license: false })

  useEffect(() => { satApi.providers().then((r) => { setProviders(r.providers); setLimits(r.limits); const first = r.providers.find((p) => p.state === 'ready' && !p.demo && !p.upload) ?? r.providers.find((p) => p.state === 'ready'); if (first) { setProviderId(first.id); setCollection(first.collections[0]) } }).catch((e) => setLoadErr(e instanceof SatApiError ? e.message : 'Could not load imagery sources.')) }, [])
  const prov = providers?.find((p) => p.id === providerId) ?? null
  const kind = COLLECTION_KIND[collection]
  const isUpload = !!prov?.upload
  const area = bbox ? bboxAreaKm2(bbox) : 0

  const pickProvider = (id: string) => { setProviderId(id); const p = providers?.find((x) => x.id === id); if (p) setCollection(p.collections[0]); setFound(null); setBeforeId(''); setAfterId(''); setErrors([]) }
  const localErrors = useMemo(() => {
    const e: string[] = []
    if (!isUpload) e.push(...validateRanges(beforeR, afterR, collection, Date.now(), limits.maxRangeDays))
    const a = validateAoi(bbox ? { type: 'bbox', bbox } : null, { maxKm2: limits.maxAoiKm2 }); if (!a.ok) e.push(...a.errors)
    return e
  }, [isUpload, beforeR, afterR, collection, bbox, limits])

  const search = useCallback(async () => {
    setErrors([]); setFound(null); setBeforeId(''); setAfterId('')
    if (localErrors.length) return setErrors(localErrors)
    setBusy('search')
    try { setFound(await satApi.search({ provider: providerId, collection, aoi: { type: 'bbox', bbox }, before: beforeR, after: afterR, maxCloud })) }
    catch (e) { setErrors([e instanceof SatApiError ? e.message : 'The search failed.']) } finally { setBusy('') }
  }, [localErrors, providerId, collection, bbox, beforeR, afterR, maxCloud])

  async function run() {
    setErrors([]); setBusy('run')
    try {
      const parameters = kind === 'optical' ? opt : sar
      let res
      if (isUpload) {
        if (localErrors.length) return setErrors(localErrors)
        if (!files.before || !files.after) return setErrors(['Choose both a before and an after GeoTIFF.'])
        const d = (date: string) => ({ kind, platform: decl.platform, acquiredAt: date, bands: kind === 'optical' ? decl.bands.split(',').map((s) => s.trim()) : decl.bands.split(',').map((s) => s.trim().toLowerCase()), sarUnit: decl.sarUnit, licenseConfirmed: decl.license })
        const form = new FormData()
        form.set('params', JSON.stringify({ provider: providerId, collection, aoi: { type: 'bbox', bbox }, parameters, uploads: { before: d(decl.beforeDate), after: d(decl.afterDate) } }))
        form.set('before', files.before); form.set('after', files.after)
        res = await satApi.createUpload(form)
      } else res = await satApi.create({ provider: providerId, collection, aoi: { type: 'bbox', bbox }, beforeRange: beforeR, afterRange: afterR, beforeSceneId: beforeId, afterSceneId: afterId, parameters })
      onDone(res.analysis)
    } catch (e) {
      const id = e instanceof SatApiError ? (e.body.analysisId as string | undefined) : undefined
      setErrors([(e instanceof SatApiError ? e.message : 'The analysis failed.') + (id ? ' The failed run was recorded in the history.' : '')])
      if (id) satApi.get(id).then((r) => onDone(r.analysis)).catch(() => {})
    } finally { setBusy('') }
  }

  if (loadErr) return <p role="alert" className="rounded-xl bg-critical-100 p-3 font-semibold text-critical-700">{loadErr}</p>
  if (!providers) return <p className="font-semibold">Loading imagery sources...</p>
  const num = (v: string) => (v === '' ? NaN : Number(v))

  return (
    <div className="space-y-5">
      <section>
        <h2 className="mb-2 text-xl font-semibold">1. Imagery source</h2>
        <div className="grid gap-2 md:grid-cols-2">
          {providers.map((p) => (
            <label key={p.id} className={`clay-sm block cursor-pointer p-3 ${providerId === p.id ? 'ring-2 ring-ink-900' : ''} ${p.state !== 'ready' ? 'opacity-80' : ''}`}>
              <input type="radio" name="provider" className="mr-2" checked={providerId === p.id} disabled={p.state !== 'ready'} onChange={() => pickProvider(p.id)} />
              <b>{p.name}</b>
              <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-bold ${p.state === 'ready' ? 'bg-success-100 text-success-700' : 'bg-critical-100 text-critical-700'}`}>{p.state === 'ready' ? 'Ready' : p.state === 'missing_credentials' ? 'Credentials missing' : 'Off'}</span>
              <span className="mt-1 block text-sm text-ink-700">{p.description}</span>
              <span className={`mt-1 block text-xs ${p.state === 'ready' ? 'text-ink-600' : 'font-semibold text-critical-700'}`}>{p.message}</span>
              <span className="mt-0.5 block text-xs text-ink-600">Licence: {p.license}</span>
            </label>
          ))}
        </div>
        {prov?.demo && <p role="alert" className="mt-2 rounded-xl bg-critical-100 p-2.5 text-sm font-bold text-critical-700">DEMONSTRATION source: scenes are synthetic. Use it to try the tool, never as evidence.</p>}
        {prov && (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div><label className="label" htmlFor="coll">Imagery type</label><select id="coll" className="input" value={collection} onChange={(e) => { setCollection(e.target.value as CollectionId); setFound(null) }}>{prov.collections.map((c) => <option key={c} value={c}>{COLLECTION_LABELS[c]}</option>)}</select></div>
            {!isUpload && kind === 'optical' && <div><label className="label" htmlFor="cc">Skip scenes cloudier than {maxCloud}%</label><input id="cc" type="range" min={5} max={100} step={5} value={maxCloud} onChange={(e) => setMaxCloud(Number(e.target.value))} className="w-full" /></div>}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-xl font-semibold">2. Area of interest and dates</h2>
        <p className="mb-1 text-sm text-ink-700">Click two opposite corners on the map. Up to {limits.maxAoiKm2} km², so the analysis keeps a useful resolution.</p>
        <div className="h-72 overflow-hidden rounded-2xl border-2 border-sand-300"><AoiMap bbox={bbox} onChange={setBbox} center={bbox ? [(bbox[1] + bbox[3]) / 2, (bbox[0] + bbox[2]) / 2] : [DEFAULT_CENTER[0], DEFAULT_CENTER[1]]} /></div>
        <p className="mt-1 text-sm font-semibold">{bbox ? `Selected: ${area.toFixed(1)} km² (${bbox.join(', ')})` : 'No area selected yet.'}</p>
        {isUpload ? (
          <p className="mt-2 text-sm text-ink-700">For your own imagery the dates come from the declaration below, not from a search.</p>
        ) : (
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {([['Before (baseline)', beforeR, setBeforeR], ['After (event)', afterR, setAfterR]] as const).map(([t, r, set]) => (
              <fieldset key={t} className="grid grid-cols-2 gap-2"><legend className="label">{t}</legend>
                <input type="date" className="input" aria-label={`${t} start`} value={r.start} max={iso(new Date())} onChange={(e) => set({ ...r, start: e.target.value })} />
                <input type="date" className="input" aria-label={`${t} end`} value={r.end} max={iso(new Date())} onChange={(e) => set({ ...r, end: e.target.value })} />
              </fieldset>
            ))}
          </div>
        )}
        <p className="mt-1 text-xs text-ink-600">Prefer a baseline from the same time of year, and imagery from the same sensor. Ranges up to {limits.maxRangeDays} days.</p>
      </section>

      {!isUpload && (
        <section>
          <button type="button" className="btn-dark" disabled={busy !== '' || !providerId} onClick={search}><Icon name="search" size={18} /> {busy === 'search' ? 'Searching...' : '3. Find available imagery'}</button>
          {found && (
            <div className="mt-3 space-y-3">
              {found.synthetic && <p role="alert" className="rounded-xl bg-critical-100 p-2.5 text-sm font-bold text-critical-700">DEMONSTRATION: these scenes are synthetic.</p>}
              {found.notes.map((n, i) => <p key={i} className="rounded-xl bg-amber-50 p-2.5 text-sm font-semibold text-amber-900">{n}</p>)}
              <div className="grid gap-4 lg:grid-cols-2"><SceneTable title="Before" rows={found.before} value={beforeId} onPick={setBeforeId} /><SceneTable title="After" rows={found.after} value={afterId} onPick={setAfterId} /></div>
            </div>
          )}
        </section>
      )}

      {isUpload && (
        <section className="space-y-2">
          <h2 className="text-xl font-semibold">3. Your imagery</h2>
          <p className="text-sm text-ink-700">GeoTIFF, WGS84 or UTM, north-up, up to {Math.round(limits.maxUploadBytes / 1048576)} MB each. VYRA cannot verify the details you declare, so they are recorded as declared by you. The files themselves are not kept, only their fingerprint.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <div><label className="label" htmlFor="fb">Before image</label><input id="fb" type="file" accept=".tif,.tiff,image/tiff" className="input" onChange={(e) => setFiles({ ...files, before: e.target.files?.[0] ?? null })} /></div>
            <div><label className="label" htmlFor="fa">After image</label><input id="fa" type="file" accept=".tif,.tiff,image/tiff" className="input" onChange={(e) => setFiles({ ...files, after: e.target.files?.[0] ?? null })} /></div>
            <div><label className="label" htmlFor="bd">Before acquisition date</label><input id="bd" type="date" className="input" max={iso(new Date())} value={decl.beforeDate} onChange={(e) => setDecl({ ...decl, beforeDate: e.target.value })} /></div>
            <div><label className="label" htmlFor="ad">After acquisition date</label><input id="ad" type="date" className="input" max={iso(new Date())} value={decl.afterDate} onChange={(e) => setDecl({ ...decl, afterDate: e.target.value })} /></div>
            <div><label className="label" htmlFor="pf">Platform / sensor</label><input id="pf" className="input" placeholder="e.g. PlanetScope, drone, Sentinel-2B" value={decl.platform} onChange={(e) => setDecl({ ...decl, platform: e.target.value })} /></div>
            <div><label className="label" htmlFor="bo">Band order in the file</label><input id="bo" className="input" value={decl.bands} onChange={(e) => setDecl({ ...decl, bands: e.target.value })} aria-describedby="bo-h" /><p id="bo-h" className="text-xs text-ink-600">{kind === 'optical' ? 'Optical: green, red, nir, swir (blue optional).' : 'Radar: vv and/or vh.'}</p></div>
            {kind === 'sar' && <div><label className="label" htmlFor="su">Radar values are in</label><select id="su" className="input" value={decl.sarUnit} onChange={(e) => setDecl({ ...decl, sarUnit: e.target.value })}><option value="linear">Linear power</option><option value="db">Decibels (dB)</option></select></div>}
          </div>
          <label className="flex items-start gap-2 text-sm font-semibold"><input type="checkbox" className="mt-1" checked={decl.license} onChange={(e) => setDecl({ ...decl, license: e.target.checked })} /> I am licensed to use this imagery in VYRA and to keep reduced-resolution previews of it here.</label>
        </section>
      )}

      <section>
        <details><summary className="cursor-pointer text-base font-bold">Detection settings ({kind === 'optical' ? 'water index' : 'radar'})</summary>
          {kind === 'optical' ? (
            <div className="mt-2 grid gap-2 sm:grid-cols-4">
              <div><label className="label" htmlFor="oi">Index</label><select id="oi" className="input" value={opt.index} onChange={(e) => setOpt({ ...opt, index: e.target.value as 'mndwi' | 'ndwi' })}><option value="mndwi">MNDWI (green/SWIR)</option><option value="ndwi">NDWI (green/NIR)</option></select></div>
              <div><label className="label" htmlFor="ot">Water above</label><input id="ot" type="number" step={0.05} className="input" value={opt.waterThreshold} onChange={(e) => setOpt({ ...opt, waterThreshold: num(e.target.value) })} /></div>
              <div><label className="label" htmlFor="ov">Vegetation drop</label><input id="ov" type="number" step={0.05} className="input" value={opt.ndviDrop} onChange={(e) => setOpt({ ...opt, ndviDrop: num(e.target.value) })} /></div>
              <div><label className="label" htmlFor="om">Min. cluster (px)</label><input id="om" type="number" className="input" value={opt.minClusterPixels} onChange={(e) => setOpt({ ...opt, minClusterPixels: num(e.target.value) })} /></div>
            </div>
          ) : (
            <div className="mt-2 grid gap-2 sm:grid-cols-4">
              <div><label className="label" htmlFor="sp">Polarization</label><select id="sp" className="input" value={sar.polarization} onChange={(e) => setSar({ ...sar, polarization: e.target.value as 'VV' | 'VH' })}><option>VV</option><option>VH</option></select></div>
              <div><label className="label" htmlFor="sw">Water below (dB)</label><input id="sw" type="number" className="input" value={sar.waterThresholdDb} onChange={(e) => setSar({ ...sar, waterThresholdDb: num(e.target.value) })} /></div>
              <div><label className="label" htmlFor="sc">Change (dB)</label><input id="sc" type="number" step={0.5} className="input" value={sar.changeDb} onChange={(e) => setSar({ ...sar, changeDb: num(e.target.value) })} /></div>
              <div><label className="label" htmlFor="sk">Speckle window</label><input id="sk" type="number" step={2} className="input" value={sar.speckleWindow} onChange={(e) => setSar({ ...sar, speckleWindow: num(e.target.value) })} /></div>
            </div>
          )}
          <p className="mt-1 text-xs text-ink-600">Defaults are common starting points, not tuned for your region. Every setting you use is saved with the result.</p>
        </details>
      </section>

      {errors.length > 0 && <ul role="alert" className="space-y-1 rounded-xl bg-critical-100 p-3 text-sm font-semibold text-critical-700">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
      <button type="button" className="btn-primary" disabled={busy !== '' || !providerId || (!isUpload && (!beforeId || !afterId))} onClick={run}>
        <Icon name="check" size={18} /> {busy === 'run' ? 'Analysing (can take up to a minute)...' : 'Run change detection'}
      </button>
      <p className="text-xs text-ink-600">Results are candidate changes for a person to review. They never confirm an incident or trigger any action. Last checked {formatTime(new Date().toISOString())}.</p>
    </div>
  )
}
