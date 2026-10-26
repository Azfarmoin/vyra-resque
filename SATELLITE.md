# Satellite imagery comparison and disaster change detection

A responder/administrator tool inside VYRA that compares satellite imagery from two periods, flags **candidate** changes in surface water, inundation and vegetation, shows them on the live map, and lets a person review and link them to incidents, hazards and zones.

> **Satellite findings are advisory.** A detected change is not proof of a disaster or of a current emergency. The module never confirms an incident, closes a road, dispatches a team or changes a triage priority. That is enforced by tests (see *Safety*).

## What was added

| Area | Files |
|---|---|
| Page | `src/app/satellite/page.tsx` (header link "Satellite", responders and admins only) |
| UI | `src/components/satellite/` (`Workbench`, `AoiMap`, `CompareViewer`, `AnalysisDetail`, `LinkPanel`, `SatelliteMapPanel`, `SatelliteOverlayLayer`, `SatelliteFindings`) |
| API | `src/app/api/satellite/` : `providers`, `search`, `analyses`, `analyses/[id]`, `.../image/[kind]`, `.../review`, `.../links` |
| Core | `src/lib/satellite/` : `validation`, `quality`, `service`, `repo`, `analysis/` (engine, clusters, PNG), `raster/` (grid, GeoTIFF reader), `providers/` |
| Database | `supabase/migrations/014_satellite_analysis.sql` (also added to `npm run db:setup`) |
| Existing screens touched (additive) | `/map` (Satellite button + overlay panel), incident detail (`CaseDetail`: "Satellite findings"), zone sheet (`ZoneUi`: "Satellite findings"), `SiteHeader` (link), `Icon` (one icon), `package.json`, `.env.example` |

No existing route, table, rule or test was changed. New dependencies: `geotiff`, `proj4` (+ `@types/proj4`).

### About "flood simulator" and "analyst"
The uploaded project has **no flood simulator and no analyst role.** Findings can be linked to **incident reports**, **hazards** (route-hazard / blocked-road / report-derived hazards from the routing module) and **zones** (disaster zones, which carry the flood hazard type). Access is for the existing `responder` and `admin` roles. If you later add a flood-scenario table or an analyst role, add a value to `LINK_TARGETS` / reuse `requireResponder` and nothing else needs to change.

## Setup

1. `npm install` (installs `geotiff`, `proj4`).
2. **Database (Supabase mode):** run `supabase/migrations/014_satellite_analysis.sql` in the SQL editor, or `npm run db:setup`. It needs `profiles` and `public.current_user_role()` from the earlier migrations. Safe to run twice.
3. Environment: copy the *Satellite* block of `.env.example`. **No variable is required** for the Planetary Computer source, user uploads, or demonstration mode. See the table below.
4. `npm run dev` (or `npm run dev:demo` for demo data, which also switches the demonstration source on). Sign in as a responder or admin and open **Satellite** in the header.

### Environment variables

| Variable | Required? | Purpose |
|---|---|---|
| `SATELLITE_PROVIDERS` | no | Comma list of sources to offer. Default `planetary-computer,cdse-sentinelhub,user-upload`. |
| `PC_SUBSCRIPTION_KEY` | no | Raises Planetary Computer rate limits. Anonymous access works. |
| `PC_STAC_URL`, `PC_SAS_URL` | no | Override the Planetary Computer endpoints. |
| `CDSE_CLIENT_ID`, `CDSE_CLIENT_SECRET` | **yes, to use Copernicus Data Space** | OAuth client from the CDSE dashboard. Missing => the source shows **Credentials missing** (naming the variables) and is never called. |
| `CDSE_BASE_URL`, `CDSE_TOKEN_URL` | no | Override CDSE endpoints. |
| `SATELLITE_DEMO_MODE` | no | `true` enables the synthetic demonstration source (always on when `VYRA_DATA_MODE=demo`). |
| `SATELLITE_MAX_AOI_KM2` / `_MAX_RANGE_DAYS` / `_MAX_GRID` / `_MAX_UPLOAD_MB` | no | Limits: 400 km², 45 days, 640 px, 40 MB. |

Supabase variables are the same as the rest of VYRA; the satellite tables are written with the signed-in user's own token, so row-level security applies.

## Imagery sources

| Source | Data | Access | Notes |
|---|---|---|---|
| Microsoft Planetary Computer | Sentinel-2 L2A, Sentinel-1 RTC (gamma0), Landsat 8/9 C2 L2 | Public STAC, short-lived SAS tokens fetched automatically | Needs outbound internet from the server. |
| Copernicus Data Space (Sentinel Hub) | Sentinel-2 L2A, Sentinel-1 GRD (terrain-corrected gamma0) | **Authorised API** (OAuth client) | Scenes are identified by catalogue item and cut by acquisition time ±30 s. |
| Your own imagery | Two GeoTIFFs (optical or radar), WGS84 or UTM, north-up | Upload | You confirm you hold the licence. Date, platform and sensor type are **recorded as declared by you**. The files are **not stored**; only metadata and SHA-256 are. |
| Demonstration | Synthetic river/cloud/cleared-field scenes | Switch | Labelled DEMONSTRATION everywhere; can never be confirmed or linked outside demo data mode. |

Each result shows its licence and attribution. Open Copernicus/Landsat data may be used freely with attribution; Sentinel-1 RTC from Planetary Computer is CC BY 4.0. Commercial or restricted imagery is only reachable through your own upload, under your own licence. Only reduced-resolution previews (at the analysis grid, at most 640 px on the long side by default) are stored.

## How it works

1. **Search** (`POST /api/satellite/search`): validated dates and area, then each provider's catalogue. Shows acquisition time, platform, resolution, scene cloud cover, orbit geometry and a quality hint. Items with missing dates/bands or invalid cloud values are skipped and counted; items outside the requested dates are dropped even if the provider returned them. "No imagery found" is stated plainly.
2. **Analyse** (`POST /api/satellite/analyses`): scenes are re-fetched by ID on the server (the browser's copy of the metadata is never trusted), both are resampled onto one WGS84 grid by geographic position (so differing CRS/resolution still line up), then change detection runs.
   * **Optical** (`optical_water_index_v1`): MNDWI (green/SWIR) or NDWI (green/NIR) water mask per date, plus NDVI change. Only pixels **clear on both dates** count: Sentinel-2 SCL (cloud, shadow, cirrus, snow, no-data) and Landsat QA_PIXEL are applied.
   * **Radar** (`sar_backscatter_change_v1`): linear-power boxcar multilook, dB conversion, dark-after/not-dark-before with a minimum drop = possible new open water; a brightness rise is reported separately as *ambiguous backscatter*, never as flooding.
   * Small clusters (default < 4 px) are dropped as noise/misregistration.
   * Classes: possible new water, possible water loss, possible vegetation loss/gain, backscatter increase, **no usable data** (drawn grey: unknown is never shown as "no change").
3. **Quality checks** are saved with every result: usable fraction, per-date masked fraction, scene cloud cover, **seasonal gap**, **sensor difference**, **resolution mismatch**, **SAR orbit/geometry mismatch**, **partial coverage**, **downsampling**, **no cloud mask for uploads**, low pixel agreement (possible misalignment), and a note that sub-pixel registration cannot be measured. A rating (good / fair / poor / unusable) summarises them. Analyses with under 2% usable pixels **fail** instead of reporting "no change".
4. **Review** (`.../review`): Needs Review (default), Confirmed by Reviewer, Not Disaster-Related, Inconclusive. Confirming needs a note of 10+ characters and an explicit acknowledgement, and is refused for failed, *unusable* and demonstration analyses. Reviews are an append-only history.
5. **Link** (`.../links`): attach a finding to an incident report, hazard or zone as advisory evidence. The target must exist; duplicates and failed analyses are refused. Linked findings appear in the incident detail and zone sheet with their review state.
6. **Map**: `/map` → **Satellite** (responders/admins) overlays a saved analysis's change layer with an opacity slider, legend, review state and the advisory notice.
7. **Compare**: side by side, swipe and opacity overlay, panned and zoomed together, with an optional detected-change layer.

## What is saved

Every analysis (even failed ones) stores: imagery identifiers and **original provider metadata as received**, acquisition dates, requested date ranges, area, method and version, parameters, quality checks and rating, statistics, plain-language findings, limitations, processing time, who ran it and when, plus three PNG previews. Reviews and links are separate append-only rows with reviewer, time, note and acknowledgement. Database triggers refuse any UPDATE or DELETE of analyses, reviews and links, even for the service role.

## Safety and accuracy rules (and where they are enforced)

* Never claims a change is caused by a disaster: findings say "possible", every result lists method limitations, and the advisory text appears on the page, map panel, API responses and linked-record panels.
* Never treats satellite output as proof of an emergency; **no automatic confirmation, road closure, dispatch or triage change**: the service only writes `satellite_*` records (test: before/after snapshots of every report and zone; a source scan fails the build if satellite code touches reports, zones, teams, dispatches or roads, and was checked to fail when a violation is injected).
* Missing credentials, a disabled demo, no imagery, provider outages, invalid responses and failed processing are all shown as such, never as an empty "no change".
* Responder/admin only on every route and in the database (RLS).

## Limitations you should know

* **The providers were tested against scripted HTTP responses and locally generated GeoTIFFs, not against the live Planetary Computer or Copernicus services**, because the build environment had no internet access to them. The request shapes follow those services' public STAC / Sentinel Hub APIs, but please run one real search and analysis per source after deploying (see *Verify after deploy*).
* Analysis runs synchronously inside the request (`maxDuration = 60`). Large areas on slow providers can exceed serverless limits; a background worker is the next step if that happens. Vercel's request-size limit also caps GeoTIFF uploads.
* Registration is by embedded geolocation only; there is no sub-pixel co-registration. Only WGS84 and WGS84-UTM, north-up GeoTIFFs are read.
* Thresholds are generic starting points, not calibrated for any region. Water indices and radar water rules have well-known false alarms (shadow, wet soil, tarmac, wind-roughened water, flooded vegetation/buildings).
* Landsat is limited to Landsat 8/9 (30 m). Sentinel-2 SWIR (20 m) is resampled to the grid.
* Uploaded files are not retained, so an upload analysis cannot be re-run without re-uploading.

## Verify after deploy

1. Sign in as a responder → **Satellite**: the source list should show *Ready* for Planetary Computer (and *Credentials missing* for Copernicus until you set `CDSE_*`).
2. Pick a small area (a few km²) and two ~2-week windows, press **Find available imagery**, choose a low-cloud pair, **Run change detection**.
3. Check the quality checks, open the compare modes, set a review state, link to a report, then open `/map` → **Satellite**.

## Tests

```
npm test                     # whole suite (existing + satellite)
npm run test:satellite       # satellite only (71 tests)
npm run test:satellite-rls   # runs migration 014 on in-memory Postgres (PGlite): RLS, append-only triggers, constraints (31 checks)
```

Covered: date validation (real calendar days, ranges, order, future, mission start), area validation, parameter validation; unavailable imagery and missing credentials; invalid provider responses (non-JSON, wrong shape, bad items, timeouts, 401/404/429/5xx); failed processing (provider failure, crash, missing bands, nearly all cloud, save failure); metadata persistence and immutability; authorization on every route; review rules; links; uploads; demonstration mode; and prevention of automatic emergency confirmation. Pixel fixtures in tests are synthetic and exist only to check the maths and plumbing.
