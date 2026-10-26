'use client'

<<<<<<< HEAD
// Stage 5 - Live disaster map: the map is the page. Filters float in a dock, a case opens in a sheet.
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import AlertBanner from '@/components/alerts/AlertBanner'
import SiteHeader from '@/components/common/SiteHeader'
import { DemoModeBanner, UpdatedDot } from '@/components/common/Badges'
import Icon from '@/components/ui/Icon'
import MapFilters, { type MapFilterState } from '@/components/map/MapFilters'
import IncidentSheet from '@/components/map/IncidentSheet'
import FloodPanel, { type FloodPick, type FloodView } from '@/components/flood/FloodPanel'
import { DEFAULT_FLOOD_TOGGLES, type FloodLayerToggles } from '@/components/flood/toggles'
import type { RouteFloodResult, ShelterFloodResult } from '@/lib/flood/integration'
import RouteAnalysisPanel from '@/components/routing/RouteAnalysisPanel'
import SatelliteMapPanel, { type SatSelection } from '@/components/satellite/SatelliteMapPanel'
import { useSession } from '@/lib/session'
import type { AnalysisResult, LatLng } from '@/lib/routing/types'
import type { LayerToggles, MapFocus, MapView } from '@/components/map/DisasterMap'
import ZoneSheet, { DEFAULT_ZONE_FILTERS, ZoneFilters, ZoneLegend, ZoneList, ZoneStatusBanner, type ZoneFilterState } from '@/components/map/ZoneUi'
import type { MapZone } from '@/components/map/ZoneLayer'
import { AREAS, DEFAULT_CENTER, PRIORITIES } from '@/lib/constants'
import { api, usePolledReports } from '@/lib/client'
import { useAlerts } from '@/lib/alerts/useAlerts'
import type { BlockedRoad, RescueTeam, Shelter } from '@/lib/types'
import { useZones } from '@/lib/zones/client'
import { bboxIntersects } from '@/lib/zones/geometry'
import { displayState, isPubliclyVisible, matchesSearch, matchesVerify, matchesView } from '@/lib/zones/rules'

// Leaflet touches `window` on import, so the overlay (like the map) loads in the browser only.
const RouteAnalysisLayer = dynamic(() => import('@/components/routing/RouteAnalysisLayer'), { ssr: false })

const FloodLayer = dynamic(() => import('@/components/flood/FloodLayer'), { ssr: false })

const DisasterMap = dynamic(() => import('@/components/map/DisasterMap'), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center bg-sand-200 font-semibold text-ink-600">Loading map...</div>,
})

// Leaflet needs the browser, so the overlay is loaded client-side only (like the map itself).
const SatelliteOverlayLayer = dynamic(() => import('@/components/satellite/SatelliteOverlayLayer'), { ssr: false })

export default function MapPage() {
  const [filters, setFilters] = useState<MapFilterState>({ area: '', status: 'open', priority: [...PRIORITIES], verified: '' })
  const [show, setShow] = useState<LayerToggles>({ reports: true, shelters: true, teams: true, roadBlocks: true, alerts: true })
  const [layers, setLayers] = useState<{ shelters: Shelter[]; teams: RescueTeam[]; roadBlocks: BlockedRoad[] }>({ shelters: [], teams: [], roadBlocks: [] })
  const [focus, setFocus] = useState<MapFocus>(null)
  const [dockOpen, setDockOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Route analysis (responders). Endpoints are picked on the map or from teams/cases.
  const { user } = useSession()
  const [routeOpen, setRouteOpen] = useState(false)
  const [satOpen, setSatOpen] = useState(false)
  const [sat, setSat] = useState<SatSelection | null>(null)
  const [origin, setOrigin] = useState<LatLng | null>(null)
  const [destination, setDestination] = useState<LatLng | null>(null)
  const [picking, setPicking] = useState<'origin' | 'destination' | null>(null)
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null)
  const [routeId, setRouteId] = useState<string | null>(null)
  // Deep link from a case: /map?dest=lat,lng opens the panel with the destination filled in.
  useEffect(() => {
    const m = /[?&]dest=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(window.location.search)
    if (m && Math.abs(+m[1]) <= 90 && Math.abs(+m[2]) <= 180) {
      setDestination([+m[1], +m[2]])
      setRouteOpen(true)
    }
  }, [])
  const pickPoint = (p: LatLng) => {
    if (picking === 'origin') setOrigin(p)
    else if (picking === 'destination') setDestination(p)
    setAnalysis(null) // endpoints changed: an old analysis must not look current
    setRouteId(null)
    setPicking(null)
  }

  // Flood simulator (responders and administrators). Simulated data lives only in this state and the flood tables.
  const isStaff = user?.role === 'responder' || user?.role === 'admin'
  const [floodOpen, setFloodOpen] = useState(false)
  const [floodView, setFloodView] = useState<FloodView>({ result: null, layers: null, id: null, name: '' })
  const [floodToggles, setFloodToggles] = useState<FloodLayerToggles>(DEFAULT_FLOOD_TOGGLES)
  const [floodOpacity, setFloodOpacity] = useState(0.7)
  const [floodPick, setFloodPick] = useState<FloodPick>(null)
  const [floodArea, setFloodArea] = useState<LatLng[]>([])
  const [floodSeeds, setFloodSeeds] = useState<LatLng[]>([])
  const [routeEvidence, setRouteEvidence] = useState<RouteFloodResult | null>(null)
  const [shelterEvidence, setShelterEvidence] = useState<ShelterFloodResult | null>(null)
  const shelterNotes = useMemo(() => {
    const out: Record<string, string> = {}
    if (!shelterEvidence) return out
    const label = { inside_estimated_extent: 'inside the estimated flood extent', near_estimated_extent: 'near the estimated flood extent', outside_extent_within_assessed_area: 'outside the estimated extent', outside_assessed_area: 'outside the assessed area, unknown' } as const
    for (const e of shelterEvidence.shelters) out[e.id] = `Flood ESTIMATE (supplementary): ${label[e.evidence]}. ${e.note}`
    return out
  }, [shelterEvidence])
  const floodPoint = (p: LatLng) => { if (floodPick === 'area') setFloodArea((a) => [...a, p]); else if (floodPick === 'seed') setFloodSeeds((a) => [...a, p]) }
  const closeFlood = () => { setFloodOpen(false); setFloodPick(null); setFloodView({ result: null, layers: null, id: null, name: '' }); setRouteEvidence(null); setShelterEvidence(null) }

  // ---- disaster zones ----
  const [zoneFilters, setZoneFilters] = useState<ZoneFilterState>(DEFAULT_ZONE_FILTERS)
  const [mapView, setMapView] = useState<MapView | null>(null)
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null)
  const [tick, setTick] = useState(() => Date.now())
  const zoneData = useZones(user, mapView)
  // Expiry is recomputed on the device every 30 s, so a cached zone that ends while offline is shown as EXPIRED.
  useEffect(() => { const t = setInterval(() => setTick(Date.now()), 30_000); return () => clearInterval(t) }, [])
  const allZones = useMemo<MapZone[]>(
    () => zoneData.zones.filter((z) => isPubliclyVisible(z, tick)).map((z) => ({ ...z, display_state: displayState(z, tick) })),
    [zoneData.zones, tick]
  )
  const shownZones = useMemo(
    () => allZones.filter((z) => matchesView(z, zoneFilters.view) && matchesVerify(z, zoneFilters.verify) && matchesSearch(z, zoneFilters.q)),
    [allZones, zoneFilters]
  )
  const zonesInView = useMemo(() => (mapView ? shownZones.filter((z) => bboxIntersects(z.bbox, mapView.bbox)) : shownZones), [shownZones, mapView])
  const selectedZone = shownZones.find((z) => z.id === selectedZoneId) ?? null
  const zoomToZone = (z: MapZone) => setFocus({ bounds: [[z.bbox[1], z.bbox[0]], [z.bbox[3], z.bbox[2]]], at: Date.now() })
  const pickZone = (z: MapZone | null) => { setSelectedZoneId(z?.id ?? null); if (z) setSelectedId(null) }
  // The zone filter also governs the existing shelter and blocked-road layers. Those layers hold verified records only.
  const effShow: LayerToggles = {
    ...show,
    shelters: show.shelters && ['all', 'shelters'].includes(zoneFilters.view) && zoneFilters.verify !== 'unverified',
    roadBlocks: show.roadBlocks && ['all', 'hazard', 'roads'].includes(zoneFilters.view) && zoneFilters.verify !== 'unverified',
  }
  const searchHit = zoneFilters.q && shownZones.length ? shownZones[0] : null

  // Open the dock by default on wide screens only.
  useEffect(() => setDockOpen(window.matchMedia('(min-width: 768px)').matches), [])
=======
// Stage 5 - Live Disaster Map
import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import SiteHeader from '@/components/common/SiteHeader'
import { DemoModeBanner, UpdatedDot } from '@/components/common/Badges'
import MapFilters, { type MapFilterState } from '@/components/map/MapFilters'
import type { LayerToggles, MapFocus } from '@/components/map/DisasterMap'
import { AREAS, DEFAULT_CENTER, PRIORITIES } from '@/lib/constants'
import { api, usePolledReports } from '@/lib/client'
import type { BlockedRoad, RescueTeam, Shelter } from '@/lib/types'

const DisasterMap = dynamic(() => import('@/components/map/DisasterMap'), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center bg-gray-100 text-gray-500">Loading map...</div>,
})

export default function MapPage() {
  const [filters, setFilters] = useState<MapFilterState>({ area: '', status: 'open', priority: [...PRIORITIES], verified: '' })
  const [show, setShow] = useState<LayerToggles>({ reports: true, shelters: true, teams: true, roadBlocks: true })
  const [layers, setLayers] = useState<{ shelters: Shelter[]; teams: RescueTeam[]; roadBlocks: BlockedRoad[] }>({ shelters: [], teams: [], roadBlocks: [] })
  const [focus, setFocus] = useState<MapFocus>(null)
  const [panelOpen, setPanelOpen] = useState(false)
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895

  const query = useMemo(
    () => ({
      area: filters.area,
      status: filters.status,
      verified: filters.verified,
      // all urgencies selected = no filter; none selected = show nothing
      priority: filters.priority.length === PRIORITIES.length ? '' : filters.priority.join(',') || 'none',
    }),
    [filters]
  )
  const { reports, summary, mode, error, lastUpdated } = usePolledReports(api.listReports, query)
<<<<<<< HEAD
  const { alerts: allAlerts, status: alertStatus } = useAlerts()
  const mapAlerts = allAlerts.filter((a) => a.effective_status === 'active')
  const selected = reports.find((r) => r.id === selectedId) ?? null
=======
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895

  useEffect(() => {
    const load = () => api.mapLayers(filters.area).then(setLayers).catch(() => {})
    load()
    const t = setInterval(load, 60000)
    return () => clearInterval(t)
  }, [filters.area])

  useEffect(() => {
    const area = AREAS.find((a) => a.name === filters.area)
    setFocus(area ? { center: area.center, zoom: 13, at: Date.now() } : { center: DEFAULT_CENTER, zoom: 11, at: Date.now() })
  }, [filters.area])

  return (
    <div className="page flex h-screen flex-col">
      <SiteHeader />
<<<<<<< HEAD
      <AlertBanner />
      <DemoModeBanner mode={mode} />
      <main id="main" className="relative min-h-0 flex-1 p-3 pt-3 sm:px-5 sm:pb-5">
        <h1 className="sr-only">Live disaster map</h1>
        <div className="clay relative h-full overflow-hidden p-1.5" style={{ borderRadius: 32 }}>
          <div className="relative h-full overflow-hidden" style={{ borderRadius: 26 }}>
            <DisasterMap
              center={DEFAULT_CENTER}
              reports={reports}
              layers={layers}
              show={effShow}
              focus={focus}
              selectedId={selectedId}
              alerts={mapAlerts}
              onSelect={(r) => { setSelectedId(r?.id ?? null); if (r) setSelectedZoneId(null) }}
              onPick={picking ? pickPoint : floodPick ? floodPoint : undefined}
              shelterNotes={shelterNotes}
              zones={shownZones}
              selectedZoneId={selectedZoneId}
              onSelectZone={pickZone}
              onView={setMapView}
            >
              <RouteAnalysisLayer origin={origin} destination={destination} result={analysis} selectedId={routeId} onSelect={setRouteId} />
              {sat?.analysis.overlayBounds && <SatelliteOverlayLayer url={sat.url} bounds={sat.analysis.overlayBounds} opacity={sat.opacity} label={`Satellite change (advisory): ${sat.analysis.reviewState.replace(/_/g, ' ')}${sat.analysis.synthetic ? ' · DEMONSTRATION' : ''}`} />}
              {isStaff && floodOpen && (
                <FloodLayer
                  result={floodView.result}
                  layers={floodView.layers}
                  toggles={floodToggles}
                  opacity={floodOpacity}
                  drawPoints={floodArea}
                  seedPoints={floodSeeds}
                  floodedRuns={routeEvidence?.routes.find((r) => r.routeId === routeId)?.floodedRuns}
                />
              )}
            </DisasterMap>

            {/* Status chip: always visible, even with the dock closed */}
            <div className="clay-sm absolute left-3 top-3 z-[999] flex items-center gap-3 px-3.5 py-2 text-sm" style={{ borderRadius: 16 }}>
              <span className="font-bold">
                {reports.length} {reports.length === 1 ? 'report' : 'reports'}
              </span>
              <UpdatedDot at={lastUpdated} error={error} />
              <span className={`text-xs font-bold ${zoneData.source === 'live' ? 'text-ink-600' : 'text-critical-700'}`} role="status">
                Zones: {zoneData.source === 'live' ? `${shownZones.length} live` : zoneData.source === 'cache' ? 'saved, may be old' : 'unavailable'}
              </span>
              <button type="button" className="btn-ghost btn-sm -my-1 ml-1" aria-expanded={dockOpen} aria-controls="map-dock" onClick={() => setDockOpen((v) => !v)}>
                <Icon name="filter" size={16} />
                {dockOpen ? 'Hide filters' : 'Filters'}
              </button>
              <button type="button" className="btn-ghost btn-sm -my-1" aria-expanded={routeOpen} aria-controls="route-panel" onClick={() => setRouteOpen((v) => !v)}>
                <Icon name="route" size={16} />
                Routes
              </button>
              {isStaff && (
                <button type="button" className="btn-ghost btn-sm -my-1" aria-expanded={satOpen} aria-controls="satellite-panel" onClick={() => setSatOpen((v) => !v)}>
                  <Icon name="satellite" size={16} />
                  Satellite
                </button>
              )}
              {isStaff && (
                <button type="button" className="btn-ghost btn-sm -my-1" aria-expanded={floodOpen} aria-controls="flood-panel" onClick={() => { if (floodOpen) closeFlood(); else { setFloodOpen(true); setDockOpen(false) } }}>
                  <Icon name="wave" size={16} />
                  Flood simulator
                </button>
              )}
            </div>

            {dockOpen && (
              <aside
                id="map-dock"
                aria-label="Map filters"
                className="clay rise absolute inset-x-2 bottom-2 top-16 z-[1000] overflow-y-auto p-4 md:inset-x-auto md:bottom-3 md:left-3 md:top-[68px] md:w-[340px]"
                style={{ borderRadius: 24 }}
              >
                {error && <p className="mb-3 rounded-xl bg-critical-100 p-2.5 text-sm font-semibold text-critical-700" role="alert">{error.message}</p>}
                <MapFilters
                  filters={filters}
                  setFilters={setFilters}
                  show={show}
                  setShow={setShow}
                  summary={summary}
                  layerCounts={{ alerts: mapAlerts.length, alertsLive: alertStatus.isLive, shelters: layers.shelters.length, teams: layers.teams.length, roadBlocks: layers.roadBlocks.length }}
                />
                <button className="btn-ghost mt-4 w-full" onClick={() => setFocus({ fit: true, at: Date.now() })} disabled={!reports.length}>
                  <Icon name="search" size={18} /> Zoom to shown reports
                </button>

                <hr className="my-4 border-sand-300" />
                <div className="space-y-3">
                  <ZoneStatusBanner source={zoneData.source} fetchedAt={zoneData.fetchedAt} error={zoneData.error} feeds={zoneData.feeds} uncovered={zoneData.uncovered} onRetry={() => zoneData.reload()} />
                  <ZoneFilters filters={zoneFilters} setFilters={setZoneFilters} counts={{ shown: shownZones.length, total: allZones.length }} />
                  {searchHit && <button type="button" className="btn-ghost btn-sm w-full" onClick={() => { pickZone(searchHit); zoomToZone(searchHit) }}><Icon name="search" size={16} /> Go to best match: {searchHit.name}</button>}
                  <ZoneList zones={zonesInView} selectedId={selectedZoneId} onPick={(z) => { pickZone(z); zoomToZone(z) }} />
                  <ZoneLegend />
                  <Link href="/report" className="btn-primary w-full">
                    <Icon name="alert" size={18} /> Report an emergency <span className="text-xs font-semibold">(works offline)</span>
                  </Link>
                </div>
              </aside>
            )}

            {floodPick && (
              <p className="clay-sm absolute left-1/2 top-3 z-[1001] -translate-x-1/2 px-4 py-2 text-sm font-bold" role="status" style={{ borderRadius: 16 }}>
                Click the map to add {floodPick === 'area' ? 'a corner of the area' : 'a water source point'}
              </p>
            )}

            {isStaff && floodOpen && (
              <aside
                id="flood-panel"
                aria-label="Flood simulator"
                className="clay rise absolute inset-x-2 bottom-2 top-16 z-[1000] overflow-y-auto p-4 md:inset-x-auto md:bottom-3 md:left-3 md:top-[68px] md:w-[400px]"
                style={{ borderRadius: 24 }}
              >
                <FloodPanel
                  view={floodView}
                  setView={setFloodView}
                  toggles={floodToggles}
                  setToggles={setFloodToggles}
                  opacity={floodOpacity}
                  setOpacity={setFloodOpacity}
                  pick={floodPick}
                  setPick={setFloodPick}
                  areaPoints={floodArea}
                  setAreaPoints={setFloodArea}
                  seeds={floodSeeds}
                  setSeeds={setFloodSeeds}
                  zones={shownZones.map((z) => ({ id: z.id, name: z.name }))}
                  analysis={analysis}
                  routeEvidence={routeEvidence}
                  setRouteEvidence={setRouteEvidence}
                  setShelterEvidence={setShelterEvidence}
                  onZoomTo={(b) => setFocus({ bounds: [[b[1], b[0]], [b[3], b[2]]], at: Date.now() })}
                  onClose={closeFlood}
                />
              </aside>
            )}

            {picking && (
              <p className="clay-sm absolute left-1/2 top-3 z-[1001] -translate-x-1/2 px-4 py-2 text-sm font-bold" role="status" style={{ borderRadius: 16 }}>
                Click the map to set the {picking === 'origin' ? 'start (A)' : 'destination (B)'}
              </p>
            )}

            {satOpen && isStaff && (
              <aside id="satellite-panel" aria-label="Satellite change layer" className="clay rise absolute inset-x-2 bottom-2 top-16 z-[1000] overflow-y-auto p-4 md:inset-x-auto md:bottom-3 md:right-3 md:left-auto md:top-[68px] md:w-[340px]" style={{ borderRadius: 24 }}>
                <SatelliteMapPanel selection={sat} onSelect={setSat} onClose={() => setSatOpen(false)} />
              </aside>
            )}

            {routeOpen && (
              <aside
                id="route-panel"
                aria-label="Route analysis"
                className="clay rise absolute inset-x-2 bottom-2 top-16 z-[1000] overflow-y-auto p-4 md:inset-x-auto md:bottom-3 md:right-3 md:top-[68px] md:w-[400px]"
                style={{ borderRadius: 24 }}
              >
                <RouteAnalysisPanel
                  user={user}
                  origin={origin}
                  destination={destination}
                  setOrigin={(p) => { setOrigin(p); setAnalysis(null); setRouteId(null) }}
                  setDestination={(p) => { setDestination(p); setAnalysis(null); setRouteId(null) }}
                  picking={picking}
                  setPicking={setPicking}
                  result={analysis}
                  setResult={setAnalysis}
                  selectedId={routeId}
                  setSelectedId={setRouteId}
                  teams={layers.teams}
                  reports={reports}
                  onClose={() => { setRouteOpen(false); setPicking(null) }}
                  floodEvidence={routeEvidence}
                />
              </aside>
            )}

            {selected && <IncidentSheet report={selected} onClose={() => setSelectedId(null)} />}
            {selectedZone && !selected && (
              <ZoneSheet
                zone={selectedZone}
                feeds={zoneData.feeds}
                shelters={layers.shelters}
                roadBlocks={layers.roadBlocks}
                reports={reports}
                source={zoneData.source}
                fetchedAt={zoneData.fetchedAt}
                canEdit={user?.role === 'responder' || user?.role === 'admin'}
                onClose={() => setSelectedZoneId(null)}
                onZoomTo={zoomToZone}
              />
            )}
          </div>
        </div>
      </main>
=======
      <DemoModeBanner mode={mode} />
      <div className="relative flex min-h-0 flex-1">
        <aside
          className={`absolute inset-y-0 left-0 z-[1000] w-72 overflow-y-auto border-r border-gray-200 bg-white p-4 shadow-lg transition-transform md:static md:translate-x-0 md:shadow-none ${
            panelOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <div className="mb-3 flex items-center justify-between">
            <h1 className="text-lg font-bold">Live disaster map</h1>
            <button className="text-gray-500 md:hidden" onClick={() => setPanelOpen(false)} aria-label="Close filters">✕</button>
          </div>
          <div className="mb-4 flex items-center justify-between">
            <span className="text-sm text-gray-600">
              <strong>{reports.length}</strong> {reports.length === 1 ? 'report' : 'reports'} shown
            </span>
            <UpdatedDot at={lastUpdated} error={error} />
          </div>
          {error && <p className="mb-3 rounded bg-red-50 p-2 text-xs text-red-700">{error.message}</p>}
          <MapFilters
            filters={filters}
            setFilters={setFilters}
            show={show}
            setShow={setShow}
            summary={summary}
            layerCounts={{ shelters: layers.shelters.length, teams: layers.teams.length, roadBlocks: layers.roadBlocks.length }}
          />
          <button className="btn-ghost mt-4 w-full" onClick={() => setFocus({ fit: true, at: Date.now() })} disabled={!reports.length}>
            Zoom to shown reports
          </button>
        </aside>

        <div className="relative flex-1">
          <button className="btn-primary absolute left-3 top-3 z-[999] shadow md:hidden" onClick={() => setPanelOpen(true)}>
            Filters
          </button>
          <DisasterMap center={DEFAULT_CENTER} reports={reports} layers={layers} show={show} focus={focus} />
        </div>
      </div>
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
    </div>
  )
}
