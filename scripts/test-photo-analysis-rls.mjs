// Applies supabase/migrations/013_photo_analysis.sql to an in-memory Postgres (PGlite) with Supabase-style roles
// and checks who can read/write photo analyses. Run: npm run test:rls:photo
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const db = new PGlite()
const R = fileURLToPath(new URL('../', import.meta.url))
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : (fail++, console.log('FAIL', m)) }
await db.exec(`
 create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
 create schema auth;
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
 create type user_role as enum ('citizen','responder','admin');
 create table public.profiles (id uuid primary key, role user_role default 'citizen');
 create function uuid_generate_v4() returns uuid language sql as $$ select gen_random_uuid() $$;
 create function update_updated_at_column() returns trigger as $$ begin new.updated_at = now(); return new; end; $$ language plpgsql;
 create function public.current_user_role() returns text language sql stable security definer set search_path = public as $$ select role::text from public.profiles where id = auth.uid() $$;
 create table public.emergency_reports (id uuid primary key default gen_random_uuid());
 create table public.report_attachments (id uuid primary key default gen_random_uuid(), report_id uuid not null references emergency_reports(id) on delete cascade);
 grant usage on schema public, auth to anon, authenticated, service_role;
`)
const CIT = '00000000-0000-4000-8000-00000000000a', RESP = '00000000-0000-4000-8000-00000000000b', ADM = '00000000-0000-4000-8000-0000000000ad'
await db.exec(`insert into profiles values ('${CIT}','citizen'),('${RESP}','responder'),('${ADM}','admin');
 insert into emergency_reports(id) values ('11111111-1111-4111-8111-111111111111');
 insert into report_attachments(id, report_id) values ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111');`)
const sql = readFileSync(R + 'supabase/migrations/013_photo_analysis.sql', 'utf8')
await db.exec(sql); await db.exec(sql) // idempotent
await db.exec(`grant all on all tables in schema public to anon, authenticated, service_role; grant execute on all functions in schema public to anon, authenticated;`)
ok(true, 'migration ran twice')
const as = async (role, uid) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub','${uid ?? ''}',false); set role ${role};`) }
const tryq = async (q) => { try { return { r: await db.query(q) } } catch (e) { return { e } } }

await as('service_role')
let x = await tryq(`insert into attachment_analyses(attachment_id, report_id, analysis_status, result, consent_at) values ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','completed','{"a":1}', now()) returning id, review_status, user_action`)
ok(x.r?.rows[0].review_status === 'unreviewed' && x.r.rows[0].user_action === 'none', 'server (service role) can insert; defaults are unreviewed/none: ' + x.e?.message)

for (const [role, uid, label] of [['anon', null, 'anonymous'], ['authenticated', CIT, 'citizen']]) {
  await as(role, uid)
  x = await tryq('select * from attachment_analyses'); ok(x.r && x.r.rows.length === 0, `${label} sees no analyses`)
  x = await tryq(`insert into attachment_analyses(attachment_id, report_id) values ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111')`)
  ok(x.e && /row-level security|violates|permission/i.test(x.e.message), `${label} cannot insert: ` + x.e?.message)
  x = await tryq(`update attachment_analyses set review_status='confirmed' returning id`); ok(!x.r || x.r.rows.length === 0, `${label} cannot review`)
  x = await tryq(`delete from attachment_analyses returning id`); ok(!x.r || x.r.rows.length === 0, `${label} cannot delete`)
}
for (const [uid, label] of [[RESP, 'responder'], [ADM, 'admin']]) {
  await as('authenticated', uid)
  x = await tryq('select * from attachment_analyses'); ok(x.r?.rows.length === 1, `${label} can read`)
  x = await tryq(`update attachment_analyses set review_status='confirmed', review_note='checked' returning review_status`); ok(x.r?.rows[0]?.review_status === 'confirmed', `${label} can record a review: ` + x.e?.message)
  x = await tryq(`insert into attachment_analyses(attachment_id, report_id) values ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111')`); ok(x.e, `${label} cannot insert (only the server does)`)
  x = await tryq(`delete from attachment_analyses returning id`); ok(!x.r || x.r.rows.length === 0, `${label} cannot delete`)
}
await as('service_role')
for (const bad of [`update attachment_analyses set review_status='approved'`, `update attachment_analyses set analysis_status='done'`, `update attachment_analyses set user_action='x'`, `update attachment_analyses set review_note='${'x'.repeat(501)}'`]) {
  x = await tryq(bad); ok(x.e && /check constraint/i.test(x.e.message), 'constraint rejects: ' + bad.slice(0, 50))
}
x = await tryq(`insert into attachment_analyses(attachment_id, report_id) values ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111')`)
ok(x.e && /unique|duplicate/i.test(x.e.message), 'one analysis row per photo')
await db.exec('reset role')
await db.exec(`delete from emergency_reports`)
x = await db.query('select count(*)::int n from attachment_analyses'); ok(x.rows[0].n === 0, 'analysis rows are deleted with their report')
console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
