// Applies supabase/migrations/014_satellite_analysis.sql to an in-memory Postgres (PGlite) with Supabase-style roles and
// auth.uid(), then checks row level security, the append-only triggers and the table constraints. Run: npm run test:satellite-rls
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const db = new PGlite()
const R = fileURLToPath(new URL('../', import.meta.url))
let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m) } }
await db.exec(`
 create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
 create schema auth;
 create table auth.users (id uuid primary key default gen_random_uuid(), email text);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
 create type user_role as enum ('citizen','responder','admin');
 create table public.profiles (id uuid primary key, email text unique not null, full_name text, role user_role default 'citizen');
 create function public.current_user_role() returns text language sql stable security definer set search_path = public as $$ select role::text from public.profiles where id = auth.uid() $$;
 grant usage on schema public, auth to anon, authenticated, service_role;
 grant execute on all functions in schema public to anon, authenticated;
 grant execute on function auth.uid() to anon, authenticated;
`)
const CIT = '00000000-0000-4000-8000-00000000000a', RESP = '00000000-0000-4000-8000-00000000000b', RESP2 = '00000000-0000-4000-8000-00000000000c'
await db.exec(`insert into auth.users(id,email) values ('${CIT}','c@x.co'),('${RESP}','r@x.co'),('${RESP2}','r2@x.co');
 insert into profiles(id,email,role) values ('${CIT}','c@x.co','citizen'),('${RESP}','r@x.co','responder'),('${RESP2}','r2@x.co','admin');`)
const sql = readFileSync(R + 'supabase/migrations/014_satellite_analysis.sql', 'utf8')
await db.exec(sql); await db.exec(sql)
ok(true, 'migration ran twice (idempotent)')
await db.exec(`grant all on all tables in schema public to anon, authenticated, service_role;`)

const as = async (uid, fn) => { await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${uid}',false)`); try { return await fn() } finally { await db.exec(`reset role`) } }
const tryQ = async (q) => { try { await db.exec(q); return null } catch (e) { return e.message } }
const A1 = '10000000-0000-4000-8000-000000000001'
const insA = (id, by) => `insert into satellite_analyses(id,created_at,created_by,status,provider,collection,aoi,before_range,after_range) values ('${id}', now(), '${by}', 'completed','planetary-computer','sentinel-2-l2a','{}','{}','{}')`

ok(await as(CIT, () => tryQ(insA(A1, CIT))) !== null, 'a citizen cannot insert an analysis')
ok(await as(RESP, () => tryQ(insA(A1, CIT))) !== null, 'a responder cannot insert an analysis in someone else\'s name')
ok(await as(RESP, () => tryQ(insA(A1, RESP))) === null, 'a responder can insert their own analysis')
ok(await as(RESP, () => tryQ(`insert into satellite_images(analysis_id,kind,png_base64) values ('${A1}','change','AAAA')`)) === null, 'the owner can add images')
ok(await as(RESP2, () => tryQ(`insert into satellite_images(analysis_id,kind,png_base64) values ('${A1}','before','AAAA')`)) !== null, 'another responder cannot add images to someone else\'s analysis')
ok((await as(CIT, () => db.query('select * from satellite_analyses'))).rows.length === 0, 'a citizen reads no analyses')
ok((await as(CIT, () => db.query('select * from satellite_images'))).rows.length === 0, 'a citizen reads no images')
ok((await as(RESP2, () => db.query('select * from satellite_analyses'))).rows.length === 1, 'staff read analyses')
ok(await as(RESP, () => tryQ(insA('10000000-0000-4000-8000-000000000002', RESP).replace("'completed'", "'weird'"))) !== null, 'unknown statuses are rejected')
ok(await as(RESP, () => tryQ(insA('10000000-0000-4000-8000-000000000003', RESP).replace("'planetary-computer'", "'made-up-provider'"))) !== null, 'unknown providers are rejected by the table')

// append-only: nobody can edit or delete, not even the table owner
await as(RESP, () => tryQ(`update satellite_analyses set status='failed' where id='${A1}'`)) // no UPDATE policy: matches no rows
ok(/append-only/.test((await tryQ(`update satellite_analyses set status='failed' where id='${A1}'`)) ?? ''), 'updating an analysis is refused even for the owner role (trigger)')
ok(/append-only/.test((await tryQ(`delete from satellite_analyses where id='${A1}'`)) ?? ''), 'deleting an analysis is refused even for the owner role')
ok((await db.query(`select status from satellite_analyses where id='${A1}'`)).rows[0].status === 'completed', 'analysis unchanged after both attempts')

// reviews
const rev = (state, note, ack, by) => `insert into satellite_reviews(analysis_id,state,note,acknowledged_limitations,reviewed_by) values ('${A1}','${state}',${note === null ? 'null' : `'${note}'`},${ack},'${by}')`
ok(await as(RESP, () => tryQ(rev('inconclusive', null, false, RESP))) === null, 'staff can record a review')
ok(await as(CIT, () => tryQ(rev('inconclusive', null, false, CIT))) !== null, 'a citizen cannot review')
ok(await as(RESP, () => tryQ(rev('inconclusive', null, false, RESP2))) !== null, 'a reviewer cannot sign as someone else')
ok(await as(RESP, () => tryQ(rev('confirmed_by_reviewer', null, true, RESP))) !== null, 'confirming without a note is rejected by the table')
ok(await as(RESP, () => tryQ(rev('confirmed_by_reviewer', 'short', true, RESP))) !== null, 'confirming with a trivial note is rejected')
ok(await as(RESP, () => tryQ(rev('confirmed_by_reviewer', 'Checked against the field photo', false, RESP))) !== null, 'confirming without the acknowledgement is rejected')
ok(await as(RESP, () => tryQ(rev('confirmed_by_reviewer', 'Checked against the field photo', true, RESP))) === null, 'a proper confirmation is accepted')
ok(await as(RESP, () => tryQ(rev('made_up', 'x', false, RESP))) !== null, 'unknown review states are rejected')
ok(/append-only/.test((await tryQ(`update satellite_reviews set state='inconclusive'`)) ?? ''), 'reviews cannot be edited')
ok(/append-only/.test((await tryQ(`delete from satellite_reviews`)) ?? ''), 'reviews cannot be deleted')
ok((await db.query('select state from satellite_reviews order by created_at')).rows.length === 2, 'review history keeps every entry')

// links
const link = (type, id, by) => `insert into satellite_links(analysis_id,target_type,target_id,linked_by) values ('${A1}','${type}','${id}','${by}')`
ok(await as(RESP, () => tryQ(link('report', 'r-1', RESP))) === null, 'staff can link to a report')
ok(await as(RESP, () => tryQ(link('report', 'r-1', RESP))) !== null, 'the same link twice is rejected')
ok(await as(RESP, () => tryQ(link('dispatch', 'd-1', RESP))) !== null, 'only report / hazard / zone targets are allowed')
ok(await as(CIT, () => tryQ(link('zone', 'z-1', CIT))) !== null, 'a citizen cannot link')
ok(/append-only/.test((await tryQ(`delete from satellite_links`)) ?? ''), 'links cannot be deleted')
ok((await as(CIT, () => db.query('select * from satellite_links'))).rows.length === 0, 'a citizen reads no links')
console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
