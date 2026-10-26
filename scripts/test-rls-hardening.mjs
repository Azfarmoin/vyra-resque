// Role-escalation regression test. Applies the project's REAL schema (vyra_complete_schema.sql) and migrations 011 and 012
// to an in-memory Postgres (PGlite) with Supabase-style roles, then tries to attack public.profiles and the flood tables
// as an anonymous visitor, a citizen, a responder and an admin.  Run: npm run test:rls:hardening
//
// It first proves the BEFORE state (the original open policies let a citizen make themselves admin) and then that
// migration 011 closes the hole.
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const R = fileURLToPath(new URL('../', import.meta.url))
const db = new PGlite()
let pass = 0
let fail = 0
const ok = (c, m) => {
  if (c) { pass++; console.log('  ok  ', m) } else { fail++; console.log('  FAIL', m) }
}

const ids = {
  anon: null,
  citizen: '00000000-0000-4000-8000-0000000000c1',
  citizen2: '00000000-0000-4000-8000-0000000000c2',
  responder: '00000000-0000-4000-8000-0000000000e1',
  responder2: '00000000-0000-4000-8000-0000000000e2',
  admin: '00000000-0000-4000-8000-0000000000a1',
}

await db.exec(`
 create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
 create role authenticator login noinherit;
 create schema auth;
 create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}'::jsonb);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
 create function public.uuid_generate_v4() returns uuid language sql as $$ select gen_random_uuid() $$;
`)

// The project's real schema file, minus the extension line PGlite does not need.
const schema = readFileSync(R + 'supabase/vyra_complete_schema.sql', 'utf8').replace(/CREATE EXTENSION IF NOT EXISTS "uuid-ossp";/g, '')
// ALTER TYPE ... ADD VALUE cannot run inside the implicit transaction of exec(); the enum is created with it already.
await db.exec(schema.replace(/ALTER TYPE report_status ADD VALUE IF NOT EXISTS 'cancelled';/, ''))
await db.exec(`
 grant usage on schema public, auth to anon, authenticated, service_role;
 grant all on all tables in schema public to anon, authenticated, service_role;
 grant execute on all functions in schema public to anon, authenticated, service_role;
 grant execute on function auth.uid() to anon, authenticated, service_role;
`)

// Seed (as the superuser, the way the seed script does).
await db.exec(`
 insert into auth.users(id,email) values ('${ids.citizen}','c1@x.co'),('${ids.citizen2}','c2@x.co'),('${ids.responder}','r1@x.co'),('${ids.responder2}','r2@x.co'),('${ids.admin}','adm@x.co');
 insert into profiles(id,email,role) values ('${ids.citizen}','c1@x.co','citizen'),('${ids.citizen2}','c2@x.co','citizen'),('${ids.responder}','r1@x.co','responder'),('${ids.responder2}','r2@x.co','responder'),('${ids.admin}','adm@x.co','admin');
`)

const as = async (role, who) => {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub','${ids[who] ?? ''}',false); set role ${role};`)
}
const attempt = async (sql, params) => {
  try { const r = await db.query(sql, params); return { rows: r.rows, affected: r.affectedRows ?? r.rows.length } } catch (e) { return { error: e.message } }
}
const roleOf = async (who) => { await db.exec('reset role'); return (await db.query('select role from profiles where id=$1', [ids[who]])).rows[0]?.role }

console.log('\nBEFORE migration 011 (the original schema): demonstrate the vulnerability')
await as('authenticated', 'citizen')
let r = await attempt(`update profiles set role='admin' where id='${ids.citizen}'`)
ok(!r.error && (await roleOf('citizen')) === 'admin', 'VULNERABLE: a citizen can promote themselves to admin (confirms the bug existed)')
await db.exec(`reset role; update profiles set role='citizen' where id='${ids.citizen}'`)
await as('anon')
r = await attempt(`update profiles set role='admin' where id='${ids.citizen2}'`)
ok(!r.error && (await roleOf('citizen2')) === 'admin', 'VULNERABLE: an ANONYMOUS visitor can promote anyone to admin')
await db.exec(`reset role; update profiles set role='citizen' where id='${ids.citizen2}'`)
await as('anon')
r = await attempt('select email, role from profiles')
ok(!r.error && r.rows.length === 5, 'VULNERABLE: anonymous visitors can read every email and role')

const m11 = readFileSync(R + 'supabase/migrations/011_profiles_role_hardening.sql', 'utf8')
await db.exec('reset role')
await db.exec(m11)
await db.exec(m11) // idempotent: run twice
ok(true, 'migration 011 applies cleanly and twice')

console.log('\nAFTER migration 011')
await as('anon')
r = await attempt(`update profiles set role='admin' where id='${ids.citizen2}'`)
ok(!r.error && r.affected === 0 || !!r.error, 'anonymous cannot update any profile (0 rows / error)')
ok((await roleOf('citizen2')) === 'citizen', 'citizen2 is still a citizen after the anonymous attack')
await as('anon')
r = await attempt('select email, role from profiles')
ok(!r.error && r.rows.length === 0, 'anonymous can no longer read profiles (emails are private)')
r = await attempt(`insert into profiles(id,email,role) values (gen_random_uuid(),'evil@x.co','admin')`)
ok(!!r.error, 'anonymous cannot insert an admin profile: ' + (r.error ?? '').slice(0, 70))

await as('authenticated', 'citizen')
r = await attempt(`update profiles set role='admin' where id='${ids.citizen}'`)
ok(!!r.error && /Only an administrator can change a role|row-level security/.test(r.error), 'citizen cannot self-promote: ' + (r.error ?? '').slice(0, 80))
r = await attempt(`update profiles set role='responder' where id='${ids.citizen}'`)
ok(!!r.error, 'citizen cannot self-promote to responder')
r = await attempt(`update profiles set role='admin' where id='${ids.citizen2}'`)
ok(!r.error && r.affected === 0, 'citizen cannot touch another profile (0 rows)')
ok((await roleOf('citizen2')) === 'citizen' && (await roleOf('citizen')) === 'citizen', 'roles unchanged after citizen attacks')
await as('authenticated', 'citizen')
r = await attempt(`update profiles set full_name='New Name' where id='${ids.citizen}'`)
ok(!r.error && r.affected === 1, 'citizen CAN still edit own name')
r = await attempt(`update profiles set email='someone-else@x.co' where id='${ids.citizen}'`)
ok(!!r.error, 'citizen cannot change own email in profiles')
r = await attempt(`update profiles set role='citizen' where id='${ids.citizen}'`)
ok(!r.error, 'writing the same role is harmless')
r = await attempt('select id from profiles')
ok(!r.error && r.rows.length === 1 && r.rows[0].id === ids.citizen, 'citizen sees only their own profile')
r = await attempt(`insert into profiles(id,email,role) values ('${ids.citizen}','dup@x.co','admin')`)
ok(!!r.error, 'citizen cannot insert an admin profile for themselves')
r = await attempt(`insert into profiles(id,email,role) values (gen_random_uuid(),'x@x.co','citizen')`)
ok(!!r.error, 'citizen cannot insert a profile for a different id')

await as('authenticated', 'responder')
r = await attempt(`update profiles set role='admin' where id='${ids.responder}'`)
ok(!!r.error, 'responder cannot self-promote to admin')
r = await attempt(`update profiles set role='admin' where id='${ids.citizen}'`)
ok(!r.error && r.affected === 0, 'responder cannot promote someone else (0 rows)')
r = await attempt('select id from profiles')
ok(!r.error && r.rows.length === 5, 'responder (staff) can read all profiles')

await as('authenticated', 'admin')
r = await attempt(`update profiles set role='responder' where id='${ids.citizen}'`)
ok(!r.error && r.affected === 1, 'admin CAN change a role')
ok((await roleOf('citizen')) === 'responder', 'role change persisted')
await as('authenticated', 'admin')
r = await attempt(`insert into profiles(id,email,role) values (gen_random_uuid(),'new@x.co','responder')`)
ok(!r.error, 'admin can create a responder profile')
await db.exec(`reset role; update profiles set role='citizen' where id='${ids.citizen}'`)

console.log('\nSign-up trigger (auth.users -> profiles)')
await db.exec('reset role')
await db.exec(`insert into auth.users(id,email,raw_user_meta_data) values ('00000000-0000-4000-8000-0000000000f1','new1@x.co','{"full_name":"New One","role":"admin","requested_role":"responder"}')`)
let p = (await db.query(`select role, requested_role, full_name from profiles where id='00000000-0000-4000-8000-0000000000f1'`)).rows[0]
ok(p && p.role === 'citizen' && p.requested_role === 'responder' && p.full_name === 'New One', 'sign-up creates a CITIZEN even when metadata says role=admin; responder is only a request')
await db.exec(`insert into auth.users(id,email,raw_user_meta_data) values ('00000000-0000-4000-8000-0000000000f2','new2@x.co','{"requested_role":"admin"}')`)
p = (await db.query(`select role, requested_role from profiles where id='00000000-0000-4000-8000-0000000000f2'`)).rows[0]
ok(p && p.role === 'citizen' && p.requested_role === null, 'a request for admin is ignored entirely')
let err
try { await db.exec(`update profiles set requested_role='admin' where id='00000000-0000-4000-8000-0000000000f2'`) } catch (e) { err = e }
ok(!!err, 'requested_role cannot hold admin (check constraint)')
try { await db.exec(`insert into auth.users(id,email) values ('00000000-0000-4000-8000-0000000000f3','c1@x.co')`); err = null } catch (e) { err = e }
ok(!err, 'a duplicate email does not break sign-up (ON CONFLICT DO NOTHING)')

console.log('\nService role (server-side admin tooling) can still manage roles')
await db.exec(`reset role; set role service_role`)
r = await attempt(`update profiles set role='responder' where id='${ids.citizen2}'`)
ok(!r.error && r.affected === 1, 'service_role can set a role')
await db.exec(`reset role; update profiles set role='citizen' where id='${ids.citizen2}'`)

// ------------------------------------------------------------------------------------------------------------
console.log('\nMigration 012: flood simulator tables')
const m12 = readFileSync(R + 'supabase/migrations/012_flood_simulator.sql', 'utf8')
await db.exec('reset role')
await db.exec(m12)
await db.exec(m12)
ok(true, 'migration 012 applies cleanly and twice')
await db.exec(`grant all on all tables in schema public to anon, authenticated, service_role;`)

const scen = (who, name = 'S') => `insert into flood_scenarios(name, scenario_kind, area, inputs, results, created_by, created_by_name) values ('${name}','hypothetical_overlay','{"type":"Polygon","coordinates":[[[67,24.8],[67.01,24.8],[67.01,24.81],[67,24.8]]]}','{}','{}', ${ids[who] ? `'${ids[who]}'` : 'null'}, 'T') returning id`
await as('anon')
r = await attempt(scen('anon'))
ok(!!r.error, 'anonymous cannot create a scenario')
r = await attempt('select * from flood_scenarios')
ok(!r.error && r.rows.length === 0, 'anonymous reads no scenarios')
await as('authenticated', 'citizen')
r = await attempt(scen('citizen'))
ok(!!r.error, 'citizen cannot create a scenario')
await as('authenticated', 'responder')
r = await attempt(scen('responder', 'R1 scenario'))
ok(!r.error && r.rows.length === 1, 'responder can create a scenario')
const sid = r.rows[0]?.id
r = await attempt(scen('responder2', 'spoof'))
ok(!!r.error, 'responder cannot create a scenario in someone else\'s name')
await as('authenticated', 'responder2')
r = await attempt('select id from flood_scenarios')
ok(!r.error && r.rows.length === 1, 'other responders can read shared scenarios')
r = await attempt(`update flood_scenarios set name='hijacked' where id='${sid}'`)
ok(!r.error && r.affected === 0, 'another responder cannot edit it')
r = await attempt(`delete from flood_scenarios where id='${sid}'`)
ok(!r.error && r.affected === 0, 'another responder cannot delete it')
await as('authenticated', 'responder')
r = await attempt(`update flood_scenarios set results='{"x":1}' where id='${sid}'`)
ok(!r.error && r.affected === 1, 'the owner can update it')
await as('authenticated', 'citizen')
r = await attempt('select id from flood_scenarios')
ok(!r.error && r.rows.length === 0, 'citizens cannot read scenarios')
await as('authenticated', 'admin')
r = await attempt(`delete from flood_scenarios where id='${sid}'`)
ok(!r.error && r.affected === 1, 'admin can delete any scenario')

// Separation from real incidents: no table, column or foreign key links scenarios to reports/dispatches.
await db.exec('reset role')
const links = (await db.query(`
  select conrelid::regclass::text as t, confrelid::regclass::text as ref from pg_constraint
  where contype='f' and (conrelid::regclass::text like 'flood_%' or confrelid::regclass::text like 'flood_%')`)).rows
ok(!links.some((l) => /emergency_reports|dispatches|report_events|rescue_teams|shelters/.test(l.t + ' ' + l.ref)), 'no foreign key joins flood tables to incident, dispatch, team or shelter tables: ' + JSON.stringify(links.map((l) => l.t + '->' + l.ref)))
r = await attempt(`insert into flood_scenarios(name, scenario_kind, is_simulation, area, inputs, results) values ('x','hypothetical_overlay',false,'{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]}','{}','{}')`)
ok(!!r.error, 'a scenario can never be stored with is_simulation = false')
const trig = (await db.query(`select count(*)::int c from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relname in ('emergency_reports','dispatches') and not tgisinternal and tgname like '%flood%'`)).rows[0].c
ok(trig === 0, 'no flood trigger is attached to incident or dispatch tables')

// Observations
await as('authenticated', 'responder')
r = await attempt(`insert into flood_observations(lat,lng,depth_m,observed_at,source,recorded_by) values (24.86,67.0,0.4,now(),'Field team','${ids.responder}') returning id`)
ok(!r.error, 'responder can record a flood observation')
const oid = r.rows[0]?.id
r = await attempt(`insert into flood_observations(lat,lng,depth_m,observed_at,source,recorded_by) values (95,67.0,0.4,now(),'bad','${ids.responder}')`)
ok(!!r.error, 'an observation with an invalid latitude is rejected by the database')
r = await attempt(`insert into flood_observations(lat,lng,depth_m,observed_at,source,recorded_by) values (24.86,67.0,-1,now(),'bad','${ids.responder}')`)
ok(!!r.error, 'a negative observed depth is rejected')
r = await attempt(`update flood_observations set verified=true where id='${oid}'`)
ok(!r.error && r.affected === 0, 'a responder cannot mark their own observation verified')
await as('authenticated', 'admin')
r = await attempt(`update flood_observations set verified=true where id='${oid}'`)
ok(!r.error && r.affected === 1, 'an admin can verify an observation')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
