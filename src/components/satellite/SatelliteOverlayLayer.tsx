'use client'
// Draws a saved analysis's detected-change layer on VYRA's disaster map. Purely visual: it adds no markers that can be
// clicked into an incident and changes nothing in any record.
import { ImageOverlay, Rectangle, Tooltip } from 'react-leaflet'
import type { Bbox } from '@/lib/satellite/types'

export default function SatelliteOverlayLayer({ url, bounds, opacity, label }: { url: string | null; bounds: Bbox; opacity: number; label: string }) {
  const b: [[number, number], [number, number]] = [[bounds[1], bounds[0]], [bounds[3], bounds[2]]]
  return (
    <>
      {url && <ImageOverlay url={url} bounds={b} opacity={opacity} zIndex={450} />}
      <Rectangle bounds={b} pathOptions={{ color: '#7B3FBF', weight: 2, dashArray: '6 6', fill: false }} interactive>
        <Tooltip sticky>{label}</Tooltip>
      </Rectangle>
    </>
  )
}
