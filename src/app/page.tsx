<<<<<<< HEAD
import Link from 'next/link'
import AlertBanner from '@/components/alerts/AlertBanner'
import SiteHeader from '@/components/common/SiteHeader'
import SiteFooter from '@/components/common/SiteFooter'
import Icon, { type IconName } from '@/components/ui/Icon'
import { CommunityScene, RescueScene } from '@/components/ui/Illustrations'
import IncidentPreview from '@/components/home/IncidentPreview'

const STEPS: { title: string; text: string; icon: IconName; offset: string; tone: string }[] = [
  {
    title: 'Ask for help',
    text: 'Share where you are and answer what you can. Only the location is required, and a short form is saved as you type.',
    icon: 'pin',
    offset: 'md:mt-0',
    tone: 'clay',
  },
  {
    title: 'Cases are ranked, with reasons',
    text: 'Danger, injuries, medical needs and waiting time set the order. Every ranking lists the reasons behind it.',
    icon: 'list',
    offset: 'md:mt-16',
    tone: 'clay-navy',
  },
  {
    title: 'A team is sent',
    text: 'Responders check the top cases, change a ranking when they know better, and assign the closest team.',
    icon: 'boat',
    offset: 'md:mt-32',
    tone: 'clay',
  },
]

const PRINCIPLES: { title: string; text: string; icon: IconName }[] = [
  { title: 'Nobody is ranked by who is loudest', text: 'The order comes from what is happening, not from who sends the most messages or writes the longest report.', icon: 'users' },
  { title: 'Every ranking shows its reasons', text: 'Responders see which factors raised a case and by how much, so a ranking can be questioned and understood.', icon: 'eye' },
  { title: 'People make the final call', text: 'A responder can change any ranking and has to say why. The change stays in the case history.', icon: 'edit' },
  { title: 'Reports stay private', text: 'Contact details are for responders only. The person who sent a report sees its reference number and status.', icon: 'lock' },
]

export default function Home() {
  return (
    <div className="page">
      <SiteHeader />
      <AlertBanner />
      <main id="main">
        {/* 1. Hero */}
        <section className="relative overflow-hidden" aria-labelledby="hero-title">
          <div className="container-x grid items-center gap-8 pb-16 pt-10 sm:pt-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:gap-4 lg:pb-24 lg:pt-16">
            <div className="relative z-10">
              <p className="rise mb-4 text-sm font-bold uppercase tracking-widest text-ink-700">VYRA · Vulnerability, Yielded Response &amp; Assistance</p>
              <h1 id="hero-title" className="rise text-[2.75rem] font-semibold leading-[1.02] sm:text-6xl xl:text-7xl">
                Help should reach the people who need it first.
              </h1>
              <p className="rise rise-1 mt-6 max-w-lg text-lg text-ink-700 sm:text-xl">
                Tell VYRA where you are and what is happening. Every report is ranked by urgency, and responders can see exactly why.
              </p>
              <div className="rise rise-2 mt-9 flex flex-wrap items-center gap-4">
                <Link href="/report" className="btn-primary cta-ring px-8 py-5 text-xl">
                  <Icon name="alert" size={24} />
                  Report an emergency
                </Link>
                <Link href="/dashboard" className="btn-ghost px-6 py-4 text-base">
                  I am a responder
                  <Icon name="arrow" size={18} />
                </Link>
              </div>
              <p className="rise rise-3 mt-6 flex max-w-md items-start gap-2.5 text-[15px] text-ink-700">
                <Icon name="phone" size={20} className="mt-0.5 shrink-0" />
                <span>
                  It takes about a minute. If a life is in danger and phone lines work, also call <strong>Rescue 1122</strong>.
                </span>
              </p>
            </div>

            <div className="rise rise-2 relative lg:-mr-24 xl:-mr-44">
              <RescueScene className="h-auto w-full drop-shadow-[0_30px_40px_rgba(24,43,58,0.18)]" title="A rescue boat heads toward a rooftop where a family is calling for help during a flood" />
            </div>
          </div>
        </section>

        {/* 2. How it works */}
        <section className="relative overflow-hidden py-16 sm:py-24" aria-labelledby="how-title">
          <svg className="pointer-events-none absolute inset-x-0 top-24 hidden h-[420px] w-full md:block" viewBox="0 0 1200 420" preserveAspectRatio="none" aria-hidden="true">
            <path d="M-20 90C200 20 300 170 520 150S800 70 1000 220s180 120 240 100" fill="none" stroke="#F47755" strokeOpacity=".5" strokeWidth="4" strokeDasharray="3 14" strokeLinecap="round" />
            <path d="M-20 130C200 60 300 210 520 190S800 110 1000 260s180 120 240 100" fill="none" stroke="#182B3A" strokeOpacity=".08" strokeWidth="26" strokeLinecap="round" />
          </svg>
          <div className="container-x relative">
            <h2 id="how-title" className="max-w-2xl text-4xl font-semibold sm:text-5xl">
              From a phone to a rescue team in three steps
            </h2>
            <ol className="mt-12 grid gap-6 md:grid-cols-3 md:gap-8">
              {STEPS.map((s, i) => (
                <li key={s.title} className={`${s.offset}`}>
                  <div className={`${s.tone} lift h-full p-7 ${s.tone === 'clay-navy' ? '' : ''}`}>
                    <div className="flex items-center justify-between">
                      <span
                        className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-500 font-display text-2xl font-semibold text-ink-900"
                        style={{ boxShadow: 'inset 0 2px 0 rgb(255 255 255 / .5), inset 0 -4px 0 rgb(24 43 58 / .16)' }}
                      >
                        <span className="sr-only">Step </span>
                        {i + 1}
                      </span>
                      <Icon name={s.icon} size={30} className={s.tone === 'clay-navy' ? 'text-warning' : 'text-ink-500'} />
                    </div>
                    <h3 className="mt-6 text-2xl font-semibold leading-snug">{s.title}</h3>
                    <p className={`mt-3 text-[16px] leading-relaxed ${s.tone === 'clay-navy' ? 'text-sand-200' : 'text-ink-700'}`}>{s.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* 3. Community */}
        <section className="py-12 sm:py-20" aria-labelledby="community-title">
          <div className="container-x grid items-center gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16">
            <div className="clay relative overflow-hidden p-6 sm:p-10" style={{ background: 'linear-gradient(180deg,#fdf1d8,#f8e3b8)' }}>
              <CommunityScene className="mx-auto h-auto w-full max-w-md" title="Three neighbours holding on to a shared lifebuoy" />
            </div>
            <div>
              <h2 id="community-title" className="text-4xl font-semibold sm:text-5xl">
                Built to be fair when everyone is calling at once
              </h2>
              <p className="mt-5 max-w-xl text-lg text-ink-700">
                In a flood or an earthquake, a few minutes decide a lot. VYRA is designed for neighbourhoods that cannot all be reached at the same time, so the order has to be fair and open to question.
              </p>
              <dl className="mt-8 divide-y divide-ink-200/80">
                {PRINCIPLES.map((p) => (
                  <div key={p.title} className="flex gap-4 py-5">
                    <span className="clay-sm flex h-11 w-11 shrink-0 items-center justify-center text-ink-800" style={{ borderRadius: 14 }}>
                      <Icon name={p.icon} size={22} />
                    </span>
                    <div>
                      <dt className="font-display text-xl font-semibold leading-snug">{p.title}</dt>
                      <dd className="mt-1 text-[16px] text-ink-700">{p.text}</dd>
                    </div>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </section>

        {/* 4. Incident preview */}
        <section className="py-12 sm:py-20" aria-labelledby="preview-title">
          <div className="container-x grid items-start gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
            <div className="lg:sticky lg:top-28">
              <h2 id="preview-title" className="text-4xl font-semibold sm:text-5xl">
                What a responder sees first
              </h2>
              <p className="mt-5 max-w-md text-lg text-ink-700">
                The most urgent open cases sit at the top of the queue. Here is a small preview, without addresses or contact details.
              </p>
              <Link href="/map" className="btn-ghost mt-7">
                <Icon name="map" size={18} /> Explore the map
              </Link>
            </div>
            <IncidentPreview />
          </div>
        </section>
      </main>

      {/* 5. Footer */}
      <SiteFooter />
    </div>
=======
export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-teal-50 to-cyan-50">
      <div className="container mx-auto px-4 py-16">
        <div className="text-center mb-12">
          <h1 className="text-5xl font-bold text-gray-900 mb-4">
            ResQNet
          </h1>
          <p className="text-xl text-gray-600 mb-2">
            Intelligent Disaster Response & Rescue Coordination
          </p>
          <p className="text-lg text-teal-700 font-medium">
            Finding Who Needs Help Most
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
          <div className="bg-white rounded-lg shadow-lg p-6 hover:shadow-xl transition-shadow">
            <div className="w-12 h-12 bg-teal-100 rounded-full flex items-center justify-center mb-4">
              <svg className="w-6 h-6 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">Report Emergency</h3>
            <p className="text-gray-600">Submit emergency reports with location, injury details, and medical needs.</p>
          </div>

          <div className="bg-white rounded-lg shadow-lg p-6 hover:shadow-xl transition-shadow">
            <div className="w-12 h-12 bg-teal-100 rounded-full flex items-center justify-center mb-4">
              <svg className="w-6 h-6 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
              </svg>
            </div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">Live Map</h3>
            <p className="text-gray-600">View emergencies on an interactive map with urgency indicators.</p>
          </div>

          <div className="bg-white rounded-lg shadow-lg p-6 hover:shadow-xl transition-shadow">
            <div className="w-12 h-12 bg-teal-100 rounded-full flex items-center justify-center mb-4">
              <svg className="w-6 h-6 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">Coordinate Teams</h3>
            <p className="text-gray-600">Assign rescue teams and track resources efficiently.</p>
          </div>
        </div>

        <div className="mt-12 text-center">
          <div className="inline-flex gap-4">
            <a
              href="/report"
              className="px-6 py-3 bg-teal-600 text-white font-semibold rounded-lg hover:bg-teal-700 transition-colors"
            >
              Submit Report
            </a>
            <a
              href="/dashboard"
              className="px-6 py-3 bg-white text-teal-600 font-semibold rounded-lg border-2 border-teal-600 hover:bg-teal-50 transition-colors"
            >
              Responder Dashboard
            </a>
          </div>
        </div>
      </div>
    </main>
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
  )
}
