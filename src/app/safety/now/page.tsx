'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import SiteHeader from '@/components/common/SiteHeader'
import { NowWizard } from '@/components/safety/SafetyUi'
import { isHazardId } from '@/lib/safety'
import { useGuides } from '@/lib/safety/client'

function Inner() {
  const { guides } = useGuides()
  const h = useSearchParams().get('hazard') ?? ''
  return <NowWizard guides={guides} initialHazard={isHazardId(h) ? h : null} />
}

export default function NowPage() {
  return (
    <div className="page min-h-screen">
      <SiteHeader />
      <main id="main" className="mx-auto max-w-2xl space-y-4 p-3 sm:p-5">
        <h1 className="font-display text-3xl font-semibold">What should I do right now?</h1>
        <p className="text-ink-700">Answer what you can. The checklist updates as you tap, and works without internet.</p>
        <Suspense fallback={<p>Loading...</p>}><Inner /></Suspense>
      </main>
    </div>
  )
}
