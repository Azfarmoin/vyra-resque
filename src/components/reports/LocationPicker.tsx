'use client'

// Loaded with next/dynamic (ssr: false) because Leaflet needs `window`.
import { useEffect, useState } from 'react'
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from 'react-leaflet'
import { pickerIcon } from '../map/markers'
import { DEFAULT_CENTER } from '@/lib/constants'
<<<<<<< HEAD
import Icon from '@/components/ui/Icon'
=======
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895

export interface PickedLocation {
  lat: number
  lng: number
  source: 'gps' | 'manual'
  accuracyM?: number
<<<<<<< HEAD
  capturedAt?: string // when the device produced the GPS fix (device clock); absent for typed/map-picked points
=======
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
}

function ClickToPlace({ onPick }: { onPick: (p: { lat: number; lng: number }) => void }) {
  useMapEvents({ click: (e) => onPick(e.latlng) })
  return null
}

function FlyTo({ position }: { position: PickedLocation | null }) {
  const map = useMap()
  useEffect(() => {
    if (position) map.flyTo([position.lat, position.lng], Math.max(map.getZoom(), 15), { duration: 0.6 })
  }, [position?.lat, position?.lng]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

// GPS on request; people can always tap the map or drag the pin instead.
export default function LocationPicker({ value, onChange }: { value: PickedLocation | null; onChange: (v: PickedLocation) => void }) {
  const [gps, setGps] = useState<{ state: 'idle' | 'loading' | 'ok' | 'error'; message: string }>({ state: 'idle', message: '' })

  const useGps = () => {
    if (!('geolocation' in navigator)) {
      setGps({ state: 'error', message: 'This device does not support GPS location. Please tap the map.' })
      return
    }
    setGps({ state: 'loading', message: 'Getting your location...' })
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const accuracyM = Math.round(pos.coords.accuracy)
<<<<<<< HEAD
        onChange({ lat: pos.coords.latitude, lng: pos.coords.longitude, source: 'gps', accuracyM, capturedAt: new Date(pos.timestamp || Date.now()).toISOString() })
        setGps({ state: 'ok', message: `GPS position received (accuracy about ${accuracyM} m). It is the device's reading and has not been verified. Drag the pin if it is not exact.` })
=======
        onChange({ lat: pos.coords.latitude, lng: pos.coords.longitude, source: 'gps', accuracyM })
        setGps({ state: 'ok', message: `Location found (accuracy about ${accuracyM} m). Drag the pin if it is not exact.` })
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
      },
      (err) =>
        setGps({
          state: 'error',
          message:
            err.code === err.PERMISSION_DENIED
              ? 'Location permission was denied. Please tap the map to mark where help is needed.'
              : 'Could not get a GPS fix. Please tap the map to mark where help is needed.',
        }),
<<<<<<< HEAD
      { enableHighAccuracy: true, timeout: 30000, maximumAge: 60000 }
    )
  }

  // Typed coordinates: works with no map and no connection. Nothing is looked up or invented.
  const [latText, setLatText] = useState('')
  const [lngText, setLngText] = useState('')
  const [coordError, setCoordError] = useState('')
  const [offline, setOffline] = useState(false)
  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine)
    sync()
    window.addEventListener('online', sync)
    window.addEventListener('offline', sync)
    return () => {
      window.removeEventListener('online', sync)
      window.removeEventListener('offline', sync)
    }
  }, [])
  const useTyped = () => {
    const lat = Number(latText.trim())
    const lng = Number(lngText.trim())
    if (latText.trim() === '' || lngText.trim() === '' || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      setCoordError('Enter latitude (-90 to 90) and longitude (-180 to 180) as decimal numbers, e.g. 24.8607 and 67.0011.')
      return
    }
    setCoordError('')
    onChange({ lat, lng, source: 'manual' })
  }

  const pickManual = (p: { lat: number; lng: number }) => onChange({ lat: p.lat, lng: p.lng, source: 'manual' })

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={useGps} className="btn-primary" disabled={gps.state === 'loading'}>
          <Icon name="pin" size={18} />
          {gps.state === 'loading' ? 'Locating...' : 'Use my current location'}
        </button>
        <span className="hint">or tap the map, or drag the pin</span>
      </div>
      <p className="hint">
        GPS can work without mobile data, but it depends on your device, settings and surroundings (indoors it may be slow or inaccurate).
        {offline && ' You are offline, so the map picture may not load. GPS, typed coordinates, or describing the place below all still work.'}
      </p>
      {gps.message && (
        <p className={`flex items-start gap-1.5 text-sm font-semibold ${gps.state === 'error' ? 'text-critical-700' : 'text-ink-700'}`} role="status">
          <Icon name={gps.state === 'error' ? 'alert' : 'info'} size={16} className="mt-0.5 shrink-0" />
          {gps.message}
        </p>
      )}
      <div className="clay-sm overflow-hidden p-1.5" style={{ borderRadius: 22 }}>
        <div className="h-64 overflow-hidden sm:h-80" style={{ borderRadius: 16 }}>
          <MapContainer center={value ? [value.lat, value.lng] : DEFAULT_CENTER} zoom={value ? 15 : 11} className="h-full w-full">
            <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <ClickToPlace onPick={pickManual} />
            <FlyTo position={value} />
            {value && (
              <Marker
                position={[value.lat, value.lng]}
                icon={pickerIcon}
                draggable
                eventHandlers={{ dragend: (e) => pickManual(e.target.getLatLng()) }}
              />
            )}
          </MapContainer>
        </div>
      </div>
      <details className="clay-inset p-3">
        <summary className="cursor-pointer text-sm font-bold">Type coordinates instead</summary>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div>
            <label className="label" htmlFor="manualLat">Latitude</label>
            <input id="manualLat" className="input w-36" inputMode="decimal" value={latText} onChange={(e) => setLatText(e.target.value)} placeholder="24.8607" aria-invalid={!!coordError} />
          </div>
          <div>
            <label className="label" htmlFor="manualLng">Longitude</label>
            <input id="manualLng" className="input w-36" inputMode="decimal" value={lngText} onChange={(e) => setLngText(e.target.value)} placeholder="67.0011" aria-invalid={!!coordError} />
          </div>
          <button type="button" className="btn-ghost btn-sm" onClick={useTyped}>Use these coordinates</button>
        </div>
        {coordError && <p className="field-error" role="alert">{coordError}</p>}
      </details>
      {value ? (
        <p className="flex items-center gap-1.5 text-sm font-semibold text-success-800" role="status">
          <Icon name="check" size={16} />
          Location set (not verified): {value.lat.toFixed(5)}, {value.lng.toFixed(5)} ({value.source === 'gps' ? `from GPS${value.accuracyM ? `, about ${value.accuracyM} m` : ''}` : 'selected or typed by you'})
        </p>
      ) : (
        <p className="hint">No coordinates yet. You can also describe the place in words below.</p>
=======
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    )
  }

  const pickManual = (p: { lat: number; lng: number }) => onChange({ lat: p.lat, lng: p.lng, source: 'manual' })

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={useGps} className="btn-primary" disabled={gps.state === 'loading'}>
          📍 {gps.state === 'loading' ? 'Locating...' : 'Use my current location'}
        </button>
        <span className="text-sm text-gray-500">or tap the map / drag the pin</span>
      </div>
      {gps.message && (
        <p className={`text-sm ${gps.state === 'error' ? 'text-red-700' : 'text-gray-600'}`} role="status">
          {gps.message}
        </p>
      )}
      <div className="h-64 overflow-hidden rounded-lg border border-gray-300 sm:h-72">
        <MapContainer center={value ? [value.lat, value.lng] : DEFAULT_CENTER} zoom={value ? 15 : 11} className="h-full w-full">
          <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <ClickToPlace onPick={pickManual} />
          <FlyTo position={value} />
          {value && (
            <Marker
              position={[value.lat, value.lng]}
              icon={pickerIcon}
              draggable
              eventHandlers={{ dragend: (e) => pickManual(e.target.getLatLng()) }}
            />
          )}
        </MapContainer>
      </div>
      {value ? (
        <p className="text-xs text-gray-500">
          {value.lat.toFixed(5)}, {value.lng.toFixed(5)} · {value.source === 'gps' ? 'from GPS' : 'selected on map'}
        </p>
      ) : (
        <p className="text-xs text-amber-700">No location selected yet.</p>
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
      )}
    </div>
  )
}
