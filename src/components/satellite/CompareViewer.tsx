'use client'
// Before/after viewing: side by side, swipe, or opacity overlay. Two synchronised maps carry the two images, so all three modes
// pan and zoom together. The detected-change layer can be switched on over the "after" image.
import { useEffect, useRef } from 'react'
import type { Map as LMap } from 'leaflet'
import { ImageOverlay, MapContainer, TileLayer, useMap } from 'react-leaflet'
import type { Bbox } from '@/lib/satellite/types'

export type Mode = 'side' | 'swipe' | 'opacity'
type Reg = { maps: LMap[]; busy: boolean }

function Sync({ reg, bounds }: { reg: React.MutableRefObject<Reg>; bounds: Bbox }) {
  const map = useMap()
  useEffect(() => {
    reg.current.maps.push(map)
    map.fitBounds([[bounds[1], bounds[0]], [bounds[3], bounds[2]]], { animate: false })
    const move = () => {
      if (reg.current.busy) return
      reg.current.busy = true
      for (const o of reg.current.maps) if (o !== map) o.setView(map.getCenter(), map.getZoom(), { animate: false })
      reg.current.busy = false
    }
    map.on('move', move)
    return () => { map.off('move', move); reg.current.maps = reg.current.maps.filter((m) => m !== map) }
  }, [map, reg, bounds])
  return null
}

function Pane({ reg, bounds, image, change, opacity = 1, className = '', style }: { reg: React.MutableRefObject<Reg>; bounds: Bbox; image: string | null; change?: string | null; opacity?: number; className?: string; style?: React.CSSProperties }) {
  const b: [[number, number], [number, number]] = [[bounds[1], bounds[0]], [bounds[3], bounds[2]]]
  return (
    <div className={className} style={style}>
      <MapContainer center={[(bounds[1] + bounds[3]) / 2, (bounds[0] + bounds[2]) / 2]} zoom={12} className="h-full w-full" scrollWheelZoom>
        <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        {image && <ImageOverlay url={image} bounds={b} opacity={opacity} />}
        {change && <ImageOverlay url={change} bounds={b} opacity={1} />}
        <Sync reg={reg} bounds={bounds} />
      </MapContainer>
    </div>
  )
}

export default function CompareViewer({ mode, bounds, before, after, change, showChange, position, beforeLabel, afterLabel }: {
  mode: Mode; bounds: Bbox; before: string | null; after: string | null; change: string | null; showChange: boolean; position: number; beforeLabel: string; afterLabel: string
}) {
  const reg = useRef<Reg>({ maps: [], busy: false })
  const ch = showChange ? change : null
  if (mode === 'side') {
    return (
      <div className="grid gap-2 md:grid-cols-2">
        {([['Before', beforeLabel, before, null], ['After', afterLabel, after, ch]] as const).map(([t, l, img, c]) => (
          <div key={t}>
            <p className="mb-1 text-sm font-bold">{t}: <span className="font-semibold text-ink-600">{l}</span></p>
            <Pane key={`${mode}-${t}`} reg={reg} bounds={bounds} image={img} change={c} className="h-[340px] overflow-hidden rounded-2xl border-2 border-sand-300" />
          </div>
        ))}
      </div>
    )
  }
  const swipe = mode === 'swipe'
  return (
    <div>
      <p className="mb-1 flex justify-between text-sm font-bold"><span>Before: <span className="font-semibold text-ink-600">{beforeLabel}</span></span><span>After: <span className="font-semibold text-ink-600">{afterLabel}</span></span></p>
      <div className="relative h-[420px] overflow-hidden rounded-2xl border-2 border-sand-300">
        <Pane key={`${mode}-b`} reg={reg} bounds={bounds} image={before} className="absolute inset-0" />
        <Pane key={`${mode}-a`} reg={reg} bounds={bounds} image={after} change={ch} opacity={swipe ? 1 : position / 100} className="absolute inset-0" style={swipe ? { clipPath: `inset(0 0 0 ${position}%)` } : undefined} />
        {swipe && <div aria-hidden className="pointer-events-none absolute inset-y-0 z-[1000] w-1 bg-white shadow" style={{ left: `${position}%` }} />}
      </div>
    </div>
  )
}
