# AI photo analysis

Optional feature. A reporter who ticks the consent box gets suggestions (title, description, hazards, urgency) from the photos on their report. Everything is **unverified**, a responder reviews it, and the report can always be sent without it.

## How it works
1. **Form** (`/report`, step "What is happening?"): photos are saved on the device first (existing offline system). Take photo / choose photos / remove / **replace**. A consent checkbox (off every time) turns analysis on.
2. **Preview**: right after a photo is saved and consent is on, the form calls `POST /api/photo-analysis/preview` (nothing is stored). Offline, it shows **"Waiting for internet connection"** and retries when the connection returns. No result is ever faked offline.
3. **AI Photo Analysis panel**: per photo, with *Use Suggestions*, *Edit Suggestions*, *Analyze Again*, *Ignore Analysis*, tick-boxes for which incident types and which photos to include, and a combined summary with conflicts for several photos. Using suggestions only **adds** (danger types are added, text is appended after what was typed, urgency is only set if empty). Added fields carry an "AI suggestion" marker until the reporter edits or confirms them.
4. **After sync**: once the server confirms a photo, `sync.ts` asks the server to analyse the stored copy (`POST /api/reports/:id/attachments/:aid/analysis`) and saves the result. Best effort, idempotent, never changes whether the report counts as synced.
5. **Responders/admins**: "AI photo analysis (unverified)" panel in the case view with per-photo findings, model and time, review buttons (Confirm / Reject / Needs more info), an advisory note if a photo suggests more urgency than the current priority, and a pointer to the existing map/road-block verification for possible blockages.

## What the AI cannot do (enforced in code, not only in the prompt)
- It never changes the priority score, status, zones, blocked-road records, evacuation orders or dispatch. Triage is untouched.
- Output is validated with zod. Invalid output is discarded and the photo shows "analysis unavailable".
- `src/lib/photoAnalysis/safety.ts` removes statements that something is safe/passable/sound, identify people, diagnose injuries, or guess a location. It always adds limitations (photo may be old, edited or unrelated; cannot show safety; needs a person). `review_required` is always true. Confidence is a low/medium/high word, labelled as not a probability.

## Structured result (per photo)
`detected_incident_types, visual_observations, possible_hazards, damage_indicators, possible_road_blockages, suggested_report_title, suggested_description, suggested_severity, confidence, limitations, review_required, analysis_status (pending|processing|completed|failed), analyzed_at, model_provider, model_version`.

## Provider and configuration
Same provider as the existing AI feature: Anthropic Messages API, forced tool call, 25 s timeout.

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Enables analysis (server only). Without it the panel says analysis is not available. |
| `VYRA_AI_MODEL` | Model id (default `claude-sonnet-5-5`). Must accept images. |
| `ANTHROPIC_BASE_URL` | Optional proxy/base URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only. Needed to save analyses and read private photos. |
| `VYRA_SIGNING_SECRET` | Optional secret for 5-minute signed photo links. |
| `NEXT_PUBLIC_MAX_PHOTO_MB` / `NEXT_PUBLIC_MAX_PHOTOS` | Limits (1-5 MB, 1-20 photos; defaults 5 / 8). |

## Database (`supabase/migrations/013_photo_analysis.sql`, run by `npm run db:setup`)
New table `attachment_analyses` (one row per photo: report, uploader, status, result JSON, consent time, model, review status/by/at/note, what the reporter did with the suggestions, attempts). RLS: staff can read and record reviews; nobody else can read; **no insert/delete policy** (only the server with the service-role key writes). The photo bucket is unchanged: private, insert-only; photos are read only through the server or **5-minute HMAC-signed links** minted for staff (`POST /api/reports/:id/attachments/:aid`).

## API
| Route | Who |
|---|---|
| `POST /api/photo-analysis/preview` (raw image, header `X-Analysis-Consent: yes`) | anyone, rate limited, validates type/size, stores nothing |
| `POST/GET/PATCH /api/reports/:id/attachments/:aid/analysis` | owner or creating device (POST/GET, PATCH `user_action`); staff (GET, PATCH `review_status`) |
| `GET /api/reports/:id/analyses` | staff: all photos + combined summary |
| `POST /api/reports/:id/attachments/:aid` | staff: signed link |

## Tests (mocked AI, no paid calls)
`npm test` (includes `photoAnalysis.logic|api|offline`) and `npm run test:rls:photo` (RLS on a real Postgres engine, PGlite).

## Known limitations
- Real model calls were not run here (no key); the request/response path was exercised against a local mock server only. Quality of real answers on real disaster photos is not evaluated.
- The preview and the stored copy are analysed separately (a short in-memory cache avoids a second paid call on the same server instance only).
- The rate limiter is per server instance. Photos are not scanned for malware or decoded; type is checked by file signature.
- A photo whose analysis ran only in the form preview (reporter never synced) is not saved anywhere.
- No live Supabase, no real-device camera and no real airplane-mode run were available.
