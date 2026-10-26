'use client'

import SiteHeader from '@/components/common/SiteHeader'
import { SafetyHome } from '@/components/safety/SafetyUi'
import { useGuides } from '@/lib/safety/client'

export default function SafetyPage() {
  const { guides } = useGuides()
  return (
    <div className="page min-h-screen">
      <SiteHeader />
      <main id="main" className="mx-auto max-w-6xl space-y-5 p-3 sm:p-5">
        <header className="px-1 pt-2">
          <h1 className="font-display text-3xl font-semibold sm:text-4xl">Hazards &amp; Precautions</h1>
          <p className="mt-1 max-w-2xl text-lg text-ink-700">Illustrated survival guides: what to do BEFORE, DURING, WHILE WAITING FOR RESCUE and AFTER each kind of disaster.</p>
        </header>
        <SafetyHome guides={guides} />
      </main>
    </div>
  )
}
