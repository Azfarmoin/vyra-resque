'use client'

import { useState } from 'react'
import Icon from '@/components/ui/Icon'
import { AREAS } from '@/lib/constants'
import { PLACE_CHOICES } from '@/lib/alerts/locations'
import { useSavedLocations } from '@/lib/alerts/useAlerts'

// Current location (only when the person presses the button, so the browser asks permission then), or a named place.
// Several places can be saved. Locations stay on this device unless the person turns on push alerts.
export default function LocationManager() {
  const { locations, add, remove, full } = useSavedLocations()
  const [msg, setMsg] = useState('')
  const [choice, setChoice] = useState('')
  const all = [...PLACE_CHOICES, ...AREAS.map((a) => ({ label: `${a.name} (Karachi area)`, lat: a.center[0], lng: a.center[1] }))]

  function useMyLocation() {
    setMsg('')
    if (!('geolocation' in navigator)) { setMsg('This browser cannot share your location. Choose a place from the list instead.'); return }
    navigator.geolocation.getCurrentPosition(
      (p) => { add({ label: 'My current location', lat: p.coords.latitude, lng: p.coords.longitude, source: 'gps', accuracyM: Math.round(p.coords.accuracy) }); setMsg(`Saved. Accuracy about ${Math.round(p.coords.accuracy)} m. It is a snapshot: save a new one if you move.`) },
      (e) => setMsg(e.code === 1 ? 'Location permission was denied. You can choose a place from the list instead.' : 'Could not get your location. Choose a place from the list instead.'),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    )
  }
  function addChoice() {
    const c = all.find((x) => x.label === choice)
    if (c) { add({ label: c.label, lat: c.lat, lng: c.lng, source: 'area_centre', accuracyM: null }); setChoice('') }
  }

  return (
    <section className="clay-sm p-4 sm:p-5" style={{ borderRadius: 22 }} aria-labelledby="loc-h">
      <h2 id="loc-h" className="font-display text-xl font-semibold">Your places</h2>
      <p className="mt-1 text-sm text-ink-700">Choose where you want warnings for. A city or area is matched by its centre point only, so results for it are approximate. Up to 5 places are kept on this device.</p>
      <ul className="mt-3 space-y-2">
        {locations.map((l) => (
          <li key={l.id} className="flex items-center justify-between gap-2 rounded-xl bg-sand-100 px-3 py-2 text-sm">
            <span><Icon name="pin" size={14} /> <strong>{l.label}</strong> <span className="text-ink-600">{l.source === 'gps' ? `· GPS, ±${l.accuracyM ?? '?'} m` : '· approximate (area centre)'}</span></span>
            <button type="button" className="btn-ghost btn-sm" onClick={() => remove(l.id)} aria-label={`Remove ${l.label}`}><Icon name="close" size={14} /></button>
          </li>
        ))}
        {!locations.length && <li className="text-sm text-ink-600">No places saved yet. Without one, all alerts are listed but none can be matched to you.</li>}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn-primary btn-sm" onClick={useMyLocation} disabled={full}><Icon name="pin" size={16} /> Use my current location</button>
        <label className="sr-only" htmlFor="place">Choose a city or area</label>
        <select id="place" className="rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm" value={choice} onChange={(e) => setChoice(e.target.value)} disabled={full}>
          <option value="">Choose a city or area...</option>
          {all.map((c) => <option key={c.label} value={c.label}>{c.label}</option>)}
        </select>
        <button type="button" className="btn-ghost btn-sm" onClick={addChoice} disabled={!choice || full}>Add</button>
      </div>
      {full && <p className="mt-2 text-xs text-ink-600">You have reached 5 places. Remove one to add another.</p>}
      {msg && <p role="status" className="mt-2 text-sm font-semibold">{msg}</p>}
    </section>
  )
}
