# VYRA offline-first reporting

> Delivery no longer waits for Wi-Fi: reports also go out by radio, SMS, Bluetooth and manual transfer. See `docs/MULTICHANNEL_DELIVERY.md`. The sections below describe the local queue and internet sync, which that feature builds on.

People can write, save and queue emergency reports with no connection. Reports live in IndexedDB on the device and
are sent automatically when a connection returns. Nothing is called "received" until the server confirms it.

## 1. Architecture

| Layer | What it does |
|---|---|
| `public/sw.js` + `src/app/manifest.ts` | PWA: caches the app shell (`/`, `/report`, `/report/saved`, `/offline.html`, icons, `/_next/static`). Never caches `/api/*`, dashboards, status pages, tokens or cross-origin requests. |
| `src/lib/offline/*` | IndexedDB (via `idb`): reports, photo blobs, sync metadata. Sync engine with idempotency, backoff + jitter, per-owner auth. |
| `POST /api/reports` | Idempotent on `client_id`. Owner comes from the verified bearer token, never from the body. |
| `POST /api/reports/:id/attachments` | Raw image bytes, idempotent on `X-Attachment-Id`, checked by file signature, max 5 MB, max 8 per report, stored in a **private** bucket. |
| `GET .../attachments[/:aid]` | Responders/admins only, streamed through the server, `no-store`. |

Existing features are unchanged: online submit (it now also goes through the local queue, so a dropped request
cannot lose data), triage, map, dispatch, admin, demo mode.

## 2. Files

**New:** `src/lib/offline/{types,db,store,sync,images,identity,events}.ts`, `src/lib/{attachments,serverAuth}.ts`,
`src/hooks/useOfflineReports.ts`, `src/components/offline/{PhotoAttachments,SavedConfirmation,StatusChip}.tsx`,
`src/components/{PwaRegister}.tsx`, `src/components/dashboard/CasePhotos.tsx`, `src/app/report/saved/page.tsx`,
`src/app/manifest.ts`, `src/app/api/reports/[id]/attachments/{route.ts,[aid]/route.ts}`, `public/{sw.js,offline.html,icons/*}`,
`supabase/migrations/009_offline_first.sql`, `tests/{offline,attachments}.test.ts`.

**Changed:** `ReportForm.tsx` (IndexedDB drafts, photos, incident time, urgency, offline save), `LocationPicker.tsx`
(typed coordinates, GPS timestamp, offline note), `report/page.tsx`, `SyncStatus.tsx`, `layout.tsx`, `reportService.ts`,
`validation.ts`, `types.ts`, `constants.ts` + `triageRules.ts` (earthquake, blocked road, medical emergency), `db/*` stores,
`api/reports/route.ts`, `session.ts` (clears cached identity on sign-out), map/case/status pages (tolerate reports without
coordinates), `next.config.js` (service-worker headers), `package.json`.
**Removed:** `lib/offlineQueue.ts`, `hooks/useOfflineSync.ts` (replaced; unsent items in the old v1 database are migrated).

## 3. IndexedDB schema (`vyra-offline`, v2)

- `reports` (key `client_id`; indexes `owner`, `status`): `owner` (user id or `anon`), `status`, `form`, `payload`, `step`,
  timestamps, `attempts`, `next_attempt_at`, `last_error`, `server_id`, `server_status`, `synced_at`, `duplicate`, `created_offline`.
- `attachments` (key `id`; index `report_id`): `blob`, `type`, `size`, `status` (`local|uploading|uploaded|failed`), `error`, `server_attachment_id`.
- `meta`: `lastSyncAt`, `lastIdentity`.

State model: `draft → saved_locally → syncing → synced`; temporary failure → `waiting` (backoff 5 s…10 min, full jitter);
server rejection → `failed` (manual retry); expired/other account → `needs_auth`. `synced` is set only after the server
confirmed the report and every photo; photo blobs are then deleted from the device.

## 4. Supabase setup

1. Run `supabase/migrations/009_offline_first.sql` in the SQL editor. It adds the new columns, makes coordinates optional,
   creates `report_attachments` and the private `report-attachments` bucket with an **insert-only** policy.
2. Set `SUPABASE_SERVICE_ROLE_KEY` on the server (not `NEXT_PUBLIC_`). Without it, uploads still work, but responders cannot view photos.
3. `npm install`, then deploy as before. Demo mode (`VYRA_DATA_MODE=demo`) needs none of this.

## 5. Test it in airplane mode (needs HTTPS or localhost; production build, not `next dev`)

1. `npm run build && npm start`, open `/report` once while online. Wait ~5 s, then install (browser menu → Install app).
2. Turn on airplane mode, open the installed app (or reload `/report`). The form opens and shows the offline banner.
3. Fill in a landmark (no GPS needed), add a photo, press **Save report on this device**. You see
   “Saved on this device — waiting to sync”, never “received”. Check `/report/saved`.
4. Turn airplane mode off. The report and photo send by themselves; the page then shows the reference number.

## 6. Tests

`npm test` runs 57 tests, with IndexedDB and the server mocked (no network): first offline report, drafts across
restart, photos + previews, multiple pending reports, disconnect mid-sync (resume without re-sending), duplicate sync
attempts, lost response, expired auth, wrong/other account, anonymous reports, storage quota exhaustion, failed photo
+ retry, backoff, ownership checks on the server, private upload rules, responder-only downloads, landmark-only reports.

## 7. Known limits and data-loss risks

- Unsent reports exist only on that device. Clearing site data, uninstalling, private/incognito windows or device failure
  delete them. `navigator.storage.persist()` is requested but browsers may refuse.
- iOS Safari: no automatic background sync; sync runs when the app is open. Safari may evict site data after weeks of
  non-use unless the app is added to the Home Screen. HEIC photos are rejected (convert to JPEG).
- GPS without data depends on the device and sky view; map tiles do not load offline (typed coordinates and landmark text work).
- Browsers without IndexedDB or service workers (very old browsers) fall back to online-only sending, and say so.
- A device clock that is wrong makes `incident_time` / `client_created_at` wrong; both are shown as unverified.
- The offline pages are cached after the first online visit. A device that never loaded VYRA online cannot open it offline.
- Anonymous reports sync anonymously even if someone signs in later; account reports wait for that same account.
- Existing project note: other tables still use permissive RLS (`USING (true)`), as before. Only the new attachment storage is locked down.
- There is no AI image analysis in this repository, so nothing is marked "AI pending". Photos are stored, not analysed.
