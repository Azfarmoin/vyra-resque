# VYRA Early Warning System

VYRA **repeats and organises what official sources publish**. It does not predict disasters. Every alert shows its source, issue time, last-updated time, area, expected period, original link, precautions and limits. If no verified source is configured the app says it is **not monitoring** and shows preparedness guidance only. Nothing is ever seeded or faked.

## How it works

```
scheduler (every ~10 min) ──POST /api/alerts/cron (Bearer CRON_SECRET)──> runMonitoring()
   providers (CAP feeds, USGS, Open-Meteo estimates) -> validate -> de-duplicate/revise -> store -> notify only material changes
browser: GET /api/alerts -> match to saved places ON THE DEVICE -> banner / map / /alerts page; last good copy cached for offline
```

* **Alert levels**: Information, Watch, Warning, Emergency, mapped from the source's CAP severity/urgency/certainty/responseType (rules in `src/lib/alerts/cap.ts`; uncertain "Possible/Unlikely" never exceeds Watch).
* **Origins** (always labelled): `official`, `observation` (recorded earthquakes), `internal_estimate` (VYRA rules, max Watch, never pushed), `manual` (admin-authored).
* **AI** only rewords official text; output is validated (no new numbers/links, no "safe", no destinations, no raised severity) and falls back to an automatic template summary. The original text is always shown next to it.

## Data sources

| Provider id | Feed | Coverage | Hazards | Update | Auth | Notes |
|---|---|---|---|---|---|---|
| `pmd-cap` | **You must supply** `ALERT_PMD_CAP_URL` | Pakistan | rain, flood, cyclone, heat, wind, landslide, quake | polled every 10 min | optional bearer token | PMD's site has an "Alerts (CAP)" section and Pakistan is in the WMO Register of Alerting Authorities, but a stable machine-readable URL was **not confirmed**, so none is hard-coded. Confirm with PMD / https://alertingauthority.wmo.int/ |
| `ndma-cap` | **You must supply** `ALERT_NDMA_CAP_URL` | Pakistan | floods, landslides, heat, other | 10 min | optional | NDMA issues advisories via press releases and its Pak NDMA Disaster Alert app; no public feed confirmed. Ask NDMA for data sharing |
| `ffd-cap` | **You must supply** `ALERT_FFD_CAP_URL` | Pakistan river basins | river flood | 10 min | optional | FFD (ffd.pmd.gov.pk) publishes bulletins on its site; no feed confirmed |
| `cap-<id>` | `ALERT_CAP_FEEDS` JSON | any | any | 10 min | optional | any WMO-registered CAP feed |
| `usgs-earthquakes` | `earthquake.usgs.gov/.../4.5_day.geojson` | global M4.5+ | earthquake | 15 min | none | **After-the-event records only.** Enable with `ALERT_USGS_ENABLED=true` |
| `open-meteo-estimates` | `api.open-meteo.com/v1/forecast` | your `ALERT_MONITOR_POINTS` | rain, heat, gusts | hourly | none (free = non-commercial) | **VYRA estimates**, thresholds are illustrative defaults (`ALERT_ESTIMATE_THRESHOLDS`) |

Unconfigured providers are never called. Floodwater/river-gauge data and earthquake *early-warning* feeds are not included because no verified public feed for Pakistan was confirmed. Add one as another CAP feed when the authority provides it.

## Environment variables
See `.env.example` (section "Early-warning system"): `CRON_SECRET`, `ALERT_*_CAP_URL`, `ALERT_CAP_FEEDS`, `ALERT_USGS_ENABLED`, `ALERT_OPEN_METEO_ENABLED`, `ALERT_MONITOR_POINTS`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `SUPABASE_SERVICE_ROLE_KEY` (required for persistent storage), optional `ANTHROPIC_API_KEY`/`ALERT_AI_MODEL`. Feed URLs and tokens live **only** in server environment variables, never in the database or browser.

## Database
Run `supabase/migrations/008_early_warning.sql` (also run by `npm run db:setup`). Tables: `disaster_alerts` (unique `(provider, external_alert_id)`), `alert_provider_health`, `alert_provider_settings`, `alert_ingest_issues`, `alert_audit_log`, `alert_push_subscriptions`, `alert_notifications` (unique per alert revision + subscriber + kind), `user_alert_preferences`. RLS is on for all: alerts are publicly readable **except** `raw_source_metadata` and `created_by` (column grants); ops tables are admin-read only; push subscriptions have no browser access; preferences are owner-only.

## Scheduling
Any scheduler may call `POST /api/alerts/cron` with `Authorization: Bearer $CRON_SECRET`. Included: `.github/workflows/alerts-monitor.yml` (every 10 min; set repo secrets `VYRA_URL`, `CRON_SECRET`). Vercel Hobby cron is daily only, so use GitHub Actions, Supabase `pg_cron` + `pg_net`, or a paid cron. Each provider has its own minimum interval and exponential back-off after failures; an admin can force a run.

## Push notifications
1. `npm run vapid:generate`; set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.
2. Deploy over HTTPS using a production build (the service worker registers only in production).
3. Users open **Alerts**, add a place, then press *Turn on push alerts* (permission is asked only then, after the limits are explained).
Push needs connectivity; it cannot reach an offline device. Endpoints are restricted to known push-service hosts (SSRF guard); expired subscriptions (404/410) are removed; each alert revision notifies a subscriber at most once.

## Tests
`npm test` (mocked feeds only). `tests/alerts.test.ts` + `tests/alertsClient.test.ts` cover ingestion, severity mapping, location matching, expiry/cancel, duplicates and revisions, outages/stale data/back-off, conflicts, AI safeguards, push failures, privacy, offline display and server-side scheduling.

## Known limitations
* Supabase store, RLS migration and the UI components were **not run against a live database/browser** in the authoring environment.
* Official feed URLs for PMD/NDMA/FFD must be supplied by you.
* Preparedness text is drafted from public sources (Ready.gov, WHO) and is marked **not yet reviewed**; have an emergency-management reviewer check it against NDMA/PDMA guidance and then set `reviewedAt`/`reviewedBy` in `src/lib/alerts/guidance.ts`.
* AI keyword/safety checks for summaries are English-pattern based; for translations only number/link checks apply and the original is always shown.
* Location matching uses published boundaries; named cities use centre points (approximate). Polygons crossing the antimeridian are unsupported.
