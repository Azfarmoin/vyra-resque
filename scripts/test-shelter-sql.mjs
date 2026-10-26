// Applies migrations 011, 018 + 017 to an in-memory Postgres (PGlite) with Supabase-style roles and auth.uid()/auth.role(), then checks
// role-escalation protection, RLS, and the reservation functions (capacity, double-booking, idempotency, arrival, cancel, reconcile).
// Run: npm install && npm run test:shelters-sql
//
// STATUS: written alongside the migrations but NOT RUN in the environment that produced this delivery (no network, so PGlite could not be
// installed there). Run it before relying on the SQL. Limits when you do: PGlite is single-connection, so the "simultaneous"
// checks run back to back; they prove the capacity arithmetic and constraints, not true parallel locking. For that, run the same
// calls from two psql sessions against a real Postgres.
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const R = fileURLToPath(new URL('../', import.meta.url))
const db = new PGlite()
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : (fail++, console.log('FAIL', m)) }
const U = { cit: '00000000-0000-4000-8000-00000000000c', resp: '00000000-0000-4000-8000-0000000000e1', adm: '00000000-0000-4000-8000-0000000000ad', newbie: '00000000-0000-4000-8000-0000000000f1' }
const S = { open: '10000000-0000-4000-8000-000000000001', closed: '10000000-0000-4000-8000-000000000002', unver: '10000000-0000-4000-8000-000000000003', wc: '10000000-0000-4000-8000-000000000004' }

await db.exec(`
 create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; create role authenticator login;
 grant anon, authenticated, service_role to authenticator;
 create schema auth;
 create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}'::jsonb);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
 create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
 create function uuid_generate_v4() returns uuid language sql as $$ select gen_random_uuid() $$;
 create type user_role as enum ('citizen','responder','admin');
 create type shelter_status as enum ('open','full','closed');
 create table public.profiles (id uuid primary key, email text unique not null, full_name text, role user_role default 'citizen', updated_at timestamptz default now());
 create function public.current_user_role() returns text language sql stable security definer set search_path = public as $$ select role::text from public.profiles where id = auth.uid() $$;
 create table public.shelters (id uuid primary key default gen_random_uuid(), name text not null, location_lat double precision, location_lng double precision, address text, area text, capacity int, current_occupancy int default 0, services text[], status shelter_status default 'open', verified boolean default false, contact_number text, created_at timestamptz default now(), updated_at timestamptz default now());
 create table public.emergency_reports (id uuid primary key default gen_random_uuid());
 create table public.dispatches (id uuid primary key default gen_random_uuid());
 grant usage on schema public, auth to anon, authenticated, service_role;
 alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
 alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
 grant all on all tables in schema public to anon, authenticated, service_role;
 grant execute on all functions in schema public to anon, authenticated;
 grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;
`)
await db.exec(`insert into public.profiles(id,email,role) values ('${U.cit}','c@x.co','citizen'),('${U.resp}','r@x.co','responder'),('${U.adm}','a@x.co','admin');
 insert into public.shelters(id,name,capacity,current_occupancy,status,verified,location_lat,location_lng) values
  ('${S.open}','Open',100,40,'open',true,24.9,67.0),('${S.closed}','Closed',100,0,'closed',true,24.9,67.0),('${S.unver}','Unverified',100,0,'open',false,24.9,67.0),('${S.wc}','Wheelchair',100,0,'open',true,24.9,67.0)`)
for (const f of ['011_profiles_role_hardening', '018_profiles_self_demotion_guard', '017_shelter_assistant']) { const sql = readFileSync(`${R}supabase/migrations/${f}.sql`, 'utf8'); await db.exec(sql); await db.exec(sql) }
ok(true, 'all three migrations ran twice (idempotent)')

// As a real API caller: PostgREST switches to the anon / authenticated role per request; the guards in 011/018 test current_user for that.
const as = async (role, uid) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub','${uid ?? ''}',false), set_config('request.jwt.claim.role','${role}',false); set role ${role}`) }
const admin = async () => { await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false), set_config('request.jwt.claim.role','postgres',false)`) }
const fails = async (q, re, m, args = []) => { let e; try { await db.query(q, args) } catch (x) { e = x } ok(e && re.test(e.message), `${m}: ${e?.message ?? 'did not fail'}`) }
const one = async (q, args = []) => (await db.query(q, args)).rows[0]
const reserve = (shelter, label, party, key, needs = {}) => db.query('select public.shelter_reserve($1,$2,null,null,$3,$4::jsonb,null,60,$5) as r', [shelter, label, party, JSON.stringify({ partySize: party, ...needs }), key])

// ---- 011: role escalation -------------------------------------------------------------------------------------------------------
await as('authenticated', U.cit)
await fails(`update public.profiles set role='admin' where id='${U.cit}'`, /Only an administrator can change a role/, 'citizen cannot make themselves admin')
await fails(`update public.profiles set role='responder' where id='${U.cit}'`, /Only an administrator/, 'citizen cannot make themselves responder')
await fails(`insert into public.profiles(id,email,role) values ('${U.newbie}','n@x.co','admin')`, /row-level security|Only an administrator/, 'cannot insert an admin profile')
ok((await db.query('select id from public.profiles')).rows.length === 1, 'citizen sees only their own profile')
await as('anon'); ok((await db.query('select id from public.profiles').catch(() => ({ rows: [] }))).rows.length === 0, 'anonymous sees no profiles')
await as('authenticated', U.resp); ok((await db.query('select id from public.profiles')).rows.length === 3, 'staff can read profiles')
await fails(`update public.profiles set role='admin' where id='${U.resp}'`, /Only an administrator/, 'responder cannot self-promote')
await as('authenticated', U.adm)
await db.query(`update public.profiles set role='responder' where id='${U.cit}'`); ok((await one(`select role from public.profiles where id='${U.cit}'`)).role === 'responder', 'admin can change a role')
await db.query(`update public.profiles set role='citizen' where id='${U.cit}'`)
await fails(`update public.profiles set role='citizen' where id='${U.adm}'`, /cannot remove your own administrator role/, 'admin cannot demote self')
await admin()
await db.query(`insert into auth.users(id,email,raw_user_meta_data) values ('${U.newbie}','n@x.co','{"requested_role":"admin","full_name":"N"}')`)
let p = await one(`select role, requested_role from public.profiles where id='${U.newbie}'`); ok(p.role === 'citizen' && p.requested_role === null, 'sign-up trigger: requested admin is ignored: ' + JSON.stringify(p))
await db.query(`insert into auth.users(id,email,raw_user_meta_data) values ('20000000-0000-4000-8000-000000000001','n2@x.co','{"requested_role":"responder"}')`)
p = await one(`select role, requested_role from public.profiles where id='20000000-0000-4000-8000-000000000001'`); ok(p.role === 'citizen' && p.requested_role === 'responder', 'sign-up: responder is only a request')

// ---- 012: shelters RLS ----------------------------------------------------------------------------------------------------------
await as('anon'); ok((await db.query('select id from public.shelters')).rows.length === 3, 'anonymous sees verified shelters only')
{ const w = await db.query(`update public.shelters set capacity=1`).catch((e) => ({ affectedRows: 0, denied: e.message })); ok(w.affectedRows === 0, 'anonymous cannot write shelters (no policy: no row is changed)') }
await as('authenticated', U.resp); ok((await db.query('select id from public.shelters')).rows.length === 4, 'staff see all shelters')
const upd = await db.query(`update public.shelters set capacity=5 where id='${S.open}'`); ok(upd.affectedRows === 0, 'responder cannot edit the registry directly')
await fails(`insert into public.shelter_reservations(shelter_id,group_key,group_label,party_size,hold_expires_at) values ('${S.open}','k','kk',1,now())`, /permission denied|row-level/, 'ledger is not directly writable')

// ---- 012: reservations ----------------------------------------------------------------------------------------------------------
await as('authenticated', U.cit); await fails(`select public.shelter_reserve('${S.open}','Citizen group',null,null,3,'{"partySize":3}'::jsonb,null,60,'citizen-key-1')`, /forbidden/, 'citizen cannot reserve')
await as('authenticated', U.resp)
let r = (await reserve(S.open, 'Group A', 10, 'key-group-a-1')).rows[0].r; ok(r.replayed === false && r.reservation.status === 'reserved', 'reserve works')
const again = (await reserve(S.open, 'Group A', 10, 'key-group-a-1')).rows[0].r; ok(again.replayed === true && again.reservation.id === r.reservation.id, 'idempotent replay')
await fails(`select public.shelter_reserve('${S.open}','Group A',null,null,10,'{}'::jsonb,null,60,'key-group-a-2')`, /double_booking/, 'same group cannot be booked twice')
let okCount = 0, capFail = 0
for (let i = 0; i < 12; i++) { try { await reserve(S.open, 'Burst ' + i, 10, 'burst-key-' + i); okCount++ } catch (e) { if (/insufficient_capacity/.test(e.message)) capFail++ } }
ok(okCount === 5 && capFail === 7, `capacity 100, 40 inside, 10 held -> exactly 5 more groups of 10 fit (got ${okCount}, refused ${capFail})`)
const sh = await one(`select current_occupancy, reserved_capacity from public.shelters where id='${S.open}'`); ok(sh.current_occupancy + sh.reserved_capacity === 100, 'occupied + held == capacity, never above')
await fails(`select public.shelter_reserve('${S.closed}','C',null,null,3,'{}'::jsonb,null,60,'closed-key-1')`, /shelter_closed/, 'closed shelter refused')
await fails(`select public.shelter_reserve('${S.wc}','W',null,null,3,'{"partySize":3,"wheelchairUsers":1}'::jsonb,null,60,'wc-key-001')`, /requirements_unmet/, 'undocumented wheelchair access refused')
const arr = (await db.query('select public.shelter_confirm_arrival($1,null) as r', [r.reservation.id])).rows[0].r; ok(arr.status === 'arrived' && arr.arrived_count === 10, 'arrival confirmed')
await fails(`select public.shelter_confirm_arrival('${r.reservation.id}',null)`, /already_arrived/, 'arrival cannot be confirmed twice')
const dep = (await db.query('select public.shelter_record_departure($1) as r', [r.reservation.id])).rows[0].r; ok(dep.status === 'departed', 'departure recorded')
const burst = await one(`select id from public.shelter_reservations where group_label='Burst 0'`)
await db.query(`select public.shelter_cancel_reservation($1,'plans changed')`, [burst.id]); ok((await one(`select reserved_capacity from public.shelters where id='${S.open}'`)).reserved_capacity === 40, 'cancel releases held places (5 bursts held 50 after Group A arrived; one cancelled)')
await fails(`select public.shelter_reconcile(null)`, /forbidden/, 'responder cannot reconcile')
ok((await db.query('select 1 from public.shelter_audit')).rows.length === 0, 'responder reads no audit rows (admin only)')
await as('authenticated', U.adm)
await db.query(`update public.shelters set reserved_capacity = 99 where id='${S.open}'`)
const rec = (await db.query('select public.shelter_reconcile($1) as r', [S.open])).rows[0].r; ok(rec.some((x) => x.check === 'reserved_capacity' && x.fixed), 'reconcile repairs drift')
ok((await db.query('select 1 from public.shelter_audit')).rows.length > 0, 'admin can read the audit trail')
// Through the API an update changes no row (no write policy exists); even a trusted server session that bypasses RLS is stopped by the trigger.
{ const w = await db.query(`update public.shelter_audit set action='x'`).catch(() => ({ affectedRows: 0 })); ok(w.affectedRows === 0, 'audit cannot be edited through the API') }
await admin()
await fails(`update public.shelter_audit set action='x'`, /append-only/, 'audit is append-only even for the server role')
await fails(`delete from public.shelter_audit`, /append-only/, 'audit rows cannot be deleted even for the server role')
await as('authenticated', U.adm)
const ex = (await db.query(`select public.shelter_create_exception($1,'closed_use',0,'Opened by district officer',now()+interval '2 hours','Amina') as r`, [S.closed])).rows[0].r; ok(!!ex.id, 'admin can authorize an exception')
await as('authenticated', U.resp); r = (await reserve(S.closed, 'Closed group', 3, 'closed-key-2')).rows[0].r; ok(r.reservation.exception_id === ex.id, 'closed shelter reservable only with the recorded exception')
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
