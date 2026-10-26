# Flood-Depth and Impact Simulator

A responder tool on the live map (**Flood simulator** button, visible to responders and administrators only). It answers
"what would be affected if water reached this level here?" **Every output is an estimate.** It is not a forecast, a warning or
an official hazard map, and it never touches real incidents.

## What it is, and what it is not

| Tier shown in the UI | How the numbers are made | Depth bands | Can be called "validated"? |
|---|---|---|---|
| **Hypothetical water-level overlay** | One depth typed in by a person, applied evenly. No terrain, rainfall or hydrology. | Not supported | No |
| **Terrain-based inundation estimate (screening)** | Elevation model compared with a water level ("bathtub", optionally only ground connected to a source point) or with a ponded rainfall volume (lowest ground fills first). No flow routing, drainage network, structures or time. | Indicative | No |
| **Imported hydraulic output (validation evidence missing)** | Depths from an external model, imported by an administrator. VYRA did not run or check it. | Model output | No |
| **Validated hydraulic simulation (imported)** | As above, with a **complete** validation record (method, metric name and value, observed event, who validated, when). | Validated | Yes, by the importer's claim only |

The tier is decided by code from the evidence supplied, never from a flag the user sets. A claim of "validated" without the full
record stays in the unvalidated tier (tested). VYRA does not run hydraulic models; it only imports their output.

## Safety rules built in

* Every result, map layer, export and comparison carries `ESTIMATE - simulation, not a real event`.
* Simulations are stored only in `flood_scenarios` (with `is_simulation` forced TRUE by a CHECK). No foreign key, trigger or write path
  links them to incidents, dispatches, teams, shelters or priorities. Incident reports are **read** for context only. A test wraps the
  data store so any write attempt fails, and checks that incidents, teams, shelters, road blocks and zones are unchanged after a run.
* Route and shelter integration is supplementary evidence only. It does not rank, reorder, recommend or dispatch, and route scoring
  and dispatcher decisions are untouched.
* Missing, failed, stale, truncated or synthetic datasets are labelled, and the matching count is `unknown`, **never 0**.
* Nothing is fabricated: no elevation file means terrain scenarios are unavailable (503), not guessed. Observations are only ever
  typed in or imported by staff; the app never generates them. Comparing an estimate with observations only happens when the user
  picks a time window, and it is reported as a comparison, **not** as validation.

## Setup

1. **Apply migrations in order**: `011_profiles_role_hardening.sql` then `012_flood_simulator.sql` (both are in `scripts/setup-db.js`).
   011 must be applied first, before deploying this code: the code reads `profiles.requested_role`.
2. Optional configuration, all in `.env.example` (`FLOOD_*`). With no configuration only the hypothetical overlay is offered.
3. Sign in as a responder or administrator, open **Map**, press **Flood simulator**.
4. To try terrain scenarios without real data: `npx tsx scripts/make-sample-dem.mts ./data/flood`, then
   `FLOOD_DEM_PATH=./data/flood/SYNTHETIC-sample-dem.tif`. That terrain is **invented** and every scenario that uses it says so.

### Data you should provide for real use

| Need | Setting | Notes |
|---|---|---|
| Elevation (best: a bare-earth DTM) | `FLOOD_DEM_PATH` (GeoTIFF, EPSG:4326, metres) plus optional `FLOOD_DEM_NAME/KIND/VINTAGE/VERTICAL_ERROR_M/DATUM` or a `<file>.meta.json` | A 90 m global model can miss narrow drains and buildings; the data-quality panel states resolution, vertical error if known, and the datum. |
| Free fallback elevation and rainfall | `FLOOD_OPEN_METEO_ENABLED=true` | Open-Meteo, Copernicus 90 m. Non-commercial use only. At most 2500 points per scenario. |
| Roads, buildings, hospitals | `FLOOD_ROADS_PATH`, `FLOOD_BUILDINGS_PATH`, `FLOOD_HOSPITALS_PATH` (GeoJSON) or `FLOOD_OVERPASS_ENABLED=true` | Live OpenStreetMap is opt-in; please follow the Overpass usage policy. Datasets older than `FLOOD_ASSET_STALE_DAYS` are flagged stale. |
| Drainage | `FLOOD_DRAINAGE_PATH` (GeoJSON lines) | Shown as context. It does **not** change the estimate. Drainage capacity in rainfall scenarios is a number the user types in. |
| Shelters, rescue teams, supplies, reported blocked roads, open incidents | Existing VYRA registers | Read-only. |
| Historical flood observations | `POST /api/flood/observations` (staff) | Unverified until an administrator verifies. |

Limits: Karachi region only unless `FLOOD_ALLOW_ANY_REGION=true`; area at most `FLOOD_MAX_AREA_KM2` (default 300); at most
`FLOOD_MAX_CELLS` (default 160 000) terrain cells.

## Using it

1. **Scenario tab.** Choose the area (Karachi zone and radius, an existing VYRA zone, or click corners on the map). Choose the type
   and inputs. **Preview** runs without saving; **Run and save** stores it (a name is required).
2. **Result.** Banner, model tier and what it means, data-quality headline, summary (area, flooded area, max and mean depth, volume,
   cell size), depth-band legend, approximate affected shelters, hospitals, roads, buildings, rescue teams and open incidents,
   per-dataset quality, assumptions, limitations, timestamps. Layers can be toggled and the extent opacity changed.
3. **Saved tab.** Open or delete saved simulations. **Compare tab.** Pick two; deltas keep `unknown` as unknown and warn about
   different resolutions or dates.
4. **Routes and shelters.** After running a route analysis, **Check current routes** adds an estimate note under each route
   candidate (and draws flooded stretches of the selected route). **Check shelters** adds an estimate note to shelter pop-ups.
   A route or shelter outside the assessed area is reported as unknown, never as clear.
5. **Export.** PDF, HTML (inline SVG map), GeoJSON and JSON from `GET /api/flood/scenarios/:id/report?format=...`. Exports are audited.
   The report map has no basemap by design (the server does not depend on a tile service) and says so.

## API (responders and administrators; admin where noted)

`GET /api/flood/config` · `POST /api/flood/simulate` · `GET|POST /api/flood/scenarios` · `GET|PATCH|DELETE /api/flood/scenarios/:id` ·
`POST /api/flood/scenarios/:id/routes` · `GET /api/flood/scenarios/:id/shelters` · `GET /api/flood/scenarios/:id/report` ·
`GET /api/flood/compare?a=&b=` · `GET|POST /api/flood/observations` · `PATCH|DELETE /api/flood/observations/:id` (verify is admin) ·
`POST /api/flood/import` (**admin**). Simulation and import are rate limited per user.
There is no admin screen for importing model output or recording observations yet; use the API.

## Known limitations

* A bathtub or ponding estimate can badly over- or under-state flooding where drains, culverts, pumps, tides, structures or flow
  dynamics matter, which is most of urban Karachi. Treat bands as indicative.
* No terrain, building, hospital or drainage data is shipped. Quality is only as good as what you configure.
* Live Open-Meteo and Overpass calls could not be exercised from the build environment. They are tested with mocked failures and
  malformed responses only; try them once with real network access before relying on them.
* No existing shelter recommender exists in VYRA, so shelter integration is an evidence view, not a recommendation input.
* The depth grid is stored packed in the scenario row (centimetre resolution). Very large scenarios are limited by `FLOOD_MAX_CELLS`.
