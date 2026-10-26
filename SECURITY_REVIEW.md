# Security review: role escalation and related findings

> **After the merge into the unified project:** the role-escalation fix for `profiles` (items 1-3) ships as `011_profiles_role_hardening.sql`, which the project already had; the shelter work added only the extras as `018_profiles_self_demotion_guard.sql` (an administrator cannot demote themselves; a role decision closes the responder request). The shelter migration is `017_shelter_assistant.sql`. Where this review says `011`/`012`, read `011`/`017`+`018`.

Scope: the whole project, because the shelter tools depend on role checks being real. Method: code reading and automated scans. **The SQL fixes were not executed against Postgres in the build environment**; run `npm run test:shelters-sql` (it also covers migration 011) and the manual checks in section 4 before going public.

## 1. Fixed

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | **Critical** | `profiles` had `INSERT WITH CHECK (true)` and `UPDATE USING (true)`. Anyone with the public anon key could run `update profiles set role='admin'` against the REST API (or insert themselves as admin). Every app role check reads this column. | Migration `011`: own-row-only policies, insert only as `citizen`, a `BEFORE INSERT OR UPDATE` trigger that refuses role changes unless the caller is an administrator or the server, no self-demotion of the last-resort admin. |
| 2 | **Critical** | The sign-up page sent the **role chosen in the browser** as the profile role, so anyone could register as a responder. | Profiles are created by a trigger on `auth.users` as `citizen`. "Responder" is stored as `requested_role` and does nothing until an administrator approves it on the Accounts page (new "Approve as responder" button, `PATCH /api/admin/users`). |
| 3 | **High** | `profiles` was readable by everyone (emails and roles of all accounts, including who the admins are). | `SELECT` limited to your own row, and to staff. Server code that read roles anonymously now reads them as the signed-in user (or the service key). |
| 4 | **High** | Demo sign-in trusts an email in `x-demo-user` / `x-demo-admin`, and the demo accounts are public. VYRA falls back to demo mode when Supabase variables are missing, so a mistyped production variable silently produced an open "admin for anyone" site. | `demoAuthAllowed()`: demo identities are ignored in production unless `VYRA_ALLOW_DEMO_IN_PRODUCTION=true`. Applied everywhere a demo header is read; a test fails if a new place forgets it. |
| 5 | **High** | These existing endpoints had **no authentication**: `POST/PATCH /api/dispatches`, `PATCH /api/reports/:id` (status), `.../verify`, `.../triage-override`, `POST/PATCH/DELETE /api/resources`, `/api/teams`. Anyone could verify reports, override triage, send teams, delete supplies. | `staffGate`: a signed-in responder or admin is required (open only in non-production demo mode, so local demo and tests behave as before). The UI now sends credentials on these calls. A test fails if any mutating route lacks an auth check. |
| 6 | **High** | `POST /api/shelters` had no authentication. | Administrators only; new records start unverified. All shelter reads/writes go through the permission matrix. |
| 7 | Medium | Seed script would collide with the new sign-up trigger. | Seed upserts profiles (`ON CONFLICT DO UPDATE`). |

## 2. Remaining risks: do these before a public launch

1. **Row-level security on the older tables is still permissive.** `emergency_reports`, `report_events`, `dispatches`, `dispatch_resources`, `resources`, `rescue_teams`, `blocked_roads` keep `USING (true)` write policies from schema 002, because the existing server routes talk to them with the **anon key** (no user token). The route-level gates above stop attacks through the app, but **someone holding your public anon key can still call the database REST API directly** and edit those tables. Fix: switch those routes to a user-scoped client (as the shelter routes do) and replace the policies with `current_user_role() IN ('responder','admin')` writes, then re-test. This is the largest open item.
2. **Public GET endpoints** return incident and mission data without a role check (`GET /api/dispatches`, `/api/resources`, `/api/teams`, report lists). Decide what citizens should see.
3. Review the accounts that already exist (`role <> 'citizen'`): anyone who registered as a responder under the old page may have kept the role.
4. `alerts/push` (citizen subscriptions) and `support` submission are open on purpose; both are rate limited. `alerts/cron` requires `CRON_SECRET`.
5. The demo password is public. Never enable `VYRA_ALLOW_DEMO_IN_PRODUCTION` on a site with real users.
6. Rate limiting is in-memory per server instance (existing design); use a shared store if you run several instances.

## 3. Behaviour changes to be aware of
* Adding a shelter on the Supplies page is now **administrators only** (it was open to anyone). Responders update headcounts on /shelters.
* `GET /api/shelters` returns `{ shelters, view }` instead of a bare array (the Supplies page was updated; other consumers must be too).
* New sign-ups cannot choose "responder"; an administrator approves.

## 4. Manual verification (5 minutes, with a real project)
1. As an anonymous client with only the anon key: `PATCH /rest/v1/profiles?id=eq.<your id>` with `{"role":"admin"}` must fail ("Only an administrator can change a role").
2. Register a new account choosing responder: role stays `citizen`, `requested_role = responder`; approve it as admin; role becomes `responder`.
3. `GET /rest/v1/profiles` with the anon key returns no rows.
4. `POST /api/dispatches` with no token returns 401.
5. In production with Supabase variables removed, `x-demo-admin: admin@demo.vyra` must not grant access.
