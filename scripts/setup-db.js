// Sets up the VYRA database in your Supabase project by running the SQL files for you.
//
//   npm run db:setup                 tables only
//   npm run db:setup -- --seed       tables + the full demo seed (accounts, admin, 80 cases, teams, supplies, missions...)
//   (add --small to use the older small seed instead of the very large one)
//   npm run db:seed                  seed only (tables already exist): resets the demo data and demo accounts
//
// Needs DATABASE_URL in .env.local (Supabase > Connect > Session pooler). Optional in .env.local:
//   SEED_PASSWORD=...   password for ALL seeded accounts (default: VYRA-demo-1) - set your own for any shared project
const fs = require('fs')
const path = require('path')
const { Client } = require('pg')

const root = path.join(__dirname, '..')
// Default: the very large simulated dataset. `--small` uses the older small seed instead.
const SEED_FILE = process.argv.includes('--small') ? 'supabase/seed/vyra_full_seed.sql' : 'supabase/seed/vyra_large_seed.sql'

function readEnv() {
  const file = path.join(root, '.env.local')
  if (!fs.existsSync(file)) return {}
  const env = {}
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return env
}

// Puts SEED_PASSWORD into the seed's "seed_password" line (the SQL file runs as-is without this).
function withPassword(sql, password) {
  if (!password) return sql
  if (password.length < 6) throw new Error('SEED_PASSWORD must be at least 6 characters.')
  if (password.includes('$$')) throw new Error('SEED_PASSWORD must not contain "$$".')
  const safe = password.replace(/'/g, "''")
  const out = sql.replace(/(seed_password TEXT := )'[^']*'/, (_m, head) => `${head}'${safe}'`)
  if (out === sql && !sql.includes(`'${safe}'`)) throw new Error('Could not find the seed_password line in the seed file.')
  return out
}

async function main() {
  const env = readEnv()
  const url = process.env.DATABASE_URL || env.DATABASE_URL
  if (!url || url.includes('[YOUR-PASSWORD]') || url.includes('YOUR-PASSWORD')) {
    console.error('DATABASE_URL is missing or still contains YOUR-PASSWORD.')
    console.error('Add it to .env.local - see SETUP_GUIDE.md (Supabase > Connect > Session pooler).')
    process.exit(1)
  }

  const seedOnly = process.argv.includes('--seed-only')
  const seed = seedOnly || process.argv.includes('--seed')
  const files = seedOnly ? [] : [
    'supabase/vyra_complete_schema.sql',
    'supabase/migrations/001_stage7_8_dispatch_offline.sql',
    'supabase/migrations/006_route_analysis.sql',
    'supabase/migrations/007_support_requests.sql',
    'supabase/migrations/008_early_warning.sql',
    'supabase/migrations/009_offline_first.sql',
    'supabase/migrations/010_disaster_zones.sql',
    'supabase/migrations/011_profiles_role_hardening.sql',
    'supabase/migrations/012_flood_simulator.sql',
    'supabase/migrations/013_photo_analysis.sql',
    'supabase/migrations/014_satellite_analysis.sql',
    'supabase/migrations/015_safety_content.sql',
    'supabase/migrations/016_multichannel_delivery.sql',
    'supabase/migrations/017_shelter_assistant.sql',
    'supabase/migrations/018_profiles_self_demotion_guard.sql',
  ]
  if (seed) files.push(SEED_FILE)

  const password = process.env.SEED_PASSWORD || env.SEED_PASSWORD
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await client.connect()
  console.log('Connected to the database.')

  let seededSql = ''
  for (const f of files) {
    process.stdout.write(`Running ${f} ... `)
    try {
      let sql = fs.readFileSync(path.join(root, f), 'utf8')
      if (f === SEED_FILE) sql = seededSql = withPassword(sql, password)
      const res = await client.query(sql)
      console.log('done')
      if (f === SEED_FILE) {
        const check = (Array.isArray(res) ? res : [res]).find((r) => r.fields && r.fields.some((x) => x.name === 'item'))
        if (check) console.table(check.rows.map((r) => ({ item: r.item, rows: Number(r.rows) })))
      }
    } catch (err) {
      console.log('FAILED')
      console.error(err.message)
      await client.end()
      process.exit(1)
    }
  }
  await client.end()

  if (seed) {
    const shown = password || (seededSql.match(/seed_password TEXT := '([^']*)'/) || [])[1] || 'VYRA-demo-1'
    console.log('\nSeeded sign-in accounts (all use the same password):')
    for (const m of seededSql.matchAll(/'([^']+@(?:demo|seed)\.vyra)', '([^']+)', '(admin|responder|citizen)'/g)) {
      if (m[3] === 'admin' || /(responder0[1-3]|citizen00[1-3])@/.test(m[1]) || SEED_FILE.includes('full')) console.log(`  ${m[3].padEnd(10)} ${m[1].padEnd(26)} ${m[2]}`)
    }
    if (!SEED_FILE.includes('full')) console.log('  ... plus responder01..80@seed.vyra and citizen001..600@seed.vyra (same password)')
    console.log(`  password: ${shown}`)
    console.log('Change or delete these accounts before sharing the project publicly (see SETUP_GUIDE.md).')
  }
  console.log('\nAll done. Start the app with: npm run dev')
}

main().catch((err) => {
  console.error('Could not connect:', err.message)
  process.exit(1)
})
