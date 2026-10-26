# Project audit (done before the flood simulator was added)

Scope: Next.js 14 App Router, TypeScript, Supabase (Postgres, RLS, Auth) with an in-memory demo mode, react-leaflet map.

## What the simulator extends
* **Map** (`src/app/map/page.tsx`, `components/map/DisasterMap.tsx`): gains a staff-only button, panel and layer through the same
  children and `onPick` hooks the route analysis uses. Two small optional props were added (`shelterNotes`, `floodEvidence`).
* **Data layer** (`lib/db`, memory and Supabase stores): read through `getStore().mapLayers()` and `listReports()`; nothing written.
* **Auth**: `requireResponder` (routing/auth.ts) reused for every flood endpoint. Demo mode uses the `x-demo-user` header, real mode a Bearer token.
* **Routing**: route candidates' geometry is sent to `/api/flood/scenarios/:id/routes`. Route scoring, ranking and decisions unchanged.
* **Shelters, resources, incidents, zones**: read-only inputs. Zones can be used as the simulation area.

## Findings

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | `profiles` RLS: UPDATE `USING (true)` and INSERT `WITH CHECK (true)`; anyone with the public key could set `role='admin'` for any account. Sign-up page sent the chosen role straight into that insert. Profiles (email, role) were readable by anonymous callers. | **Critical** (role escalation) | **Fixed**: migration 011 (policies, guard trigger, DB-side `handle_new_user`, `requested_role` request flag), server code reads roles through the caller's own client, sign-up no longer writes profiles, admin PATCH with last-admin guard. Proven against real Postgres (PGlite): `npm run test:rls:hardening`, 49 checks. |
| 2 | Staff-only write endpoints have **no authentication**: `POST/PATCH/DELETE /api/teams`, `/api/resources`, `POST /api/shelters`, `POST/PATCH /api/dispatches`, `PATCH /api/reports/:id`, `/verify`, `/triage-override`. Anyone who can reach the server can dispatch teams or change an incident's priority. | **High, not fixed** | Left unchanged on purpose: the existing pages call these without credentials, so a fix needs coordinated UI changes and was outside this task. **Do not deploy publicly until these require `requireResponder`/`requireAdmin`.** The flood simulator does not call any of them. |
| 3 | `next@14.2.5` has published security advisories. | Medium | Not changed. Upgrade to the latest patched 14.2.x before deployment. |
| 4 | README "Security" notes describe the permissive RLS policies as current. | Low | Partly stale after 011; see the updated README note. |
| 5 | `.env.example` contained a stray merge marker. | Low | Removed. |

## Added by this work
Migrations 011 and 012, `src/lib/flood/*`, `src/app/api/flood/*`, `src/components/flood/*`, report export, tests
(`tests/flood.engine.test.ts`, `tests/flood.api.test.ts`, `scripts/test-rls-hardening.mjs`), `FLOOD_SIMULATOR.md`.
