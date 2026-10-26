// Applies supabase/migrations/007_support_requests.sql to an in-memory Postgres (PGlite) with Supabase-style
// roles and auth.uid(), then checks the RLS policies, grants, rate limits and triggers. Run: npm run test:rls
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
const db = new PGlite()
import { fileURLToPath } from 'node:url'
const R = fileURLToPath(new URL('../', import.meta.url))
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : (fail++, console.log('FAIL', m)); }
await db.exec(`
 create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
 create schema auth;
 create table auth.users (id uuid primary key default gen_random_uuid(), email text);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
 create type user_role as enum ('citizen','responder','admin');
 create table public.profiles (id uuid primary key, email text unique not null, full_name text, role user_role default 'citizen', updated_at timestamptz default now());
 create function update_updated_at_column() returns trigger as $$ begin new.updated_at = now(); return new; end; $$ language plpgsql;
 create function public.current_user_role() returns text language sql stable security definer set search_path = public as $$ select role::text from public.profiles where id = auth.uid() $$;
 grant usage on schema public, auth to anon, authenticated, service_role;
 grant all on all tables in schema public to anon, authenticated, service_role;
 grant execute on all functions in schema public to anon, authenticated;
 grant execute on function auth.uid() to anon, authenticated;
`)
const A='00000000-0000-4000-8000-00000000000a', B='00000000-0000-4000-8000-00000000000b', ADM='00000000-0000-4000-8000-0000000000ad'
await db.exec(`insert into auth.users(id,email) values ('${A}','a@x.co'),('${B}','b@x.co'),('${ADM}','adm@x.co');
 insert into profiles(id,email,role) values ('${A}','a@x.co','citizen'),('${B}','b@x.co','citizen'),('${ADM}','adm@x.co','admin');`)
const sql = readFileSync(R + 'supabase/migrations/007_support_requests.sql', 'utf8')
await db.exec(sql); await db.exec(sql) // idempotent: run twice
ok(true, 'migration ran twice')

const as = async (role, uid) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub','${uid ?? ''}',false); set role ${role};`) }
const submit = (who, subj, extra = {}) => db.query(`select public.submit_support_request($1,$2,$3,$4,$5,$6,$7) as r`, ['Test Person', extra.email ?? null, subj, extra.cat ?? 'general', extra.msg ?? ('Message body for ' + subj), extra.ref ?? null, extra.key ?? 'k1'])
const clearGap = async () => { await db.exec(`reset role; update support_rate_events set created_at = now() - interval '2 minutes'`) }

// anon can submit
await as('anon'); let r = await submit('anon', 'First request'); const refAnon = r.rows[0].r.reference
ok(/^SUP-[A-HJ-NP-Z2-9]{8}$/.test(refAnon), 'reference format ' + refAnon)
// duplicate returns same ref
r = await submit('anon', 'First request'); ok(r.rows[0].r.duplicate === true && r.rows[0].r.reference === refAnon, 'duplicate detection')
// min gap: different message immediately -> 429
let err; try { await submit('anon', 'Second request') } catch (e) { err = e }
ok(err && /rate_limited/.test(err.message), 'burst gap blocked: ' + err?.message)
// anon cannot read or write directly
for (const q of ['select * from support_requests', `insert into support_requests(reference,name,subject,category,message,sender_key,content_hash) values ('SUP-AAAAAAAA','Nm','Subj','general','0123456789','x','y')`, 'update support_requests set status=\'resolved\'', 'delete from support_requests', 'select * from support_rate_events']) {
  err = null; try { await db.query(q) } catch (e) { err = e }
  ok(err && /permission denied/.test(err.message), 'anon denied: ' + q.slice(0, 40) + ' -> ' + err?.message)
}
// fields are validated by constraints
await clearGap(); await as('anon')
for (const [label, args] of [['short message', { msg: 'short' }], ['bad category', { cat: 'billing' }], ['bad email', { email: 'nope' }], ['bad ref', { ref: 'x y!' }]]) {
  err = null; try { await submit('anon', 'Valid subject ' + label, args) } catch (e) { err = e }
  ok(err && /violates check constraint/.test(err.message), 'rejects ' + label + ': ' + err?.message)
}
// signed in users: own rows only
await as('authenticated', A); r = await submit('A', 'From user A', { key: 'zzz' }); const refA = r.rows[0].r.reference
await clearGap(); await as('authenticated', B); r = await submit('B', 'From user B'); const refB = r.rows[0].r.reference
let rows = (await db.query('select reference, user_id from support_requests')).rows
ok(rows.length === 1 && rows[0].reference === refB && rows[0].user_id === B, 'B sees only own: ' + JSON.stringify(rows))
await as('authenticated', A); rows = (await db.query('select reference from support_requests')).rows
ok(rows.length === 1 && rows[0].reference === refA, 'A sees only own')
// citizens cannot update (even own), cannot delete, cannot insert
for (const q of [`update support_requests set status='resolved'`, `update support_requests set category='privacy'`, 'delete from support_requests']) {
  err = null; let res; try { res = await db.query(q) } catch (e) { err = e }
  ok(err || res.affectedRows === 0, 'citizen blocked: ' + q + ' -> ' + (err?.message ?? 'rows=' + res.affectedRows))
}
err = null; try { await db.query(`insert into support_requests(reference,name,subject,category,message,sender_key,content_hash,user_id) values ('SUP-BBBBBBBB','Nm','Subj','general','0123456789','x','y','${A}')`) } catch (e) { err = e }
ok(err && /permission denied/.test(err.message), 'citizen cannot insert directly')
// profiles role does not matter for anon claims; admin sees all and can update status/category only
await as('authenticated', ADM); rows = (await db.query('select reference from support_requests')).rows
ok(rows.length === 3, 'admin sees all 3, got ' + rows.length)
let u = await db.query(`update support_requests set status='in_progress', category='privacy' where reference='${refA}'`)
ok(u.affectedRows === 1, 'admin updates status and category')
const after = (await db.query(`select status, category, updated_at > created_at as touched from support_requests where reference='${refA}'`)).rows[0]
ok(after.status === 'in_progress' && after.category === 'privacy', 'update applied')
for (const col of ["message='edited message here'", "name='Other'", "email='e@x.co'", "subject='Edited'"]) {
  err = null; try { await db.query(`update support_requests set ${col} where reference='${refA}'`) } catch (e) { err = e }
  ok(err && /permission denied/.test(err.message), 'admin cannot edit ' + col + ': ' + err?.message)
}
err = null; try { await db.query(`update support_requests set status='archived' where reference='${refA}'`) } catch (e) { err = e }
ok(err && /check constraint/.test(err.message), 'status constrained')
// trigger guards even a role that does hold column privileges (service_role / owner)
await db.exec('reset role'); err = null; try { await db.query(`update support_requests set message='tampered message' where reference='${refA}'`) } catch (e) { err = e }
ok(err && /Only the status and category/.test(err.message), 'guard trigger blocks message edits for everyone: ' + err?.message)
// owner (A) now sees the new status
await as('authenticated', A); rows = (await db.query('select status from support_requests')).rows
ok(rows[0].status === 'in_progress', 'owner sees staff status change')
// per-account hourly limit (uid cannot be forged)
await db.exec('reset role'); await db.exec(`delete from support_rate_events`)
await as('authenticated', ADM)
for (let i = 0; i < 5; i++) { await clearGap(); await as('authenticated', ADM); await submit('adm', 'Admin msg ' + i) }
await clearGap(); await as('authenticated', ADM); err = null; try { await submit('adm', 'Admin msg 6') } catch (e) { err = e }
ok(err && /rate_limited/.test(err.message) && err.code === 'PT429', 'hourly cap per account, code ' + err?.code)
// rate events untouched by clients
await as('authenticated', A); err = null; try { await db.query('select * from support_rate_events') } catch (e) { err = e }
ok(err && /permission denied/.test(err.message), 'rate table hidden')
// EXPLAIN uses indexes? (just list them)
await db.exec('reset role'); const idx = (await db.query(`select indexname from pg_indexes where tablename in ('support_requests','support_rate_events') order by 1`)).rows.map(x => x.indexname)
console.log(idx.join(', '))
console.log(`\n${pass} passed, ${fail} failed`)
