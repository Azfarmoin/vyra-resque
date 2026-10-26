#!/usr/bin/env node
// VYRA gateway helper. Runs on a computer WITH an internet connection that is attached to a LoRa receiver (or that
// an operator uses to import a report someone carried in).
//
//   Radio:   stty -F /dev/ttyUSB0 115200 raw -echo
//            node scripts/gateway-bridge.mjs --radio < /dev/ttyUSB0 > /dev/ttyUSB0
//            (reads lines the receiver outputs, forwards short emergency messages to the server, writes the
//             ACK / OPACK lines back so the sender's phone can show a VERIFIED acknowledgement)
//   One message:   node scripts/gateway-bridge.mjs --compact "V1|..."
//   Exported file: node scripts/gateway-bridge.mjs --import vyra-VY-1234ABCD.vyra.json
//
// Settings: --url / VYRA_URL (https://your-vyra.app), --key / GATEWAY_API_KEY, --id / GATEWAY_ID (default "gateway").
// See docs/MULTICHANNEL_DELIVERY.md for the wire protocol.
import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const args = process.argv.slice(2)
const flag = (n) => args.includes(`--${n}`)
const opt = (n, env, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : process.env[env] ?? d }
const URL_BASE = (opt('url', 'VYRA_URL', 'http://localhost:3000') ?? '').replace(/\/$/, '')
const KEY = opt('key', 'GATEWAY_API_KEY', '')
const GW = opt('id', 'GATEWAY_ID', 'gateway')
const log = (...a) => process.stderr.write(`[gateway] ${a.join(' ')}\n`)

async function ingest(raw, channel) {
  const res = await fetch(`${URL_BASE}/api/gateway/ingest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ gateway_id: GW, messages: [{ channel, raw }] }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `server answered ${res.status}`)
  return body.results[0]
}

async function status(reportId) {
  const res = await fetch(`${URL_BASE}/api/reports/${reportId}/public-status`)
  return res.ok ? (await res.json()).report?.status : null
}

if (!KEY) { log('GATEWAY_API_KEY (or --key) is required'); process.exit(2) }

if (args.includes('--compact')) {
  const r = await ingest(opt('compact', '', ''), 'manual')
  console.log(JSON.stringify(r, null, 2))
  process.exit(r.ok ? 0 : 1)
}

if (args.includes('--import')) {
  const file = JSON.parse(readFileSync(opt('import', '', ''), 'utf8'))
  if (file.format !== 'vyra-report/1') { log('not a VYRA export file'); process.exit(2) }
  const post = await fetch(`${URL_BASE}/api/reports`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': file.client_id }, body: JSON.stringify({ ...file.payload, client_id: file.client_id, reporter_id: null, submitted_offline: true, client_created_at: file.queued_at }) })
  const body = await post.json().catch(() => ({}))
  if (!post.ok) { log('rejected:', body.error || post.status, JSON.stringify(body.details ?? '')); process.exit(1) }
  log(`report ${body.report.id} ${body.duplicate ? 'already existed (completed)' : 'created'}`)
  for (const p of file.photos ?? []) {
    const up = await fetch(`${URL_BASE}/api/reports/${body.report.id}/attachments`, { method: 'POST', headers: { 'content-type': p.type, 'x-attachment-id': `${file.client_id}:${p.name}`.slice(0, 64), 'x-report-client-id': file.client_id }, body: Buffer.from(p.data_base64, 'base64') })
    log(`photo ${p.name}: ${up.ok ? 'stored' : `failed (${up.status})`}`)
  }
  process.exit(0)
}

if (flag('radio')) {
  const tracked = new Map() // incident -> { reportId, operator: false, until }
  createInterface({ input: process.stdin }).on('line', async (line) => {
    const t = line.trim()
    if (t === 'VYRA?') return // this is a gateway, not a bridge: nothing to answer
    const at = t.indexOf('V1|')
    if (at < 0) return
    try {
      const r = await ingest(t.slice(at), 'radio')
      if (r.ok) {
        process.stdout.write(`${r.ack}\n`) // verified acknowledgement back over the air
        tracked.set(r.incident, { reportId: r.report_id, operator: false, until: Date.now() + 6 * 3600_000 })
        log(`${r.duplicate ? 'duplicate' : 'new'} incident ${r.incident} -> report ${r.report_id}`)
      } else log(`rejected: ${r.error}`) // no ACK: the sender keeps retrying
    } catch (e) {
      log(`could not reach the server (${e.message}); no ACK sent, the sender will retry`)
    }
  })
  setInterval(async () => {
    for (const [incident, t] of tracked) {
      if (t.operator || Date.now() > t.until) { tracked.delete(incident); continue }
      const s = await status(t.reportId).catch(() => null)
      if (s && ['investigating', 'assigned', 'resolved'].includes(s)) { t.operator = true; process.stdout.write(`OPACK|${incident}|operator\n`); log(`operator acknowledged ${incident}`) }
    }
  }, 30_000)
  log(`listening for radio messages; forwarding to ${URL_BASE} as ${GW}`)
} else {
  log('choose one of: --radio | --compact "<message>" | --import <file>')
  process.exit(2)
}
