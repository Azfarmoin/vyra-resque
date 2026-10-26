# VYRA merge notes

This project combines five feature sets that were each built on the same base (four ZIPs and one patch):

| Feature | Source ZIP | Docs | Migration |
|---|---|---|---|
| AI route and hazard analysis | VYRA-route-analysis | ROUTE_ANALYSIS.md | 006_route_analysis.sql |
| Support pages (FAQ, Contact, Precautions, /admin/support) | vyra-with-support | SUPPORT_FEATURES.md | 007_support_requests.sql |
| Early warning alerts and Web Push | VYRA-early-warning (both uploads were identical) | docs/EARLY_WARNING.md | 008_early_warning.sql |
| Offline-first reporting, PWA, photo attachments | VYRA-offline-first | OFFLINE.md | 009_offline_first.sql |
| Interactive disaster zones (map layer, `/admin/zones` editor, feeds, report-based suggestions) | vyra-zones.patch | ZONES.md | 010_disaster_zones.sql |
| AI photo analysis (written new on top of the offline photo system) | n/a | PHOTO_ANALYSIS.md | 011_photo_analysis.sql |

## What changed while merging
- The migrations that were all numbered `006` were renumbered 006 to 010 (see table). References in docs, tests and `scripts/` were updated. `npm run db:setup` now runs all four.
- `package.json`: one `test` script covering every suite (zones tests included), plus `test:live`, `test:rls` and `vapid:generate`. New dependencies: `web-push`, `idb`. New dev dependencies: `@types/web-push`, `fake-indexeddb`, `@electric-sql/pglite`.
- `public/sw.js`: the offline-first service worker, plus the push and notificationclick handlers from early warning, and `/alerts` added to the cached shell pages.
- `.env.example`: variables from all features, kept side by side.
- `SiteHeader`: Help menu (support) and both admin links (Support, Alert admin).
- `DisasterMap` and the map page: route-analysis overlay and alert layer together.
- Reports can now have no coordinates (offline-first). The route-analysis origin picker skips those cases.
- `supabaseStore.ts` (alerts): one type cast fixed so the project typechecks.
- Untouched: the stray nested folder `VYRA-Intelligent-Disaster-Response-main/` inside the uploaded ZIPs held only a duplicate `003_demo_seed.sql`, `.gitignore` and `package-lock.json`, so it was left out. `package-lock.json` was regenerated.
- Zones patch: the 10 existing files it edits were 3-way merged with the other features. Reports without coordinates (offline-first) are left out of map markers, clustering and zone evidence counts. The map keeps the alert layer and route-analysis overlay beside the zone layer, and `/map` is added to the service worker's cached pages.
- The eleven extra ZIPs in the second upload were exact copies of the route, support, early-warning and offline-first ZIPs, so they added nothing new.


## Second merge: flood simulator + AI photo analysis + satellite change detection

Three trees built on the same base were combined (every file only one tree changed was taken as is; seven files all three edited were merged by hand).

| Feature | Docs | Migration |
|---|---|---|
| Profiles role hardening + Flood simulator (flood-simulator ZIP) | FLOOD_SIMULATOR.md, docs/PROJECT_AUDIT.md | 011_profiles_role_hardening.sql, 012_flood_simulator.sql |
| AI photo analysis | PHOTO_ANALYSIS.md | 013_photo_analysis.sql (was 011) |
| Satellite change detection | SATELLITE.md | 014_satellite_analysis.sql (was 011) |

- Photo analysis and satellite both shipped as `011_*`, which clashed with the flood ZIP's hardening migration. They are now 013 and 014 and `npm run db:setup` runs 001, 006 to 014 in order. Code messages, docs and RLS test scripts were updated.
- `package.json`: union of all test lists and scripts. `geotiff` is `^3.0.5` (satellite) and `proj4` and `pdfkit` are all present. `package-lock.json` regenerated.
- `.env.example`: all three blocks; a stray `=======` line left over from an earlier merge was removed.
- `/map`: Routes, Satellite and Flood simulator buttons side by side; the flood layer and satellite overlay both render inside the map; one `isStaff` flag.
- `CaseDetail`: photo analysis panel and satellite findings both shown.

## Third merge: zones-and-safety patch + testing switches

- The patch held the disaster-zones work that was already merged (identical, left untouched) plus the new **Hazards & Precautions** center (`SAFETY.md`). Only the safety parts were applied: `src/lib/safety/`, `/safety`, `/admin/safety`, `/api/safety/content`, safety links in the report form, case detail, zone sheet, report status page and header, and the offline guide pages in `public/sw.js` (cache `v3`).
- Its migration `007_safety_content.sql` is now `015_safety_content.sql` (`db:setup` runs it last). New check: `npm run test:rls:safety`.
- `DANGER_TO_GUIDE` gained `earthquake`, `blocked_road` and `medical_emergency` (added to the report form by another feature after the safety patch was written).
- Fixed an existing hydration error on `/alerts` (push support was read during render).
- **Testing switches** (`src/lib/devFlags.ts`): `VYRA_DISABLE_RATE_LIMITS=true` turns off every limiter; `NEXT_PUBLIC_VYRA_OPEN_ACCESS=true` skips sign-in and treats every visitor as the demo administrator (demo data mode only; ignored with real Supabase). `npm run dev:open` starts with both. Off by default; never enable on a deployment others can reach.

## Very large seed
Added `src/lib/db/largeSeed.ts` (generator), `scripts/generate-seed-large.mts` (SQL exporter), `supabase/seed/vyra_large_seed.sql`, `scripts/test-large-seed.mjs` (PGlite check, runs the seed twice), `VYRA_DEMO_DATASET=large` demo mode, and `setup-db.js` now seeds the large file by default (`--small` for the old one). See DEMO_DATA.md.


## Fourth merge: multi-channel delivery + shelter placement assistant

Three trees were combined: this project (flood simulator, photo analysis, satellite, safety, testing switches, very large seed), `VYRA-multichannel-delivery` (this project before the very large seed, plus delivery) and `VYRA-shelter-assistant` (an older base, before flood/photo/satellite/safety). Duplicate uploads of the multichannel and shelter ZIPs were byte-identical and counted once.

| Feature | Docs | Migration |
|---|---|---|
| Multi-channel delivery (radio, SMS, Bluetooth, manual transfer, gateways) | docs/MULTICHANNEL_DELIVERY.md | 016_multichannel_delivery.sql |
| Shelter placement assistant | SHELTER_ASSISTANT.md | 017_shelter_assistant.sql (was 012) |
| Profile guard extras from the shelter security review | SECURITY_REVIEW.md | 018_profiles_self_demotion_guard.sql (new) |

- **Multichannel**: its changes touched files the very large seed never edited, so they were applied as is. `package.json` gains `qrcode` and `@types/qrcode`; `setup-db.js` runs 016; the delivery and gateway tests are in `npm test`.
- **Shelter assistant**: new files copied as is (`src/lib/shelters`, `/shelters`, `/api/shelters/*`, tests, docs). Its own edits were applied by hand to existing files: Shelters link in the header, "Find a shelter" on case detail and missions, optional shelter fields on the `Shelter` type, simulated registry details in the demo seed, credentials sent on the now-protected calls, `/api/shelters` rewritten (admin-only create, `{ shelters, view }` response).
- **Security overlap**: this project already had `011_profiles_role_hardening.sql`, the register page without a profile insert, and the admin role-approval API, which cover the same ground as the shelter ZIP's `011_security_role_escalation.sql`. The existing ones were kept and the duplicate migration was not added. Kept from the shelter work: `staffGate` on the nine mutating operations routes, `demoGuard` (demo sign-in refused in production) wired into every auth lookup including the flood, satellite and gateway ones, and the seed profile upsert.
- **Fixed during the merge**: in `017`, the unmet-requirements function crashed with "malformed array literal" (it appended a bare string to a text array); row level security is now enabled explicitly on `shelters`. `scripts/test-shelter-sql.mjs` had harness errors and wrong expected numbers (never run by its author) and was corrected.
- **Tests changed because behaviour changed on purpose**: `tests/ops.test.ts` (shelter create is admin only and returns `{ shelter }`; public list is verified only) and `tests/shelters.security.test.ts` (points at the merged migrations, allows the flood/satellite `guard()` and gateway key checks).
- `test-large-seed.mjs` now also loads migrations 016 to 018.
