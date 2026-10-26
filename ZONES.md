# VYRA interactive disaster zones

Adds colored hazard / evacuation / shelter / restricted zones to the existing live map (`/map`) and a protected editor (`/admin/zones`). Existing reports, shelters, teams, blocked roads, triage, the offline report queue and demo mode are unchanged.

## Setup
1. **Database (Supabase mode):** run `supabase/migrations/010_disaster_zones.sql` in the SQL editor after `002_stage4_6.sql`. Demo mode (`VYRA_DATA_MODE=demo`) needs nothing; it ships 12 clearly labelled *simulated* zones.
2. **Environment (all optional):** see `.env.example`.
   - `SUPABASE_SERVICE_ROLE_KEY` (server only) is needed only for official-feed imports.
   - `ZONE_FEEDS` (JSON array of https GeoJSON feeds) and `ZONE_IMPORT_SECRET` (16+ chars). Schedule `POST /api/zones/import` with header `x-zone-import-secret`.
3. `npm install && npm test && npm run dev` (use `npm run dev:demo` for demo data). Sign in as `admin@demo.vyra` / `dispatcher@demo.vyra` (password `VYRA-demo-1`) to try the editor.

## Behaviour
| Zone | Rule enforced (UI, API and database) |
|---|---|
| Red danger | Must be official or verified by a person |
| Orange / Yellow | Reported or developing hazards |
| Blue evacuation | Must say **official order** or **proposed plan**; only official information can be an order |
| Green shelter | Verified shelters only; sheet states it does not mean the area is hazard-free |
| Gray restricted | Must explain the exact status |
| Circles | Only with a radius and a written basis; otherwise draw a polygon or use a marker |
| AI | Stored only as drafts, never public, cannot become active without a person changing source and status with a reason |

Not color alone: each type has its own fill pattern, outline style, glyph and text label; outline weight rises with severity; unverified labels are dashed; expired / cancelled zones are gray, struck through and stay visible 24 h.

Permissions: citizens read only. Responders create/edit unverified or person-verified zones and may *propose* evacuations. Only administrators publish official warnings and evacuation orders, or delete drafts. Published zones are cancelled, never deleted, so history stays. Important changes need a reason; every change is audited (server in demo mode, `zone_audit` trigger in Supabase, append-only).

Offline: the latest zones are cached in IndexedDB (`vyra-zones`) with the regions and time they were fetched. Offline the map shows them under a red "saved data, may be old" banner; expiry is recomputed on the device. `/map` is precached, and the map page keeps a "Report an emergency" button that uses the existing offline queue. Zone edits are **not** queued offline (no safe sync workflow), so the editor tells you to reconnect.

Feeds: items are keyed by `(feed_id, external_id)` (no duplicates), revisions update the same zone and keep history, items missing from a *successful* response are deactivated, a *failed* fetch changes nothing except the feed status, which drives the stale-data banner.

## Changed files
Modified: `.env.example`, `package.json` (test script), `public/sw.js` (precache `/map`), `src/app/globals.css`, `src/app/map/page.tsx`, `src/components/common/SiteHeader.tsx`, `src/components/map/DisasterMap.tsx` (zone layer, report clustering, bounds focus, shelter note), `src/lib/db/{store,memoryStore,supabaseStore}.ts`.

New: `supabase/migrations/010_disaster_zones.sql`; `src/lib/zones/{types,geometry,rules,cluster,feeds,snapshot,auth,service,client}.ts`; `src/lib/db/demoZones.ts`; `src/app/api/zones/{route.ts,[id]/route.ts,[id]/audit/route.ts,import/route.ts}`; `src/app/admin/zones/page.tsx`; `src/components/map/{ZoneLayer,ZoneUi,ZoneEditorMap}.tsx`; `tests/zones.logic.test.ts`, `tests/zones.api.test.ts`.

## Verification status
Run here (no network, so no `npm install`): 47 zone tests pass, repeated 3x (geometry, rules, permissions, audit, lifecycle, feeds, snapshot, API routes, 5,000-zone and 400-zone scale). Route tests ran against small local stand-ins for `next/server`, `zod` and `@supabase/supabase-js`.
**Not run:** `npm install`, `next build`, the pre-existing tests, the React/Leaflet components in a browser (syntax-checked only), and the SQL migration against Postgres. Please run `npm test`, `npm run build`, and a manual pass on `/map` and `/admin/zones` before shipping, including on a low-end Android device.

## Known limits
- Pattern fills use Leaflet's SVG renderer; very large zone counts in one view may need testing on target devices.
- The editor draws single polygons, lines, circles and points; MultiPolygon / holes keep their stored boundary (details editable).
- Importer is a generic GeoJSON adapter; each real provider needs a `fields` mapping (and CAP/other formats need a converter).
- Without PostGIS, viewport queries use bbox columns. A PostGIS column is added only if the extension already exists.
- Database checks cover structure and ranges; full ring validation (closed, no self-crossing) is done by the API.
- Evacuation-route logic is untouched; the UI warns that avoiding zones does not make a route safe.
- Map tiles are not cached, so offline the map shows zones without a base map.

## Report evidence and suggested changes (added)
Zones do **not** grow or shrink by themselves; reports only inform a person.
- **Evidence:** the zone details panel shows open reports linked to or inside the zone (verified / not verified / last 24 h), based on the reports loaded on the map.
- **Suggestions:** in `/admin/zones`, "Analyze" (changes nothing) or "Save as drafts" calls `POST /api/zones/suggest` (staff only). Rules, in `src/lib/zones/evidence.ts`: 3+ weighted reports (verified = 2) within 500 m of each other in 24 h outside every zone becomes a new caution area; 3+ within 500 m outside an unofficial zone proposes an extension; reports outside an official zone only produce a "check with the authority" note; an unofficial zone with no reports for 48 h gets a review note that says it is not evidence of safety. Proposed boundaries are the convex hull of the report points (approximate); collinear or too few points propose none.
- Drafts are private AI suggestions (always `caution`, severity unknown). A responder edits them, unticks "Keep as a draft", picks a verification level and records a reason. Re-running does not duplicate drafts.
- Thresholds are the `DEFAULTS` object in `evidence.ts`. Tests: `tests/zones.evidence.test.ts` and the suggestion test in `tests/zones.api.test.ts` (54 zone tests pass here; same not-run caveats as above).
