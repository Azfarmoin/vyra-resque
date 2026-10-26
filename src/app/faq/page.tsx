'use client'

// Frequently asked questions: searchable, filterable by category, with accessible accordions.
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import SiteHeader from '@/components/common/SiteHeader'
import SiteFooter from '@/components/common/SiteFooter'
import Icon from '@/components/ui/Icon'
import { EmptyCrate } from '@/components/ui/Illustrations'
import { FAQ_CATEGORIES, FAQ_ITEMS, filterFaq, type FaqCategoryId } from '@/lib/content/faq'

export default function FaqPage() {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<FaqCategoryId | 'all'>('all')
  const [open, setOpen] = useState<Set<string>>(new Set())

  // A link like /faq#ai-accuracy opens that answer.
  useEffect(() => {
    const id = window.location.hash.slice(1)
    if (id && FAQ_ITEMS.some((i) => i.id === id)) {
      setOpen(new Set([id]))
      setTimeout(() => document.getElementById(`faq-${id}`)?.scrollIntoView({ block: 'center' }), 50)
    }
  }, [])

  const results = useMemo(() => filterFaq(FAQ_ITEMS, query, category), [query, category])
  const searching = query.trim() !== '' || category !== 'all'
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const clear = () => { setQuery(''); setCategory('all') }
  const allOpen = results.length > 0 && results.every((r) => open.has(r.id))

  return (
    <div className="page">
      <SiteHeader />
      <main id="main" className="container-x py-8 sm:py-12">
        <header className="rise max-w-2xl">
          <h1 className="text-4xl font-semibold sm:text-5xl">Frequently asked questions</h1>
          <p className="mt-3 text-lg text-ink-700">Quick answers about using VYRA, sending a report, and staying safe.</p>
        </header>

        <div className="rise rise-1 mt-6 max-w-3xl rounded-2xl border-2 border-warning bg-warning-100 p-4 text-[15px] font-semibold" role="note">
          <p className="flex items-start gap-2"><Icon name="alert" size={18} className="mt-0.5 shrink-0" /> If a life is in danger, call the emergency number for your area first. VYRA does not replace emergency services.</p>
        </div>

        <section aria-label="Search and filter" className="rise rise-1 mt-8 max-w-3xl space-y-4">
          <div>
            <label htmlFor="faq-search" className="label">Search the questions</label>
            <div className="relative">
              <Icon name="search" size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-600" />
              <input
                id="faq-search"
                type="search"
                className="input !pl-11"
                placeholder="Try “photos”, “shelter” or “status”"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoComplete="off"
                aria-describedby="faq-count"
              />
            </div>
          </div>
          <div role="group" aria-label="Filter by topic" className="flex flex-wrap gap-2">
            {[{ id: 'all' as const, label: 'All topics' }, ...FAQ_CATEGORIES].map((c) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={category === c.id}
                onClick={() => setCategory(c.id)}
                className={`rounded-full border-2 px-4 py-2 text-sm font-bold transition ${category === c.id ? 'border-ink-900 bg-primary-100' : 'border-transparent bg-sand-200/70 hover:bg-sand-200'}`}
              >
                {category === c.id && <Icon name="check" size={14} className="mr-1 inline" />}
                {c.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p id="faq-count" role="status" aria-live="polite" className="text-sm font-semibold text-ink-700">
              {results.length === 0 ? 'No questions match.' : `${results.length} ${results.length === 1 ? 'question' : 'questions'}${searching ? ' found' : ''}`}
            </p>
            {results.length > 0 && (
              <button type="button" className="text-sm font-bold underline decoration-2 underline-offset-4" onClick={() => setOpen(allOpen ? new Set() : new Set(results.map((r) => r.id)))}>
                {allOpen ? 'Collapse all' : 'Expand all'}
              </button>
            )}
          </div>
        </section>

        <div className="mt-4 max-w-3xl">
          {results.length === 0 ? (
            <div className="clay flex flex-col items-center gap-3 p-8 text-center">
              <EmptyCrate className="w-32" />
              <h2 className="text-2xl font-semibold">We could not find that</h2>
              <p className="text-ink-700">Try a shorter or different word, or look at all topics. If your question is not answered here, you can ask support.</p>
              <div className="mt-2 flex flex-wrap justify-center gap-3">
                <button type="button" className="btn-ghost" onClick={clear}>Clear search</button>
                <Link href="/contact" className="btn-primary">Contact us</Link>
              </div>
            </div>
          ) : (
            <ul className="space-y-3">
              {results.map((item) => {
                const isOpen = open.has(item.id)
                const cat = FAQ_CATEGORIES.find((c) => c.id === item.category)
                return (
                  <li key={item.id} id={`faq-${item.id}`} className="clay-sm scroll-mt-28" style={{ borderRadius: 22 }}>
                    <h2 className="text-base">
                      <button
                        type="button"
                        id={`faq-btn-${item.id}`}
                        aria-expanded={isOpen}
                        aria-controls={`faq-panel-${item.id}`}
                        onClick={() => toggle(item.id)}
                        className="flex w-full items-start justify-between gap-4 rounded-[22px] px-5 py-4 text-left"
                      >
                        <span>
                          <span className="block text-xs font-bold uppercase tracking-widest text-ink-600">{cat?.label}</span>
                          <span className="mt-0.5 block font-display text-xl font-semibold leading-snug">{item.question}</span>
                        </span>
                        <Icon name="chevron" size={22} className={`mt-2 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                      </button>
                    </h2>
                    <div id={`faq-panel-${item.id}`} role="region" aria-labelledby={`faq-btn-${item.id}`} hidden={!isOpen} className="px-5 pb-5">
                      <div className="space-y-3 text-[16px] leading-relaxed text-ink-800">
                        {item.answer.map((p, i) => <p key={i}>{p}</p>)}
                      </div>
                      {item.links && (
                        <ul className="mt-4 flex flex-wrap gap-2" aria-label="Related pages">
                          {item.links.map((l) => (
                            <li key={l.href}>
                              <Link href={l.href} className="btn-ghost btn-sm">{l.label} <Icon name="arrow" size={14} /></Link>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <aside className="mt-10 max-w-3xl clay p-6" style={{ borderRadius: 28 }} aria-labelledby="faq-more">
          <h2 id="faq-more" className="text-2xl font-semibold">Still need help?</h2>
          <p className="mt-2 text-ink-700">Ask support through VYRA, or read the emergency safety guidance.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link href="/contact" className="btn-primary">Contact us</Link>
            <Link href="/precautions" className="btn-ghost"><Icon name="shield" size={18} /> Emergency precautions</Link>
          </div>
        </aside>
      </main>
      <SiteFooter />
    </div>
  )
}
