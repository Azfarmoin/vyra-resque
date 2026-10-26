'use client'

import { useEffect, useState } from 'react'
import Icon from '@/components/ui/Icon'
import { HAZARD_TYPES, SEVERITIES, SEVERITY_LABELS, type HazardType, type Severity } from '@/lib/alerts/types'
import { useSavedLocations } from '@/lib/alerts/useAlerts'
import { currentSubscription, disablePush, enablePush, pushSupported, readPrefs, serverPushStatus, updatePushSettings, writePrefs, type AlertPrefs } from '@/lib/alerts/pushClient'

export default function PushSettings() {
  const { locations } = useSavedLocations()
  const [prefs, setPrefs] = useState<AlertPrefs>({ hazards: [], minimum: 'warning', language: 'en' })
  const [on, setOn] = useState(false)
  const [server, setServer] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [mounted, setMounted] = useState(false) // browser support is only known on the client; rendering it earlier breaks hydration

  useEffect(() => {
    setMounted(true)
    setPrefs(readPrefs())
    serverPushStatus().then((s) => setServer(s.configured))
    currentSubscription().then((s) => setOn(!!s)).catch(() => undefined)
  }, [])

  // Keep the server copy in step with local choices (places or preferences).
  useEffect(() => { if (on) updatePushSettings(locations, prefs).catch(() => undefined) }, [locations, prefs, on])

  const change = (p: AlertPrefs) => { setPrefs(p); writePrefs(p) }
  const toggleHazard = (h: HazardType) => change({ ...prefs, hazards: prefs.hazards.includes(h) ? prefs.hazards.filter((x) => x !== h) : [...prefs.hazards, h] })

  async function turnOn() {
    setBusy(true); setMsg('')
    try { await enablePush(locations, prefs); setOn(true); setMsg('Push alerts are on for this browser.') } catch (e) { setMsg((e as Error).message) } finally { setBusy(false) }
  }
  async function turnOff() { setBusy(true); try { await disablePush(); setOn(false); setMsg('Push alerts are off and this browser has been removed from the server.') } finally { setBusy(false) } }

  return (
    <section className="clay-sm p-4 sm:p-5" style={{ borderRadius: 22 }} aria-labelledby="push-h">
      <h2 id="push-h" className="flex items-center gap-2 font-display text-xl font-semibold"><Icon name="bell" size={20} /> Push alerts</h2>
      <p className="mt-1 text-sm text-ink-700">If you turn this on, your browser can show a notice when an official source issues or changes an alert that matches one of your places, even when VYRA is not open. Your saved places and these choices are then stored on the VYRA server so it knows whom to notify; turn it off to remove them.</p>
      <p className="mt-1 text-sm font-semibold text-ink-800">Push needs a working internet or mobile-data connection. It cannot reach a device that is offline, and a delay is possible. Do not rely on it alone.</p>

      {mounted && !pushSupported() ? <p className="mt-3 text-sm">This browser does not support push notifications. On iPhone, add VYRA to your Home Screen first. You can still open this page for alerts.</p>
        : !mounted ? null
        : server === false ? <p className="mt-3 rounded-xl bg-warning-100 p-3 text-sm">Push notifications are not set up on this server yet, so they are unavailable. In-app alerts still work.</p>
        : (
          <>
            <fieldset className="mt-3">
              <legend className="text-sm font-bold">Tell me about</legend>
              <div className="mt-1 flex flex-wrap gap-2">{(Object.keys(HAZARD_TYPES) as HazardType[]).filter((h) => h !== 'other').map((h) => (
                <label key={h} className="chip !min-h-[40px] !px-3 !py-1.5 text-sm"><input type="checkbox" checked={prefs.hazards.includes(h)} onChange={() => toggleHazard(h)} /> {HAZARD_TYPES[h]}</label>
              ))}</div>
              <p className="mt-1 text-xs text-ink-600">Leave all unticked to hear about every hazard.</p>
            </fieldset>
            <div className="mt-3">
              <label htmlFor="minsev" className="text-sm font-bold">Notify me from level</label>{' '}
              <select id="minsev" className="rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm" value={prefs.minimum} onChange={(e) => change({ ...prefs, minimum: e.target.value as Severity })}>
                {SEVERITIES.map((s) => <option key={s} value={s}>{SEVERITY_LABELS[s]} and above</option>)}
              </select>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {on ? <button type="button" className="btn-ghost" onClick={turnOff} disabled={busy}>Turn off push alerts</button>
                : <button type="button" className="btn-primary" onClick={turnOn} disabled={busy || !locations.length}>Turn on push alerts</button>}
              {!on && !locations.length && <span className="text-sm text-ink-700">Add at least one place first.</span>}
            </div>
          </>
        )}
      {msg && <p role="status" className="mt-2 text-sm font-semibold">{msg}</p>}
    </section>
  )
}
