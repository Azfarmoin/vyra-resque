// Testing switches: VYRA_DISABLE_RATE_LIMITS and NEXT_PUBLIC_VYRA_OPEN_ACCESS (see src/lib/devFlags.ts).
import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { setStore } from '../src/lib/db'
import { createMemoryStore } from '../src/lib/db/memoryStore'
import { checkRateLimit, resetRateLimits } from '../src/lib/routing/rateLimit'
import { checkRateLimit as supportLimit } from '../src/lib/supportServer'
import { requireResponder } from '../src/lib/routing/auth'
import { requireAdmin } from '../src/lib/adminAuth'
import { resolveCaller } from '../src/lib/serverAuth'
import * as zonesRoute from '../src/app/api/zones/route'
import * as usersRoute from '../src/app/api/admin/users/route'

const saved = { rl: process.env.VYRA_DISABLE_RATE_LIMITS, oa: process.env.NEXT_PUBLIC_VYRA_OPEN_ACCESS }
beforeEach(() => { setStore(createMemoryStore()); resetRateLimits() })
afterEach(() => {
  for (const [k, v] of [['VYRA_DISABLE_RATE_LIMITS', saved.rl], ['NEXT_PUBLIC_VYRA_OPEN_ACCESS', saved.oa]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
})
const req = (path = '/api/x', init: ConstructorParameters<typeof NextRequest>[1] = {}) => new NextRequest(`http://localhost${path}`, init)

test('default: limiter blocks and anonymous callers are refused', async () => {
  delete process.env.VYRA_DISABLE_RATE_LIMITS; delete process.env.NEXT_PUBLIC_VYRA_OPEN_ACCESS
  for (let i = 0; i < 12; i++) assert.equal(checkRateLimit('k').ok, true)
  assert.equal(checkRateLimit('k').ok, false)
  assert.equal((await requireResponder(req())).ok, false)
  assert.equal((await requireAdmin(req())).ok, false)
  assert.deepEqual(await resolveCaller(req()), { kind: 'anonymous' })
})

test('rate limits disabled: nothing is ever limited, including the support form', () => {
  process.env.VYRA_DISABLE_RATE_LIMITS = 'true'
  for (let i = 0; i < 500; i++) assert.equal(checkRateLimit('k').ok, true)
  for (let i = 0; i < 50; i++) assert.equal(supportLimit('s').ok, true)
})

test('open access (demo data): anonymous callers act as the administrator', async () => {
  process.env.NEXT_PUBLIC_VYRA_OPEN_ACCESS = 'true'
  const r = await requireResponder(req()); assert.equal(r.ok, true); if (r.ok) assert.equal(r.user.role, 'admin')
  assert.equal((await requireAdmin(req())).ok, true)
  const c = await resolveCaller(req()); assert.equal(c.kind, 'user'); if (c.kind === 'user') assert.equal(c.role, 'admin')
  const z = await zonesRoute.POST(req('/api/zones', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }))
  assert.notEqual(z.status, 401); assert.notEqual(z.status, 403) // reaches validation instead of being refused
  const u = await usersRoute.GET(req('/api/admin/users'))
  assert.equal(u.status, 200)
})
