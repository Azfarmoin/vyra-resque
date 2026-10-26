import Link from 'next/link'
import SiteHeader from '@/components/common/SiteHeader'
import SiteFooter from '@/components/common/SiteFooter'
import Icon from '@/components/ui/Icon'
import { CONTENT_REVIEWED, DISCLAIMER, OFFICIAL_CONTACTS, OFFICIAL_SOURCES_TO_CHECK, PRECAUTIONS } from '@/lib/content/precautions'

export const metadata = { title: 'Emergency precautions — VYRA', description: 'General safety guidance for floods, fires, earthquakes, storms, landslides and first aid.' }

const fmt = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

export default function PrecautionsPage() {
  return (
    <div className="page">
      <SiteHeader />
      <main id="main" className="container-x py-8 sm:py-12">
        <header className="rise max-w-3xl">
          <h1 className="text-4xl font-semibold sm:text-5xl">Emergency precautions</h1>
          <p className="mt-3 text-lg text-ink-700">Short, practical safety guidance for the emergencies VYRA is built for.</p>
        </header>

        {/* Disclaimer: first thing on the page, not buried at the end. */}
        <div className="rise rise-1 mt-6 max-w-3xl rounded-2xl border-2 border-critical-700 bg-critical-100 p-4 text-[15px]" role="note" aria-label="Important">
          <p className="flex items-start gap-2 font-bold"><Icon name="alert" size={18} className="mt-0.5 shrink-0" /> {DISCLAIMER}</p>
          <p className="mt-2 font-semibold">Never enter a dangerous area to rescue someone. Call trained rescuers, give them the location, and wait somewhere safe.</p>
        </div>

        <nav aria-label="On this page" className="mt-8 max-w-4xl">
          <ul className="flex flex-wrap gap-2">
            <li><a href="#official" className="btn-ghost btn-sm"><Icon name="phone" size={16} /> Official numbers</a></li>
            {PRECAUTIONS.map((c) => (
              <li key={c.id}><a href={`#${c.id}`} className="btn-ghost btn-sm"><Icon name={c.icon} size={16} /> {c.title}</a></li>
            ))}
          </ul>
        </nav>

        {/* Verified, official */}
        <section id="official" aria-labelledby="official-title" className="mt-10 max-w-4xl scroll-mt-28">
          <div className="flex flex-wrap items-center gap-3">
            <h2 id="official-title" className="text-3xl font-semibold">Official emergency numbers</h2>
            <span className="pill bg-success-100 text-success-800"><Icon name="check" size={14} /> Verified from official pages</span>
          </div>
          <p className="mt-2 text-ink-700">Only numbers read from an official government page are listed, with the page they came from and the date they were checked. VYRA does not list a number it has not verified.</p>
          <ul className="mt-5 grid gap-4 sm:grid-cols-2">
            {OFFICIAL_CONTACTS.map((c) => (
              <li key={c.name} className="clay p-5" style={{ borderRadius: 24 }}>
                <p className="text-sm font-bold text-ink-600">{c.name}</p>
                <p className="font-display text-4xl font-semibold tabular-nums">
                  <a href={`tel:${c.number.replace(/[^+\d]/g, '')}`} className="rounded-lg underline decoration-primary-500 decoration-4 underline-offset-4" aria-label={`Call ${c.name} on ${c.number.replace(/[^+\d]/g, '').split('').join(' ')}`}>{c.number}</a>
                </p>
                <p className="mt-2 text-[15px]">{c.use}</p>
                <p className="mt-2 text-sm text-ink-700">{c.note}</p>
                <p className="mt-3 text-xs text-ink-600">
                  Source: <a href={c.sourceUrl} target="_blank" rel="noopener noreferrer" className="font-bold underline underline-offset-2">{c.source}</a>. Checked {fmt(c.checked)}.
                  {c.alsoListedBy?.map((o) => (
                    <span key={o.sourceUrl}> Also listed by <a href={o.sourceUrl} target="_blank" rel="noopener noreferrer" className="font-bold underline underline-offset-2">{o.source}</a>.</span>
                  ))}
                </p>
              </li>
            ))}
          </ul>
          <div className="clay-inset mt-5 p-4 text-[15px]">
            <p className="font-bold">Other numbers and instructions for your area</p>
            <p className="mt-1 text-ink-700">VYRA has not verified numbers for other services or regions, so none are shown. Look them up on the official pages of your own authorities, and follow their alerts and evacuation orders:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {OFFICIAL_SOURCES_TO_CHECK.map((s) => (
                <li key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer" className="font-bold underline underline-offset-2">{s.name}</a>: {s.note}</li>
              ))}
            </ul>
          </div>
        </section>

        {/* General guidance */}
        <section aria-labelledby="general-title" className="mt-14 max-w-4xl">
          <div className="flex flex-wrap items-center gap-3">
            <h2 id="general-title" className="text-3xl font-semibold">General safety guidance</h2>
            <span className="pill bg-warning-100 text-warning-700"><Icon name="info" size={14} /> General advice, not official instructions</span>
          </div>
          <p className="mt-2 text-ink-700">
            This is common safety advice, written to be short. It is not an instruction from any government or rescue agency, and it cannot account for your exact situation. If an official instruction, evacuation order or alert says something different, follow the official instruction.
          </p>
          <p className="mt-2 text-sm text-ink-600">Content last reviewed {fmt(CONTENT_REVIEWED)} by the VYRA project. It has not been reviewed or endorsed by an emergency authority.</p>

          <div className="mt-6 space-y-6">
            {PRECAUTIONS.map((cat) => (
              <section key={cat.id} id={cat.id} aria-labelledby={`${cat.id}-title`} className="clay scroll-mt-28 p-5 sm:p-7" style={{ borderRadius: 28 }}>
                <div className="flex items-start gap-4">
                  <span className="clay-sm flex h-12 w-12 shrink-0 items-center justify-center" style={{ borderRadius: 16 }}><Icon name={cat.icon} size={26} /></span>
                  <div>
                    <h3 id={`${cat.id}-title`} className="text-2xl font-semibold leading-snug">{cat.title}</h3>
                    <p className="mt-1 text-ink-700">{cat.summary}</p>
                  </div>
                </div>
                <div className="mt-5 grid gap-5 md:grid-cols-2">
                  {cat.groups.map((g) => (
                    <div key={g.heading} className={g.tone === 'avoid' ? 'rounded-2xl bg-critical-100/60 p-4' : ''}>
                      <h4 className="flex items-center gap-2 font-display text-lg font-semibold">
                        {g.tone === 'avoid' ? <Icon name="close" size={18} className="text-critical-700" /> : <Icon name="check" size={18} className="text-success-700" />}
                        {g.heading}
                      </h4>
                      <ul className="mt-2 list-disc space-y-2 pl-5 text-[15px] leading-relaxed">
                        {g.items.map((it) => <li key={it}>{it}</li>)}
                      </ul>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </section>

        <aside className="mt-12 max-w-4xl clay-navy p-6 sm:p-8" aria-labelledby="need-help">
          <h2 id="need-help" className="text-2xl font-semibold text-white">Need help now?</h2>
          <p className="mt-2 text-sand-200">Call the emergency number for your area if you can. You can also send VYRA a report so responders can see where you are.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link href="/report" className="btn-primary"><Icon name="alert" size={18} /> Report an emergency</Link>
            <Link href="/faq" className="btn-ghost">Read the FAQ</Link>
            <Link href="/contact" className="btn-ghost">Contact support</Link>
          </div>
        </aside>
      </main>
      <SiteFooter />
    </div>
  )
}
