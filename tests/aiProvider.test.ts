import test from 'node:test'
import assert from 'node:assert/strict'
import { aiProvider, callStructured, callText } from '../src/lib/ai/provider'
import { analyzeImage, photoModelConfigured } from '../src/lib/photoAnalysis/model'
import { createAnthropicClient } from '../src/lib/alerts/ai'

test('provider selection', () => {
  assert.equal(aiProvider({}), null)
  assert.equal(aiProvider({ GEMINI_API_KEY: 'g' }), 'gemini')
  assert.equal(aiProvider({ OPENAI_API_KEY: 'o' }), 'openai')
  assert.equal(aiProvider({ GEMINI_API_KEY: 'g', OPENAI_API_KEY: 'o', AI_PROVIDER: 'openai' }), 'openai')
  assert.equal(aiProvider({ GEMINI_API_KEY: 'g', AI_PROVIDER: 'openai' }), null)
  assert.equal(photoModelConfigured({ GEMINI_API_KEY: 'g' } as never), true)
})

test('gemini structured call shape', async () => {
  let url = '', body: any, headers: any
  const out = await callStructured({
    provider: 'gemini', env: { GEMINI_API_KEY: 'k' }, model: 'm', system: 's', userText: 'u', schema: { type: 'object' },
    toolName: 't', toolDescription: 'd', maxTokens: 10, image: { mime: 'image/png', base64: 'AAA' },
    fetchImpl: (async (u: string, init: RequestInit) => { url = u; body = JSON.parse(init.body as string); headers = init.headers
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"a":1}' }] } }] })) }) as never,
  })
  assert.deepEqual(out, { a: 1 })
  assert.match(url, /models\/m:generateContent$/)
  assert.equal(headers['x-goog-api-key'], 'k')
  assert.equal(body.contents[0].parts[1].inlineData.data, 'AAA')
})

test('openai structured + text call shape', async () => {
  let body: any
  const out = await callStructured({
    provider: 'openai', env: { OPENAI_API_KEY: 'k' }, model: 'm', system: 's', userText: 'u', schema: { type: 'object' },
    toolName: 't', toolDescription: 'd', maxTokens: 10,
    fetchImpl: (async (_u: string, init: RequestInit) => { body = JSON.parse(init.body as string)
      return new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { arguments: '{"b":2}' } }] } }] })) }) as never,
  })
  assert.deepEqual(out, { b: 2 })
  assert.equal(body.tool_choice.function.name, 't')
  const txt = await callText({ provider: 'openai', env: { OPENAI_API_KEY: 'k' }, model: 'm', system: 's', user: 'u', maxTokens: 5, timeoutMs: 1000,
    fetchImpl: (async () => new Response(JSON.stringify({ choices: [{ message: { content: 'hi' } }] }))) as never })
  assert.equal(txt, 'hi')
})

test('photo analysis via gemini reports HTTP failure cleanly', async () => {
  const r = await analyzeImage(new Uint8Array([1]), 'image/png', { env: { GEMINI_API_KEY: 'k' } as never, fetchImpl: (async () => new Response('x', { status: 429 })) as never })
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.state, 'unavailable')
})

test('alert client picks gemini', () => {
  const c = createAnthropicClient({ GEMINI_API_KEY: 'k' })
  assert.ok(c)
  assert.equal(c!.model, 'gemini-2.5-flash')
})
