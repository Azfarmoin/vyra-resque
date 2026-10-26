// Administrator account management against the in-memory demo database.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { setStore } from '../src/lib/db'
import { createMemoryStore } from '../src/lib/db/memoryStore'
import * as users from '../src/app/api/admin/users/route'
import * as demoAuth from '../src/app/api/demo/auth/route'

beforeEach(() => setStore(createMemoryStore()))

const req = (method: string, body?: unknown, as?: string) =>
  new NextRequest('http://localhost/api/admin/users', {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: { 'content-type': 'application/json', ...(as ? { 'x-demo-admin': as } : {}) },
  })
const json = (r: Response) => r.json()
const person = { full_name: 'Test Responder', email: 'Test.Responder@Example.com', password: 'abcdef', role: 'responder' }

test('accounts: only administrators can list or create', async () => {
  assert.equal((await users.GET(req('GET'))).status, 401)
  assert.equal((await users.POST(req('POST', person))).status, 401)
  assert.equal((await users.GET(req('GET', undefined, 'citizen@demo.vyra'))).status, 403)
  assert.equal((await users.POST(req('POST', person, 'dispatcher@demo.vyra'))).status, 403)
  assert.equal((await users.POST(req('POST', person, 'nobody@example.com'))).status, 401)
})

test('accounts: an admin creates an account of any role and it can sign in', async () => {
  const made = await users.POST(req('POST', person, 'admin@demo.vyra'))
  assert.equal(made.status, 201)
  const body = await json(made)
  assert.equal(body.user.email, 'test.responder@example.com') // normalised
  assert.equal(body.user.role, 'responder')

  const login = await json(await demoAuth.POST(new NextRequest('http://localhost/api/demo/auth', { method: 'POST', body: JSON.stringify({ email: 'test.responder@example.com', password: 'abcdef' }), headers: { 'content-type': 'application/json' } })))
  assert.equal(login.user.role, 'responder')

  const admin2 = await users.POST(req('POST', { ...person, email: 'second.admin@example.com', role: 'admin' }, 'admin@demo.vyra'))
  assert.equal((await json(admin2)).user.role, 'admin')
  // the new admin can manage accounts too
  assert.equal((await users.GET(req('GET', undefined, 'second.admin@example.com'))).status, 200)

  const list = await json(await users.GET(req('GET', undefined, 'admin@demo.vyra')))
  assert.ok(list.users.some((u: { email: string }) => u.email === 'test.responder@example.com'))
  assert.ok(list.users.every((u: Record<string, unknown>) => !('password' in u)), 'passwords are never listed')
})

test('accounts: validation and duplicates', async () => {
  const as = 'admin@demo.vyra'
  assert.equal((await users.POST(req('POST', { ...person, password: '123' }, as))).status, 400)
  assert.equal((await users.POST(req('POST', { ...person, email: 'not-an-email' }, as))).status, 400)
  assert.equal((await users.POST(req('POST', { ...person, full_name: '  ' }, as))).status, 400)
  assert.equal((await users.POST(req('POST', { ...person, role: 'superuser' }, as))).status, 400)
  assert.equal((await users.POST(req('POST', { ...person, email: 'admin@demo.vyra' }, as))).status, 409)
})
