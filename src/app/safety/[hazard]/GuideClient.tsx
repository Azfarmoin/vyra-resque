'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import SiteHeader from '@/components/common/SiteHeader'
import Icon from '@/components/ui/Icon'
import { EmergencyCall, GuideView } from '@/components/safety/SafetyUi'
import { PHASES, getGuide, type Phase } from '@/lib/safety'
import { useGuides } from '@/lib/safety/client'

export default function GuideClient({ id }: { id: string }) {
  const { guides } = useGuides()
  const guide = guides.find((g) => g.id === id) ?? getGuide(id)!
  const [phase, setPhase] = useState<Phase | undefined>(undefined)
  useEffect(() => { const h = window.location.hash.slice(1); if ((PHASES as readonly string[]).includes(h)) setPhase(h as Phase) }, [])
  return (
    <div className="page min-h-screen">
      <SiteHeader />
      <main id="main" className="mx-auto max-w-4xl space-y-4 p-3 sm:p-5">
        <nav aria-label="Breadcrumb" className="text-sm"><Link href="/safety" className="font-bold underline">Hazards &amp; Precautions</Link> <span aria-hidden="true">/</span> {guide.title}</nav>
        <header className="space-y-2">
          <h1 className="flex items-start gap-3 font-display text-3xl font-semibold leading-tight"><Icon name={guide.icon} size={32} className="mt-1 shrink-0" />{guide.title}</h1>
          <p className="text-lg text-ink-700">{guide.short}</p>
          <p className="text-sm text-ink-600"><strong>Applies to:</strong> {guide.scope}</p>
          <div className="flex flex-wrap gap-2"><EmergencyCall /><Link href={`/safety/now?hazard=${guide.id}`} className="btn-ghost"><Icon name="alert" size={18} /> What should I do right now?</Link></div>
        </header>
        <GuideView key={phase ?? 'during'} guide={guide} initialPhase={phase} />
      </main>
    </div>
  )
}
