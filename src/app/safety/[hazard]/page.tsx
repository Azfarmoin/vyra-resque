import { notFound } from 'next/navigation'
import { GUIDES, getGuide } from '@/lib/safety'
import GuideClient from './GuideClient'

// All 12 guides are pre-built, so each one is a normal static page that the service worker can keep for offline use.
export function generateStaticParams() {
  return GUIDES.map((g) => ({ hazard: g.id }))
}
export function generateMetadata({ params }: { params: { hazard: string } }) {
  const g = getGuide(params.hazard)
  return { title: g ? `${g.title} - Hazards & Precautions | VYRA` : 'Guide not found | VYRA' }
}

export default function GuidePage({ params }: { params: { hazard: string } }) {
  if (!getGuide(params.hazard)) notFound()
  return <GuideClient id={params.hazard} />
}
