# Stages 4–6: Reporting, Live Map, Explainable Triage

## Quick start

```bash
npm install
npm run dev:demo      # simulated Karachi flood data in memory, no Supabase needed
npm run dev           # real Supabase (needs the migration below)
npm test              # 18 tests: triage engine + API routes
```

Pages: `/report` (request help) · `/report/[id]` (reporter's status) · `/dashboard` (triage queue) · `/map` (live map).

## Supabase setup (once)

Run these in **Supabase → SQL Editor**, in order:

1. **`supabase/vyra_complete_schema.sql`**: the complete schema for Stages 1–6, based on the original `schema.sql`. It works on a new project and on the existing database (safe to re-run). It also fixes the live-database issues found during testing:
   - the `infinite recursion detected in policy for relation "profiles"` error,
   - `reporter_id` being required, which blocked anonymous reports,
   - the old 0–100 cap on `priority_score` (Stage 6 scores can be higher, e.g. 137).
<<<<<<< HEAD
2. **`supabase/seed/vyra_full_seed.sql`** (optional): the full simulated demo data plus six sign-in accounts, including an administrator. Re-running it only replaces the demo rows and accounts. See `SETUP_GUIDE.md`.
=======
2. **`supabase/migrations/003_demo_seed.sql`** (optional): simulated demo data. Re-running it only replaces the demo rows.
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895

`migrations/002`, `004` and `005` are earlier step-by-step versions of the same changes. You don't need them if you run the complete schema.

Data mode: `VYRA_DATA_MODE=demo|supabase`. It defaults to `supabase` when `NEXT_PUBLIC_SUPABASE_URL` is set.

## Stage 4: Emergency Reporting

- A form built for phones: GPS button **or** tap/drag a pin on the map, plus an optional landmark and area.
- Captures dangers (multi-select), number of people (blank = unknown), injury severity, count and details, medical needs (checklist plus details), whether people can evacuate, vulnerable people, and contact details.
- Only the location is required. Unanswered questions are stored as **unknown**, never as "no".
- `client_id` is generated on the device, so a retry never creates a duplicate report (this is also groundwork for the Stage 8 offline queue).
- Validation runs on the server (zod) and returns field-level errors. The area is auto-assigned from the coordinates.
- The reporter only gets back a reference number and status (`/api/reports/:id/public-status`).

## Stage 5: Live Disaster Map

- Report markers use **colour, size and letter** for urgency. Critical markers pulse, a dashed border means unverified, and `*` marks a responder override.
- Layers: verified shelters (with occupancy), active rescue teams, and blocked roads drawn as dashed lines. Unverified layer data is never shown.
- Filters: area (the map flies to it), status, urgency, and verified-only. Each popup links to the full case.
- Refreshes every 15 s. Stage 9 can switch this to Supabase Realtime in `usePolledReports` (`src/lib/client.ts`).

## Stage 6: Explainable Triage Engine

Code: `src/lib/triage.ts`. Rules and weights: `src/lib/triageRules.ts`, also published at `GET /api/triage/rules`.

| Factor | How it scores |
|---|---|
| Immediate threat to life | The most severe danger counts in full (drowning 45, trapped/collapse/fire 40, …) and each extra danger adds +5 |
| Serious injury / urgent medical need | Critical 35, serious 25, +3 per extra injured person. Life-sustaining needs (dialysis, oxygen, insulin, labour…) 15 |
| Cannot evacuate | +20, plus vulnerable people (bedridden/disability 8, elderly/children/pregnant 5) |
| People affected | 1 → 2, 2–4 → 5, 5–9 → 10, 10–24 → 15, 25+ → 20 |
| Waiting time | +1 per 10 min while open, max 15. A flag is raised after 1 h with no pickup |
| Missing information | +5 per unknown key field, and a **Medium floor** when two or more are unknown |
| Description keywords | e.g. "unconscious", "heavy bleeding", "roof". Always labelled as coming from free text |

**Safety rules** can raise the result but never lower it. Any threat to life makes a case at least High. A threat to life combined with a critical injury, people who cannot evacuate, or a life-sustaining medical need makes it Critical.

Every case shows its score, the suggested priority, each factor with points and a reason, any safety rule that was applied, and "check before acting" flags. **Responders make the final decision.** An override requires a reason, and both the override and the original suggestion are kept in `report_events`.

## API

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/reports` | Submit a report (public, idempotent on `client_id`) |
| GET | `/api/reports` | Reports with live triage. Filters: `area`, `status` (`open` or a list), `priority`, `verified`, `bbox`, `sort` |
| GET | `/api/reports/:id` | Full case, explanation and history |
| GET | `/api/reports/:id/public-status` | What the reporter may see |
| PATCH | `/api/reports/:id/status` | `{ status, note?, by }` |
| PATCH | `/api/reports/:id/verify` | `{ verified, by }` |
| PATCH | `/api/reports/:id/triage-override` | `{ priority \| null, reason, by }` |
| GET | `/api/triage` | Open cases ranked, with a summary |
| GET | `/api/triage/rules` | The full rule set |
| GET | `/api/map/layers` | Verified shelters, active teams and blocked roads |

## Left for Stage 9 (security)

The RLS policies are still as open as in `schema.sql` (anyone can read reports, including contact details), and the dashboard has no login gate. Registration also lets users pick their own role. Stage 9 should restrict the responder routes and contact info with `current_user_role()`, which migration 002 already creates.
