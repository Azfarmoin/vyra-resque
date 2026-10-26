// Multi-provider AI adapter: Gemini and OpenAI (ChatGPT API) next to the original Anthropic path.
// The Anthropic code in hazardExplanation.ts / photoAnalysis/model.ts / alerts/ai.ts is untouched and still the
// default when only ANTHROPIC_API_KEY is set. This file is only used for 'gemini' and 'openai'.
//
// Pick the provider with AI_PROVIDER=gemini|openai|anthropic. If it is unset, the first key found wins in this order:
// ANTHROPIC_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY.

export type AiProvider = 'anthropic' | 'gemini' | 'openai'
type Env = Record<string, string | undefined>

export function aiProvider(env: Env = process.env): AiProvider | null {
  const want = (env.AI_PROVIDER || '').trim().toLowerCase()
  if (want === 'anthropic' && env.ANTHROPIC_API_KEY) return 'anthropic'
  if (want === 'gemini' && env.GEMINI_API_KEY) return 'gemini'
  if (want === 'openai' && env.OPENAI_API_KEY) return 'openai'
  if (want) return null // asked for a provider whose key is missing: stay "not configured" rather than silently using another
  if (env.ANTHROPIC_API_KEY) return 'anthropic'
  if (env.GEMINI_API_KEY) return 'gemini'
  if (env.OPENAI_API_KEY) return 'openai'
  return null
}

export const DEFAULT_MODELS: Record<Exclude<AiProvider, 'anthropic'>, string> = {
  gemini: 'gemini-2.5-flash',
  openai: 'gpt-4o-mini',
}

/** VYRA_AI_MODEL overrides everything; ALERT_AI_MODEL overrides it for the alert summaries only. */
export function modelFor(provider: Exclude<AiProvider, 'anthropic'>, env: Env = process.env, alerts = false): string {
  return (alerts && env.ALERT_AI_MODEL) || env.VYRA_AI_MODEL || DEFAULT_MODELS[provider]
}

export type StructuredArgs = {
  provider: Exclude<AiProvider, 'anthropic'>
  env?: Env
  fetchImpl?: typeof fetch
  signal?: AbortSignal
  model: string
  system: string
  userText: string
  image?: { mime: string; base64: string }
  schema: Record<string, unknown>
  toolName: string
  toolDescription: string
  maxTokens: number
}

/** Returns the parsed JSON object the model produced, or throws Error('HTTP <status>'). */
export async function callStructured(a: StructuredArgs): Promise<unknown> {
  const env = a.env ?? process.env
  const f = a.fetchImpl ?? fetch
  if (a.provider === 'gemini') {
    const parts: unknown[] = [{ text: a.userText }]
    if (a.image) parts.push({ inlineData: { mimeType: a.image.mime, data: a.image.base64 } })
    const res = await f(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(a.model)}:generateContent`, {
      method: 'POST',
      signal: a.signal,
      cache: 'no-store',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY || '' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: a.system }] },
        contents: [{ role: 'user', parts }],
        generationConfig: { maxOutputTokens: a.maxTokens, responseMimeType: 'application/json', responseJsonSchema: a.schema },
      }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
    const text = (body.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('')
    return JSON.parse(text)
  }
  // OpenAI chat completions with one forced function call (same shape as the Anthropic forced tool call).
  const content: unknown[] = [{ type: 'text', text: a.userText }]
  if (a.image) content.push({ type: 'image_url', image_url: { url: `data:${a.image.mime};base64,${a.image.base64}` } })
  const base = (env.OPENAI_BASE_URL || 'https://api.openai.com').replace(/\/$/, '')
  const res = await f(`${base}/v1/chat/completions`, {
    method: 'POST',
    signal: a.signal,
    cache: 'no-store',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${env.OPENAI_API_KEY || ''}` },
    body: JSON.stringify({
      model: a.model,
      max_completion_tokens: a.maxTokens,
      messages: [{ role: 'system', content: a.system }, { role: 'user', content }],
      tools: [{ type: 'function', function: { name: a.toolName, description: a.toolDescription, parameters: a.schema } }],
      tool_choice: { type: 'function', function: { name: a.toolName } },
    }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const body = (await res.json()) as { choices?: { message?: { tool_calls?: { function?: { arguments?: string } }[] } }[] }
  const args = body.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments
  if (!args) throw new Error('no tool call')
  return JSON.parse(args)
}

/** Plain text completion (alert summaries). Throws Error('HTTP <status>'). */
export async function callText(opts: {
  provider: Exclude<AiProvider, 'anthropic'>
  env?: Env
  fetchImpl?: typeof fetch
  model: string
  system: string
  user: string
  maxTokens: number
  timeoutMs: number
}): Promise<string> {
  const env = opts.env ?? process.env
  const f = opts.fetchImpl ?? fetch
  const signal = AbortSignal.timeout(opts.timeoutMs)
  if (opts.provider === 'gemini') {
    const res = await f(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(opts.model)}:generateContent`, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY || '' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: opts.system }] },
        contents: [{ role: 'user', parts: [{ text: opts.user }] }],
        generationConfig: { maxOutputTokens: opts.maxTokens, temperature: 0 },
      }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
    return (body.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('')
  }
  const base = (env.OPENAI_BASE_URL || 'https://api.openai.com').replace(/\/$/, '')
  const res = await f(`${base}/v1/chat/completions`, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${env.OPENAI_API_KEY || ''}` },
    body: JSON.stringify({
      model: opts.model,
      max_completion_tokens: opts.maxTokens,
      temperature: 0,
      messages: [{ role: 'system', content: opts.system }, { role: 'user', content: opts.user }],
    }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  return body.choices?.[0]?.message?.content ?? ''
}
