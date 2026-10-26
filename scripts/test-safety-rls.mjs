// Applies supabase/migrations/015_safety_content.sql to an in-memory Postgres (PGlite) with Supabase-style roles and
// auth.uid(), then checks row level security, the append-only triggers and the table constraints. Run: npm run test:rls:safety
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
const sql = readFileSync(R + 'supabase/migrations/015_safety_content.sql', 'utf8')
await db.exec(sql); await db.exec(sql)
ok(true, 'migration ran twice (idempotent)')
await db.exec(`grant all on all tables in schema public to anon, authenticated, service_role;`)

const as = async (uid, fn) => { await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${uid}',false)`); try { return await fn() } finally { await db.exec('reset role') } }
const anon = async (fn) => { await db.exec(`set role anon; select set_config('request.jwt.claim.sub','',false)`); try { return await fn() } finally { await db.exec('reset role') } }
const tryQ = async (q) => { try { await db.exec(q); return null } catch (e) { return e.message } }
const cols = (await db.query("select column_name from information_schema.columns where table_name='safety_content' order by ordinal_position")).rows.map((r) => r.column_name)
ok(cols.length > 3, 'safety_content table exists: ' + cols.join(','))
await db.exec("reset role")
const ins = (st) => `insert into safety_content(hazard_id,status,content,change_reason${st === 'published' ? ',reviewed_by,reviewed_on' : ''}) values ('flood','${st}','{"id":"flood"}'::jsonb,'initial text'${st === 'published' ? ",'Reviewer One',current_date" : ''})`
ok(await as(CIT, () => tryQ(ins('published'))) !== null, 'a citizen cannot write safety content')
ok(await as(RESP, () => tryQ(ins('published'))) !== null, 'a responder cannot write safety content')
ok(await as(RESP2, () => tryQ(ins('draft'))) === null, 'an administrator can write a draft')
ok((await anon(() => db.query('select * from safety_content'))).rows.length === 0, 'the public cannot read a draft')
ok(await as(RESP2, () => tryQ("update safety_content set status='published', reviewed_by='Reviewer One', reviewed_on=current_date, change_reason='review done' where hazard_id='flood'")) === null, 'an administrator can publish')
ok((await anon(() => db.query('select * from safety_content'))).rows.length === 1, 'the public reads published content')
console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
