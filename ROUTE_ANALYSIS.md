# AI Route and Hazard Analysis

Decision support for responders: candidate road routes from a real routing engine, checked against VYRA's
hazard records, with every limitation spelled out. **It never says a route is "safe".** A dispatcher approves
routes; if someone is in immediate danger, call emergency services without waiting for this.

## Flow
origin + destination → routing provider → candidate road geometries → hazard dataset (3 tables) →
geographic matching → deterministic status + ranking → optional AI explanation → audit record → dispatcher decision.

Code: `src/lib/routing/*` (geo, hazardSources, hazardMatcher, routeScoring, providers, routeAnalysis, auth, audit),
`src/lib/ai/hazardExplanation.ts`, `src/app/api/routes/{analyze,decisions}`, UI in `src/components/routing/*` on `/map`
(button "Routes", or "Analyse routes here" on a case).

## Hazard sources (nothing invented)
| Table | Becomes | Notes |
|---|---|---|
| `route_hazards` | point + radius | No verification column existed: `unverified` unless migration 006 columns say otherwise. `active=false` = resolved. |
| `blocked_roads` | polyline closure | `verified=true` → confirmed. Severity is derived from `reason`. `updated_at` is NOT treated as a verification time. |
| `emergency_reports` | point (100 m+) | Only road-relevant `dangers` (flood, collapse, fire, gas, electrical, landslide). Never "closes the road" by itself. Contact details are never read. |

Records without usable coordinates are skipped **and counted**; a failing table is reported as an unavailable source.

## Statuses (precedence top to bottom)
1. **Known blockage**: an active, confirmed hazard whose record says it closes the road lies on the route.
2. **Hazard reported**: any other active hazard on the route.
3. **Limited information**: nothing matched, but the data cannot support a conclusion: empty dataset, failed source,
   unlocatable records, no records within 10 km, newest nearby record older than 12 h or undated, or an endpoint >200 m from a mapped road.
4. **No hazards found in available data**: nothing matched and the data is local, fresh and complete. Not a safety statement.

"Candidate for dispatcher review" goes only to the best-ranked route whose status is *No hazards found*.
Ranking: no confirmed closure first, then weighted hazard + data-limitation concerns, then time, then distance
(`exposure.score` orders routes; it is not a probability). Resolved/expired records are shown, not counted, and not treated as proof of clear road.
Duplicates (compatible kind, ≤75 m, ≤6 h apart) fold into one counted hazard. Tunables are constants at the top of `hazardMatcher.ts` and `routeScoring.ts`.

## Providers
`ROUTING_PROVIDER=osrm` (default) or `ors`. OSRM cannot avoid a given road, so closures are only *flagged*; VYRA says no recalculation happened.
ORS receives avoid-polygons around confirmed closures and recalculated routes are labelled. Provider outage/timeout → HTTP 503 `routing_unavailable`, no routes shown.

## Environment variables
See `.env.example`: `ROUTING_PROVIDER`, `OSRM_BASE_URL` (required in production), `ORS_BASE_URL`, `ORS_API_KEY`, `ANTHROPIC_API_KEY`, `VYRA_AI_MODEL` (all server-only).

## Database
Run `supabase/migrations/006_route_analysis.sql` (idempotent). Adds optional verification/timestamp columns and the
`route_analyses` / `route_decisions` audit tables with role-based RLS. Without it analysis works, but approval is disabled (the audit save fails, so no `analysisId`).

## API
- `POST /api/routes/analyze` (responder/admin): `{origin:{lat,lng}, destination:{lat,lng}, vehicle, includeAi}`. Body ≤2 KB, 12 requests/min/user (per instance), 10 s provider timeout. 401/403/413/422 (boat, helicopter)/429/503 handled.
- `POST /api/routes/decisions`: approve/reject. Non-clean routes need a reason; known blockages need an explicit acknowledgement; analyses older than 15 min must be refreshed.
- Auth: Supabase bearer token (real) or `x-demo-user` email header (demo mode only).

## AI
Optional and advisory: per-route summaries, concerns, "verify before approving" checks, duplicate suggestions and facts read from report text. Forced single tool call with a strict schema, report text sanitised and passed as JSON data, unknown ids dropped, "safe/guaranteed" claims discarded, no confidence numbers. It cannot change a status, ranking or closure, and cannot dispatch.

## Known limitations
- Not verified against live OSRM/ORS/Anthropic services (the build environment had no access); adapters are tested against faked responses only. Run one real analysis after configuring.
- ORS avoid-polygons are built as one rectangle per closure segment; overlapping rectangles are untested against live ORS.
- No road width/height/weight/flood-depth data exists, so vehicle passability is always reported as unknown.
- Hazard bounding-box prefilter loads all `route_hazards`/`blocked_roads` rows (fine for hundreds, not millions).
- Rate limit is per server instance. Existing `/api/hazards*` endpoints remain unauthenticated (pre-existing); consider gating them.
- Demo route-hazard records are older than 12 h by design of the seed, so demo routes through them show limited information.

## Update: hazard endpoints, verification UI, live tests
- `/api/hazards` and `/api/hazards/[id]` now require a responder or admin and validate input (this closes the earlier "unauthenticated" limitation).
- Supplies → Route hazards shows each hazard's verification and offers **Confirm / Re-verify now** (server-side timestamp; clients cannot back-date) and **Mark cleared**. Needs migration 006; without it the database error is shown.
- Opt-in live tests: `LIVE_OSRM_URL=... LIVE_ORS_KEY=... ANTHROPIC_API_KEY=... npm run test:live` (skipped when unset).
