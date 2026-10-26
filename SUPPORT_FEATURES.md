# FAQ, Contact us and Emergency precautions

Three pages added to VYRA. Nothing existing was removed. No email of any kind is sent or configured.

| Page | Route | Notes |
|---|---|---|
| FAQ | `/faq` | 21 questions in 5 categories; search, topic filter, accordions, deep links like `/faq#ai-accuracy` |
| Contact us | `/contact` | In-app support form; saves to the database and shows a `SUP-XXXXXXXX` reference |
| Emergency precautions | `/precautions` | 7 categories; verified official numbers kept separate from general advice |
| Support inbox (admin) | `/admin/support` | Administrators read requests and change status (Open / In progress / Resolved) and category |

## Setup
1. Real Supabase: run `supabase/migrations/007_support_requests.sql` once (SQL Editor, or `npm run db:setup`, which now includes it). Safe to re-run. Needs the main schema first.
2. Demo mode (`VYRA_DATA_MODE=demo`): nothing to do. Requests live in memory and reset on restart. Demo admin: `admin@demo.vyra`.
3. No new environment variables are required. Optional: `SUPPORT_HASH_SALT` (any random string) salts the hash of sender network addresses used for rate limiting. Addresses are never stored.

## How access control works
- All writes go through the database function `submit_support_request()` (validates, de-duplicates, rate-limits). There is no INSERT or DELETE policy and `anon` has no table privileges.
- Signed-in users can SELECT only rows with `user_id = auth.uid()`. People who are not signed in can submit but cannot read anything back, which is why the reference is shown on screen.
- Administrators (`profiles.role = 'admin'`, via `is_support_staff()`) can read all rows and UPDATE only `status` and `category` (column grant plus a trigger that rejects edits to any other column, even from the service role).
- The API forwards the caller's own Supabase token, so RLS is the real gate. The service key is never used by this feature.

## Spam and abuse protection
Shared zod validation on client and server; hidden honeypot field; minimum fill time (2.5 s); max 2 links; repeated-character and gibberish checks; in-app limit of 5 per hour and 10 s apart per sender; the same limits in the database (per account, plus a global cap on anonymous submissions); identical message resent within 10 minutes returns the original reference instead of a duplicate; the button is disabled while sending.

## Files
Added: `src/lib/support.ts`, `src/lib/supportServer.ts`, `src/lib/supportClient.ts`, `src/lib/content/faq.ts`, `src/lib/content/precautions.ts`, `src/app/faq/page.tsx`, `src/app/contact/page.tsx`, `src/app/precautions/page.tsx`, `src/app/admin/support/page.tsx`, `src/app/api/support/route.ts`, `src/app/api/support/[id]/route.ts`, `src/components/common/SiteFooter.tsx`, `supabase/migrations/007_support_requests.sql`, `tests/support.test.ts`, `scripts/test-support-rls.mjs`, this file.
Changed: `src/components/common/SiteHeader.tsx` (Help menu; Accounts and Support grouped under an Admin menu; burger menu now starts at 1024 px, or 1280 px for administrators, so the extra links fit), `src/app/page.tsx` (footer moved to `SiteFooter`, same text plus three links), `scripts/setup-db.js`, `SETUP_GUIDE.md`, `package.json` (test script, `test:rls`, dev dependency `@electric-sql/pglite` for the RLS test).

## Tests
- `npm test`: 41 pass (26 existing + 15 new: validation, saving, reference, duplicates, spam, rate limit, per-user isolation, admin-only updates, FAQ search, link integrity, emergency-content rules, no-email guard, navigation).
- `npm run test:rls`: applies the migration (twice) to an in-memory Postgres with Supabase-style roles; 31 checks on RLS, grants, triggers, rate limits.
- Browser run (Playwright, production build, demo mode): 103 checks pass: accordion by mouse and keyboard, search and empty states, form validation, message kept after failure, double-click sends once, reference shown, citizen/neighbour isolation, admin workflow persisting after reload, no horizontal overflow at 390/768/1024/1280 px, existing pages still load, no console errors.
- Not run: the app against a live Supabase project (no credentials here). The SQL was run on Postgres, but the Next.js to Supabase path (`rpc`, token forwarding) was not.

## Things to know before launch
- **Emergency numbers.** Five numbers are listed, each read from an official page on 25 Oct 2026: Rescue 1122 (rescue.gov.pk and PDMA Sindh), PDMA Sindh helpline 1736 (pdma.gos.pk), Police 15 (Punjab Police; also listed as Sindh Police Madadgar on sindh.gov.pk), Edhi ambulance 115 and Aman ambulance +92 (21) 1021 (both from the Government of Sindh emergency-contacts page, which has a "load more" button, so more may exist). None of the pages state coverage areas, and the page says so. Add others in `src/lib/content/precautions.ts` only after reading them from an official page.
- **General safety guidance** is standard advice written for this project. I could not open the Ready.gov or NDMA pages from the build environment, so it was not checked line by line against them. The page says it is general advice, last reviewed 24 October 2026 by the VYRA project, and not endorsed by an authority. Have a local disaster-management professional review it.
- **Existing security gap.** The existing `profiles` policies let any signed-in user change their own `role` (README already notes the open policies). Because support-staff access relies on `profiles.role`, that gap would let such a user read support requests. Tightening the `profiles` policies is outside this change and is recommended.
- The FAQ says photos cannot be uploaded because the report form has no photo feature. The "AI analysis" answers describe the actual rule-based triage and state that findings can be wrong.
