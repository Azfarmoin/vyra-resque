# Intelligent Shelter Placement Assistant

Decision support for placing evacuees. It **extends** the existing `shelters` table, routing stack, hazard register, disaster zones and dispatch missions. There is no second shelter system. A person always confirms before anyone is sent.

Open it at **/shelters** (responders and administrators; linked from the header, and from "Find a shelter" on an incident and "Find shelter for evacuees" on a mission).

---

## 1. What is implemented, and what is not

### Implemented and tested here (pure logic, run with `npm run test:shelters`)
| Area | Where |
|---|---|
| Registry fields (verified location, max capacity, occupancy, available capacity, status, opening hours, last verification, responsible organization, data source, verification status, wheelchair access, 14 facility flags, infrastructure dependencies) | `src/lib/shelters/types.ts`, `facilities.ts`, migration `017` |
| Documented-vs-claimed facilities; stale / unverified / estimated data labels | `facilities.ts` |
| Explainable recommendation engine (tiers, score breakdown, exclusions, human-review request) | `engine.ts` |
| Site exposure: verified/potential hazards, disaster zones, flood scenario, access problems, dependency risk | `risk.ts` |
| Reservations: reserve, confirm arrival, depart, cancel, extend, expiry, idempotency, exceptions, reconciliation, audit | `service.ts` |
| Dashboard, coverage grid, hypothetical-site comparison | `dashboard.ts`, `coverage.ts` |
| Role matrix and request validation | `permissions.ts`, `validate.ts`, `handlers.ts` |
| Role-escalation and unauthenticated-endpoint fixes | see `SECURITY_REVIEW.md` |

### Written but NOT executed in the build environment
* **The SQL.** Migration `017` (shelters) and `018` (profile guard) are executed by `npm run test:shelters-sql` on in-memory Postgres (PGlite): 38 checks pass after the merge. That is not a real Supabase project, so still try them on a staging project before relying on them. The Supabase-backed service (`supabaseService.ts`) calls those functions and is likewise untested end to end.
* **The web UI and API route adapters.** They were syntax-checked, not run. `next` and React could not be installed, so there was no `next build`, no browser test. The logic they call is tested through `handlers.ts`.
* **Nine pre-existing test files** (`api`, `ops`, `admin`, `routing`, `hazards`, `support`, `attachments`, `offline`, `zones.api`) import `next/server` and could not load here, before or after my changes. They are unverified against the auth edits; run `npm test` after `npm install`.
* **Real OSRM / OpenRouteService calls.** The adapter (`routeAdapter.ts`) wraps the existing `analyzeRoutes`; tests use a fake road engine.

### Not available in VYRA (so not built, and described honestly)
* **Flood simulation.** VYRA has no flood simulator. A "flood scenario" here means the existing **flood disaster zones** you choose (or all active ones). Output says "projection, not an observation". If you add a simulator later, pass its polygons as `floodScenario.polygons`.
* **Infrastructure dependency analysis.** There is no infrastructure network model. Shelters can declare dependencies (`grid_power`, `municipal_water`, `single_access_road`); a shelter is flagged when a recorded hazard of a matching kind is nearby and no backup is documented. That is all it claims.
* **Population data.** The coverage map uses people counted on **open incident reports** as demand. Quiet populated areas can look adequate.
* **Road-routed coverage.** The coverage grid uses straight-line travel estimates. Real routes are used for the recommendation of specific shelters.
* **Notifications to shelters or evacuees**, and **a "planner" role** (planners are responders or administrators; a new role would widen the privilege surface).

---

## 2. Setup

```bash
npm install
npm run test:shelters          # 96 tests, no database needed
npm test                       # whole suite (needs next installed)
```

**Demo mode** (`npm run dev:demo`): nothing to configure. The 11 demo shelters get simulated registry details (fresh and stale data, one unverified, one closed, one full) so every flag can be seen. State is in memory.

**Supabase**:
1. Run the migrations in order (the setup script does this): `011_profiles_role_hardening.sql`, then `017_shelter_assistant.sql` and `018_profiles_self_demotion_guard.sql`. Run them as the `postgres` role (SQL editor or `npm run db:setup`).
   ```bash
   npm run db:setup          # schema + migrations 001, 006-018
   npm run db:setup -- --seed  # optionally add the demo seed
   ```
2. All of these migrations are idempotent. Existing shelters keep working: `verification_status` is derived from the old `verified` flag, and **legacy `services` entries are treated as unverified claims, never as documented capability** until an administrator documents them.
3. Review who is a responder or admin: `select email, role from profiles where role <> 'citizen';`.
4. Set `VYRA_ALLOW_DEMO_IN_PRODUCTION` only for a showcase with fake data (see `SECURITY_REVIEW.md`).
5. Routing: set `ROUTING_PROVIDER` / `OSRM_BASE_URL` / `ORS_API_KEY` as for the existing route analysis. Without a provider, the assistant still works with **labelled straight-line estimates** and marks every option for review.

---

## 3. How a recommendation is made

For each shelter, the engine records **reasons** with a severity: `block` (excluded), `flag` (needs review) or `info`.

* **Excluded:** closed; full; not enough free places; capacity unknown; no coordinates; rejected record; a required capability that is not documented; inside a verified danger / restricted / evacuation-order zone; a verified high-severity site hazard at the location; inside a scenario marked "exclude"; every road route crosses a known closure; no road route found.
* **Review required:** unverified or stale verification; stale / estimated / unknown occupancy; unverified location; outside opening hours; potential (unverified or lower-severity) hazard or zone exposure; access problem near the entrance; dependency at risk; route hazards reported or limited data; routing failed (estimate used); route not checked; an authorized exception in use.
* **Recommended:** no blocks and no flags.

Ranking is tier first, then a 100-point score (travel 30, spare capacity 15, data confidence 15, route hazards 15, distance from hazards 15, documented facilities 10). The score is an **ordering aid, not a safety rating**; the breakdown is shown. The closest shelter is reported separately with its outcome, so "closest" is never silently treated as "best".

**Capacity.** `free = capacity + authorized overflow - occupied - held`. If occupancy is stale, estimated or unknown, only 75% of free places are relied on and the option is flagged. A shelter marked `full` is respected even if the numbers say otherwise.

**Needs (counts only, no names or diagnoses):** wheelchair users (full access on a verified record), mobility help, oxygen (oxygen support **and** a documented power source), essential medication (medical support), infants (family space + water + sanitation), older adults (step-free access), pregnancy (maternal or medical support), keep family together (family accommodation). A capability counts only if recorded as yes **and** someone recorded when ("documented"). If nothing qualifies, the response lists the **unmet requirements** and asks for **human review**.

**Exceptions** are the only way a closed or full shelter is offered: administrator-only, with a reason, an authorizer, an expiry of at most 72 hours, and revocation. They are shown to the dispatcher as warnings.

---

## 4. Reservations

`POST /api/shelters/reservations` holds places; it is **not** an arrival. People are counted inside only after `confirm_arrival`, an explicit action recorded with who and when (the database also has a check constraint forbidding an `arrived` row without a confirmation).

| State | Meaning |
|---|---|
| reserved | places held until `hold_expires_at` (default 90 min from the expected arrival) |
| arrived | arrival confirmed (partial arrivals release the remainder) |
| departed | people left; occupancy reduced |
| cancelled | released (reason required; closing a shelter cancels its holds and reports them back) |
| expired | hold lapsed without confirmation; places released automatically |

**Concurrency.** In Postgres every function locks the shelter row (`SELECT ... FOR UPDATE`) before reading capacity and takes an advisory lock on the group first, backed by two unique partial indexes (one active booking per group, one reservation per idempotency key). In demo mode a per-shelter and per-group mutex does the same job. Retrying with the same `idempotencyKey` returns the original reservation.

**Reconciliation** (`POST /api/shelters/reconcile`, admins) recomputes held places from the ledger and repairs drift. It **reports but never rewrites** headcounts, because walk-ins can only be counted by a person.

**Privacy.** Reservations store a short group label and need *counts*. No names, diagnoses or free-text medical notes are accepted (unknown fields are rejected). The audit log omits needs. The public shelter list exposes only name, area, location, status, verified, contact and services.

---

## 5. API summary

| Route | Who | Purpose |
|---|---|---|
| `GET /api/shelters` | anyone (public fields) / staff (full + availability + data quality) | list |
| `POST /api/shelters` | admin | create (always unverified) |
| `GET/PATCH /api/shelters/:id` | staff / `{occupancy}` staff, registry admin | detail, headcount, registry |
| `POST /api/shelters/recommend` | staff | explained ranking |
| `GET/POST /api/shelters/reservations` | staff | list / reserve |
| `PATCH /api/shelters/reservations/:id` | staff | `confirm_arrival`, `depart`, `cancel`, `extend_hold` |
| `GET /api/shelters/dashboard` | staff | occupancy, stale records, access problems, exposure |
| `GET/POST /api/shelters/coverage` | staff | coverage grid / hypothetical comparison |
| `GET/POST/DELETE /api/shelters/exceptions` | staff read, admin write | authorized exceptions |
| `POST /api/shelters/reconcile`, `GET /api/shelters/audit` | admin | reconciliation, audit |

Dispatch integration: a reservation can carry `incidentId` and `dispatchId`; list by `?dispatchId=`. The mission dialog and incident detail link straight into the finder.

---

## 6. Test results (this delivery)

| Suite | Result |
|---|---|
| Recommendation engine (rankings, route failures, hazard exposure, accessibility, full/closed, data quality) | 27 / 27 |
| Reservations (races, cancellations, expiry, reconciliation, exceptions, audit) | 27 / 27 |
| Coverage, dashboard, permission matrix, validation | 11 / 11 |
| Handlers (every handler x anonymous / citizen / responder / admin) | 22 / 22 |
| Security (demo guard, role-write scan, route-gate scan, SQL structure, demo seed) | 9 / 9 |
| **Shelter total** | **96 / 96** |
| Pre-existing tests that can load without `next` | 95 / 95 unchanged |
| Pre-existing tests that need `next` | **not run** (environment) |
| `scripts/test-shelter-sql.mjs` (executes SQL) | **not run** (environment) |

**Mutation checks** (a rule was deliberately broken, the tests had to fail): closed -> flag, unmet need -> flag, legacy services counted as documented, verified hazard no longer blocks, known closure no longer blocks, stale occupancy trusted fully, mutex removed. All were caught. This also showed that in the in-memory service the capacity race is safe by construction (synchronous check-and-write) and the lock matters for the awaiting paths; the real concurrency guarantee is the row lock in SQL, which still needs executing.

## 7. Known limitations
* Straight-line estimates drive coverage and the fallback travel times (x1.4 at 30 km/h).
* Recommendations are not persisted; reservations, exceptions and audit are.
* Hypothetical sites are compared on access only. The tool never says a site is suitable; it lists what was **not** assessed (structural, flood/geotechnical beyond recorded hazards, land, permits, utilities, staffing).
* Unverified shelters are never counted as coverage, so a project with mostly unverified shelters will show poor coverage until records are verified.
* Seeded shelters from `vyra_full_seed.sql` are `verified` with no verification date, so they show as "verification date not recorded" until an administrator re-verifies them.
