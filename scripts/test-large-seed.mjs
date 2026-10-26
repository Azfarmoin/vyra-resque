// Loads the REAL schema + migrations into in-memory Postgres (PGlite), runs supabase/seed/vyra_large_seed.sql twice
// (proves re-running is safe) and checks counts, relationships and that the old small seed is gone. Run: npm run test:seed:large
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const R = fileURLToPath(new URL('../', import.meta.url))
const db = new PGlite({ extensions: { pgcrypto } })
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ', m) } else { fail++; console.log('  FAIL', m) } }
await db.exec(`
 create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
 create schema auth; create schema extensions;
 create table auth.users (instance_id uuid, id uuid primary key default gen_random_uuid(), aud text, role text, email text, encrypted_password text,
   email_confirmed_at timestamptz, raw_app_meta_data jsonb, raw_user_meta_data jsonb default '{}'::jsonb, created_at timestamptz, updated_at timestamptz,
   confirmation_token text, recovery_token text, email_change_token_new text, email_change text);
 create table auth.identities (id uuid primary key, user_id uuid references auth.users(id) on delete cascade, provider_id text, identity_data jsonb, provider text, last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
 create function public.uuid_generate_v4() returns uuid language sql as $$ select gen_random_uuid() $$;
 create extension if not exists pgcrypto;
`)
const schema = readFileSync(R + 'supabase/vyra_complete_schema.sql', 'utf8').replace(/CREATE EXTENSION IF NOT EXISTS "uuid-ossp";/g, '')
await db.exec(schema.replace(/ALTER TYPE report_status ADD VALUE IF NOT EXISTS 'cancelled';/, ''))
const mig = readdirSync(R + 'supabase/migrations').filter((f) => /^(001|006|007|008|009|01[0-8])_/.test(f)).sort()
for (const f of mig) { try { await db.exec(readFileSync(R + 'supabase/migrations/' + f, 'utf8')) } catch (e) { console.log('  note migration', f, 'skipped in PGlite:', e.message.slice(0, 80)) } }
await db.exec(`grant usage on schema public, auth to anon, authenticated, service_role; grant all on all tables in schema public to anon, authenticated, service_role;`)

// An old-style seed row that must disappear
await db.exec(`insert into shelters(id,name,address,area,location_lat,location_lng,capacity,current_occupancy,status,verified)
  values ('30000000-0000-4000-8000-000000000001','Community Hall Gulshan','x','Gulshan-e-Iqbal',24.9,67.1,10,0,'open',true)`)
const sql = readFileSync(R + 'supabase/seed/vyra_large_seed.sql', 'utf8').replace(/CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;/, '')
const q = async (s) => (await db.query(s)).rows
for (let run = 1; run <= 2; run++) {
  const t = Date.now(); await db.exec(sql); console.log(`  run ${run}: ${Date.now() - t} ms`)
  const c = async (s) => Number((await q(s))[0].n)
  ok(await c("select count(*) n from emergency_reports where client_id like 'seed-large-%'") === 6000, `run ${run}: 6000 reports`)
  ok(await c("select count(*) n from rescue_teams") === 520, `run ${run}: 520 teams`)
  ok(await c("select count(*) n from shelters") === 350, `run ${run}: 350 shelters (old seed row removed)`)
  ok(await c("select count(*) n from route_hazards") === 600 && await c("select count(*) n from blocked_roads") === 450, `run ${run}: hazards + roads`)
  ok(await c("select count(*) n from dispatches") === 4816 && await c("select count(*) n from dispatch_resources") === 4502, `run ${run}: missions + allocations`)
  ok(await c("select count(*) n from report_events") === 25373, `run ${run}: events`)
  ok(await c("select count(*) n from profiles where email like '%@seed.vyra'") === 685, `run ${run}: 685 profiles`)
  ok(await c("select count(*) n from auth.users u join auth.identities i on i.user_id=u.id where u.email like '%@seed.vyra'") === 685, `run ${run}: identities`)
  ok(await c("select count(*) n from profiles where role='admin' and email like '%@seed.vyra'") === 5 && await c("select count(*) n from profiles where role='responder' and email like '%@seed.vyra'") === 80, `run ${run}: roles 5 admin / 80 responder`)
  ok(await c("select count(*) n from auth.users where email like '%@seed.vyra' and encrypted_password = crypt('VYRA-demo-1', encrypted_password)") === 685, `run ${run}: password verifies`)
}
const st = await q("select status::text s, count(*)::int n from emergency_reports group by 1 order by 2 desc")
console.log('  status mix', JSON.stringify(st))
ok((await q("select count(*)::int n from emergency_reports where created_at > now()")) [0].n === 0, 'no future timestamps')
console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
