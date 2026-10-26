'use client'

// Everything people see around the zone layer: filters, search, legend, status banners, the zone list
// (a keyboard / screen-reader friendly alternative to tapping shapes) and the zone details sheet.
import { useEffect, useId } from 'react'
import Link from 'next/link'
import Icon from '../ui/Icon'
import { formatTime, shortId } from '@/lib/client'
import { areaKm2, lineLengthKm, pathTouchesZone, pointInZone } from '@/lib/zones/geometry'
import {
  ageLabel, freshnessOf, MAP_DISCLAIMER, SEVERITY_LABELS, HAZARD_LABELS, SOURCE_LABELS, STATE_LABELS, VERIFICATION_INFO, VERIFY_FILTERS, VIEW_LABELS, ZONE_STYLES, ZONE_VIEWS, zoneLabel,
  type VerifyFilter, type ZoneView,
} from '@/lib/zones/rules'
import type { ZoneSource } from '@/lib/zones/client'
import type { DisasterZone, DisplayState, FeedStatus, ZoneType } from '@/lib/zones/types'
import type { BlockedRoad, Shelter, TriagedReport } from '@/lib/types'
import { zoneEvidence } from '@/lib/zones/evidence'
import type { MapZone } from './ZoneLayer'
import SatelliteFindings from '../satellite/SatelliteFindings'
import { SafetyLink } from '../safety/SafetyUi'
import { ZONE_HAZARD_TO_GUIDE } from '@/lib/safety'

const ENDED: DisplayState[] = ['expired', 'cancelled', 'deactivated']

export function ZoneSwatch({ type, size = 26 }: { type: ZoneType; size?: number }) {
  const s = ZONE_STYLES[type]
  const id = useId().replace(/:/g, '')
  const p = { crosshatch: <path d="M0 0L8 8M8 0L0 8" />, diagonal: <path d="M-2 2L2 -2M0 8L8 0M6 10L10 6" />, dots: <circle cx="4" cy="4" r="1.5" fill={s.colour} stroke="none" />, horizontal: <path d="M0 4H8" />, plus: <path d="M4 1.5V6.5M1.5 4H6.5" />, grid: <path d="M0 0H8M0 0V8" /> }[s.pattern]
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" aria-hidden="true" className="shrink-0">
      <defs><pattern id={id} width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill={s.fill} fillOpacity=".25" /><g stroke={s.colour} strokeWidth="1.4" fill="none">{p}</g></pattern></defs>
      <rect x="2" y="2" width="22" height="22" rx="4" fill={`url(#${id})`} stroke={s.colour} strokeWidth="2.5" strokeDasharray={s.dash ?? undefined} />
      <text x="13" y="18" textAnchor="middle" fontSize="13" fontWeight="800" fill="#182B3A" stroke="#fff" strokeWidth="2.5" paintOrder="stroke">{s.glyph}</text>
    </svg>
  )
}

export function TrustBadge({ v }: { v: DisasterZone['verification_status'] }) {
  const cls = v === 'official' ? 'bg-primary-100 text-primary-800' : v === 'human_verified' ? 'bg-success-100 text-success-800' : 'bg-warning-100 text-warning-700'
  return <span className={`pill ${cls}`} title={VERIFICATION_INFO[v].desc}><Icon name={v === 'unverified' || v === 'ai_suggested' ? 'info' : 'shield'} size={13} /> {VERIFICATION_INFO[v].label}</span>
}

// ---- filters, search, legend ----------------------------------------------------------------------------
export interface ZoneFilterState { view: ZoneView; verify: VerifyFilter; q: string }
export const DEFAULT_ZONE_FILTERS: ZoneFilterState = { view: 'all', verify: 'all', q: '' }
const VERIFY_LABELS: Record<VerifyFilter, string> = { all: 'All information', verified: 'Verified or official only', unverified: 'Unverified only' }

export function ZoneFilters({ filters, setFilters, counts }: { filters: ZoneFilterState; setFilters: (f: ZoneFilterState) => void; counts: { shown: number; total: number } }) {
  const dirty = filters.view !== 'all' || filters.verify !== 'all' || !!filters.q
  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-display text-base font-semibold">Zones</h3>
        <span className="text-xs font-semibold text-ink-600" role="status">{counts.shown} of {counts.total} shown</span>
      </div>
      <div>
        <label className="label" htmlFor="zone-search">Search zones and places</label>
        <input id="zone-search" type="search" className="input" placeholder="e.g. Lyari, flood, shelter" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
      </div>
      <div>
        <label className="label" htmlFor="zone-view">Show</label>
        <select id="zone-view" className="input" value={filters.view} onChange={(e) => setFilters({ ...filters, view: e.target.value as ZoneView })}>
          {ZONE_VIEWS.map((v) => <option key={v} value={v}>{VIEW_LABELS[v]}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="zone-verify">Verification</label>
        <select id="zone-verify" className="input" value={filters.verify} onChange={(e) => setFilters({ ...filters, verify: e.target.value as VerifyFilter })}>
          {VERIFY_FILTERS.map((v) => <option key={v} value={v}>{VERIFY_LABELS[v]}</option>)}
        </select>
      </div>
      <button type="button" className="btn-ghost btn-sm w-full" onClick={() => setFilters(DEFAULT_ZONE_FILTERS)} disabled={!dirty}>
        <Icon name="close" size={16} /> Reset filters
      </button>
    </div>
  )
}

export function ZoneLegend() {
  return (
    <div className="clay-inset space-y-2 p-3 text-xs text-ink-700">
      <p className="font-display text-sm font-semibold text-ink-900">Zone legend</p>
      <ul className="space-y-1.5">
        {(Object.keys(ZONE_STYLES) as ZoneType[]).map((t) => (
          <li key={t} className="flex items-start gap-2">
            <ZoneSwatch type={t} />
            <span><strong className="text-ink-900">{ZONE_STYLES[t].label}</strong> <span className="font-bold">({ZONE_STYLES[t].short})</span><br />{ZONE_STYLES[t].meaning}</span>
          </li>
        ))}
      </ul>
      <p><strong>Not only colour:</strong> every type has its own pattern, outline and word. Thicker outline = higher severity.</p>
      <p><strong>OFFICIAL</strong> = issued by an authority. <strong>VERIFIED</strong> = checked by a responder, not an official warning. <strong>UNVERIFIED</strong> (dashed label) = reported, not checked. <strong>APPROX.</strong> = boundary is approximate.</p>
      <p>Gray dotted pattern with a struck-through label = <strong>expired, cancelled or deactivated</strong>; kept visible for 24 hours so the change is seen.</p>
      <p className="font-semibold text-ink-900">{MAP_DISCLAIMER}</p>
    </div>
  )
}

// ---- banners -----------------------------------------------------------------------------------------------
export function ZoneStatusBanner({ source, fetchedAt, error, feeds, uncovered, onRetry }: { source: ZoneSource; fetchedAt: string | null; error: string | null; feeds: FeedStatus[]; uncovered: number; onRetry: () => void }) {
  const now = Date.now()
  const staleFeeds = feeds.filter((f) => !f.last_success_at || now - Date.parse(f.last_success_at) > f.stale_after_minutes * 60_000 || f.last_error)
  const items: { tone: 'warn' | 'bad'; text: string }[] = []
  if (source === 'cache') items.push({ tone: 'bad', text: `OFFLINE / SAVED DATA: zones below were last updated ${fetchedAt ? `${formatTime(fetchedAt)} (${ageLabel(fetchedAt)})` : 'at an unknown time'}. They may be out of date, and new hazards or cancellations will not appear until you are back online.` })
  if (source === 'none') items.push({ tone: 'bad', text: 'No zone data is available. This does NOT mean the area is safe. Follow official instructions and report any danger you see.' })
  if (source === 'live' && uncovered > 0.5) items.push({ tone: 'warn', text: 'Zone data for most of this view has not been loaded. No zones shown here does not mean it is safe.' })
  for (const f of staleFeeds) items.push({ tone: 'warn', text: `${f.name}: the official feed has not refreshed successfully${f.last_success_at ? ` since ${formatTime(f.last_success_at)}` : ''}. Its zones are the last known data and may be outdated.` })
  if (error && source === 'live') items.push({ tone: 'warn', text: error })
  if (!items.length) return null
  return (
    <div className="space-y-1.5" role="status" aria-live="polite">
      {items.map((i, n) => (
        <p key={n} className={`rounded-xl p-2.5 text-xs font-bold ${i.tone === 'bad' ? 'bg-critical-100 text-critical-700' : 'bg-warning-100 text-ink-900'}`}>
          <Icon name="alert" size={14} className="mr-1 inline" />{i.text}
        </p>
      ))}
      {source !== 'live' && <button type="button" className="btn-ghost btn-sm w-full" onClick={onRetry}>Try to refresh zones</button>}
    </div>
  )
}

// ---- list ---------------------------------------------------------------------------------------------------
export function ZoneList({ zones, selectedId, onPick }: { zones: MapZone[]; selectedId: string | null; onPick: (z: MapZone) => void }) {
  if (!zones.length) return <p className="clay-inset p-3 text-xs text-ink-700">No zones match here. That does not mean the area is safe.</p>
  return (
    <ul className="max-h-56 space-y-1 overflow-y-auto" aria-label="Zones in this view">
      {zones.slice(0, 60).map((z) => (
        <li key={z.id}>
          <button type="button" aria-current={z.id === selectedId} onClick={() => onPick(z)} className={`flex min-h-[44px] w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left text-sm hover:bg-sand-200/70 ${z.id === selectedId ? 'clay-inset' : ''}`}>
            <ZoneSwatch type={z.zone_type} size={24} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-bold">{z.name}</span>
              <span className="block truncate text-xs text-ink-600">{ENDED.includes(z.display_state) ? STATE_LABELS[z.display_state].split(' - ')[0] : zoneLabel(z)} · {VERIFICATION_INFO[z.verification_status].short}</span>
            </span>
          </button>
        </li>
      ))}
      {zones.length > 60 && <li className="px-2 text-xs text-ink-600">Showing 60 of {zones.length}. Zoom in or filter to see the rest.</li>}
    </ul>
  )
}

// ---- details sheet --------------------------------------------------------------------------------------------
const Row = ({ k, children }: { k: string; children: React.ReactNode }) => (
  <div><dt className="text-xs font-bold uppercase tracking-wide text-ink-500">{k}</dt><dd className="mt-0.5 text-sm text-ink-800">{children}</dd></div>
)

export default function ZoneSheet({ zone: z, feeds, shelters, roadBlocks, reports, source, fetchedAt, canEdit, onClose, onZoomTo }: {
  zone: MapZone; feeds: FeedStatus[]; shelters: Shelter[]; roadBlocks: BlockedRoad[]; reports: TriagedReport[]
  source: ZoneSource; fetchedAt: string | null; canEdit: boolean; onClose: () => void; onZoomTo: (z: MapZone) => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const style = ZONE_STYLES[z.zone_type]
  const ended = ENDED.includes(z.display_state)
  const fresh = freshnessOf(z, z.feed_id ? feeds.find((f) => f.feed_id === z.feed_id) : undefined)
  const linkedReports = reports.filter((r) => z.related_report_ids.includes(r.id))
  const missingReports = z.related_report_ids.length - linkedReports.length
  const insideShelters = shelters.filter((s) => z.related_shelter_ids.includes(s.id) || pointInZone([s.location_lng, s.location_lat], z.geometry, z.radius_m))
  const roads = roadBlocks.filter((r) => z.related_road_ids.includes(r.id) || pathTouchesZone(r.path.map(([lat, lng]) => [lng, lat]), z.geometry, z.radius_m))
  const km2 = areaKm2(z.geometry, z.radius_m)
  const km = z.geometry.type === 'LineString' ? lineLengthKm(z.geometry.coordinates) : null
  const ev = zoneEvidence(z, reports.flatMap((r) => (r.location_lat != null && r.location_lng != null ? [{ id: r.id, lat: r.location_lat, lng: r.location_lng, verified: r.verified, created_at: r.created_at, status: r.status }] : [])))
  const dangerous = z.zone_type === 'danger' || z.zone_type === 'elevated'

  return (
    <section role="region" aria-label={`Zone details: ${z.name}`} className="clay rise absolute inset-x-2 bottom-2 z-[1000] flex max-h-[78%] flex-col overflow-hidden md:inset-x-auto md:bottom-4 md:right-4 md:w-[410px] md:max-h-[calc(100%-2rem)]" style={{ borderRadius: 24 }}>
      <div className="overflow-y-auto p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <ZoneSwatch type={z.zone_type} />
            <span className="text-sm font-extrabold" style={{ color: style.colour }}>{zoneLabel(z)}</span>
          </div>
          <button type="button" onClick={onClose} className="btn-ghost btn-sm -mr-1 -mt-1 shrink-0 !px-2.5" aria-label="Close zone details"><Icon name="close" size={18} /></button>
        </div>
        <h2 className="mt-2 font-display text-2xl font-semibold leading-tight">{z.name}</h2>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <TrustBadge v={z.verification_status} />
          <span className="pill bg-sand-200 text-ink-800">Severity: {SEVERITY_LABELS[z.severity]}</span>
          <span className="pill bg-sand-200 text-ink-800">{HAZARD_LABELS[z.hazard_type]}</span>
        </div>

        {(ended || z.display_state === 'upcoming') && (
          <p className="mt-3 rounded-xl bg-critical-100 p-2.5 text-sm font-extrabold text-critical-700" role="alert">{STATE_LABELS[z.display_state]}{z.display_state === 'cancelled' && z.change_reason ? `: ${z.change_reason}` : ''}</p>
        )}
        {z.zone_type === 'evacuation' && (
          <p className={`mt-3 rounded-xl p-2.5 text-sm font-bold ${z.evacuation_status === 'order' ? 'bg-primary-100 text-primary-800' : 'bg-warning-100 text-ink-900'}`}>
            {z.evacuation_status === 'order' ? 'Official evacuation order. Follow the instructions of the authorities.' : 'Proposed evacuation plan. This is NOT an order. Wait for official instructions.'}
          </p>
        )}
        {z.zone_type === 'shelter' && <p className="mt-3 rounded-xl bg-success-100 p-2.5 text-sm font-bold text-success-800">A shelter marker does not mean the area around it is free of hazards. Check nearby zones and roads before you travel.</p>}
        {z.verification_status === 'unverified' && <p className="mt-3 rounded-xl bg-warning-100 p-2.5 text-sm font-semibold text-ink-900">Not verified yet: treat this as a possibility, not a confirmed fact.</p>}
        {source === 'cache' && <p className="mt-3 rounded-xl bg-critical-100 p-2.5 text-sm font-bold text-critical-700">Saved offline data from {fetchedAt ? formatTime(fetchedAt) : 'an unknown time'}. This may be out of date.</p>}
        {fresh.level !== 'fresh' && <p className="mt-3 rounded-xl bg-warning-100 p-2.5 text-sm font-bold text-ink-900">Possibly outdated: {fresh.label}.</p>}

        <dl className="mt-4 space-y-3">
          <Row k="What is happening">{z.description}</Row>
          {z.status_detail && <Row k="Exact status">{z.status_detail}</Row>}
          <Row k="What to do">{z.precautions || 'Follow official instructions. If you are in danger, call emergency services.'}{dangerous ? ' Do not assume a route is safe just because it avoids this zone.' : ''}</Row>
          <Row k="Affected area">
            {z.geometry.type === 'LineString' ? `A road segment about ${km!.toFixed(2)} km long.` : z.boundary_kind === 'circle' ? `Circle of ${z.radius_m} m around a point (about ${km2?.toFixed(2)} km²). Basis for the radius: ${z.radius_basis}.` : z.geometry.type === 'Point' ? 'A single location; no boundary is available.' : `About ${km2 && km2 < 0.01 ? '<0.01' : km2?.toFixed(2)} km².`}{' '}
            Boundary: <strong>{z.boundary_quality === 'official' ? 'official' : z.boundary_quality === 'surveyed' ? 'surveyed' : 'approximate, drawn by hand'}</strong>{z.boundary_kind === 'administrative' ? ' (administrative boundary)' : ''}.
          </Row>
          <Row k="In effect">{z.valid_from ? `From ${formatTime(z.valid_from)}` : 'Start not recorded'}{z.valid_until ? `, until ${formatTime(z.valid_until)}` : ', no expiry set (check the source)'}.</Row>
          <Row k="Source">
            {SOURCE_LABELS[z.source_type]}{z.source_name ? `: ${z.source_name}` : ''}.{' '}
            {z.source_url && <a href={z.source_url} target="_blank" rel="noopener noreferrer" className="font-bold underline">Open source<span className="sr-only"> (new tab)</span></a>}
          </Row>
          <Row k="Last updated">{formatTime(z.updated_at)} ({ageLabel(z.updated_at)}){z.revision > 1 ? `, revision ${z.revision}` : ''}.</Row>
        </dl>

        <div className="mt-4 space-y-3">
          <div>
            <h3 className="font-display text-base font-semibold">Report evidence</h3>
            <p className="mt-1 text-sm text-ink-800">{ev.total} open report{ev.total === 1 ? '' : 's'} linked or inside this zone ({ev.verified} verified, {ev.unverified} not verified, {ev.last24h} in the last 24 h).</p>
            <p className="text-xs text-ink-600">Counts use the reports currently loaded on the map. The zone boundary does not change by itself: a responder reviews suggestions. Few reports does not mean the area is safe.</p>
            <h3 className="mt-3 font-display text-base font-semibold">Emergency reports linked to this zone</h3>
            {linkedReports.length ? (
              <ul className="mt-1 space-y-1 text-sm">{linkedReports.map((r) => <li key={r.id}>#{shortId(r.id)} · {r.area} · {r.priority} urgency {canEdit && <Link href={`/dashboard?id=${r.id}`} className="font-bold underline">open</Link>}</li>)}</ul>
            ) : <p className="mt-1 text-sm text-ink-600">None linked.{z.related_report_ids.length ? '' : ' Reports near here may still exist; see the map markers.'}</p>}
            {missingReports > 0 && <p className="text-xs text-ink-600">{missingReports} linked report{missingReports > 1 ? 's are' : ' is'} not in the current report filter.</p>}
          </div>
          <div>
            <h3 className="font-display text-base font-semibold">Shelters inside or linked</h3>
            {insideShelters.length ? <ul className="mt-1 space-y-1 text-sm">{insideShelters.map((s) => <li key={s.id}>{s.name} · {s.status}</li>)}</ul> : <p className="mt-1 text-sm text-ink-600">No verified shelter is mapped inside this zone. It may be incomplete.</p>}
          </div>
          <div>
            <h3 className="font-display text-base font-semibold">Known road blockages</h3>
            {roads.length ? <ul className="mt-1 space-y-1 text-sm">{roads.map((r) => <li key={r.id}>{r.description} ({r.reason})</li>)}</ul> : <p className="mt-1 text-sm text-ink-600">None known. Other roads may be blocked too.</p>}
          </div>
        </div>

        {ZONE_HAZARD_TO_GUIDE[z.hazard_type] && (
          <div className="mt-4 space-y-1.5">
            <h3 className="font-display text-base font-semibold">Safety instructions for this hazard</h3>
            <div className="flex flex-wrap gap-2">
              <SafetyLink hazard={ZONE_HAZARD_TO_GUIDE[z.hazard_type]!} phase="during" label="What to do during" />
              <SafetyLink hazard={ZONE_HAZARD_TO_GUIDE[z.hazard_type]!} phase="waiting" label="While waiting for rescue" />
            </div>
            <p className="text-xs text-ink-600">General precautions. Official instructions for this zone come first.</p>
          </div>
        )}
        {canEdit && <div className="mt-4"><SatelliteFindings targetType="zone" targetId={z.id} /></div>}

        <p className="mt-4 text-xs font-semibold text-ink-700">{MAP_DISCLAIMER}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="btn-primary btn-sm" onClick={() => onZoomTo(z)}><Icon name="search" size={16} /> Zoom to zone</button>
          {canEdit && <Link href={`/admin/zones?id=${z.id}`} className="btn-ghost btn-sm">Manage zone <Icon name="arrow" size={16} /></Link>}
        </div>
      </div>
    </section>
  )
}
