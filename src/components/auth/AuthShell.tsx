import Link from 'next/link'
import { Logo } from '@/components/common/SiteHeader'
import { BeaconScene, CommunityScene } from '@/components/ui/Illustrations'
import Icon from '@/components/ui/Icon'

// Split screen for sign-in / sign-up: a calm illustrated panel and the form in a clay card.
export default function AuthShell({ variant, title, intro, children }: { variant: 'login' | 'register'; title: string; intro: string; children: React.ReactNode }) {
  return (
    <div className="page grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="clay-navy relative m-3 hidden flex-col justify-between overflow-hidden p-10 lg:flex" style={{ borderRadius: 36 }}>
        <Link href="/" aria-label="VYRA home" className="w-fit rounded-xl">
          <Logo dark />
        </Link>
        <div className="relative z-10 max-w-sm">
          <p className="font-display text-4xl font-semibold leading-tight text-white">
            {variant === 'login' ? 'Welcome back. Someone is waiting on a good call.' : 'Join the people who answer first.'}
          </p>
          <p className="mt-4 text-ink-200">
            {variant === 'login'
              ? 'Sign in to follow your reports, or to work the dispatcher queue if you are a responder.'
              : 'An account lets responders and neighbours coordinate. Anyone can still ask for help without signing in.'}
          </p>
        </div>
        {variant === 'login' ? (
          <BeaconScene className="pointer-events-none absolute -bottom-6 -right-10 w-[88%] max-w-[420px] opacity-95" />
        ) : (
          <CommunityScene className="pointer-events-none absolute -bottom-4 -right-8 w-[84%] max-w-[400px] opacity-95" />
        )}
      </aside>

      <main id="main" className="flex min-h-screen flex-col px-4 py-6 sm:px-8">
        <div className="mb-6 flex items-center justify-between lg:hidden">
          <Link href="/" aria-label="VYRA home" className="rounded-xl"><Logo /></Link>
        </div>
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-6">
          <div className="rise clay p-6 sm:p-8">
            <h1 className="text-3xl font-semibold sm:text-4xl">{title}</h1>
            <p className="mt-2 text-ink-700">{intro}</p>
            <div className="mt-6">{children}</div>
          </div>
          <Link href="/" className="rise rise-1 mx-auto mt-6 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-bold text-ink-700 hover:text-ink-900">
            <Icon name="arrow" size={16} className="rotate-180" /> Back to home
          </Link>
        </div>
      </main>
    </div>
  )
}

export function FieldError({ id, children }: { id: string; children?: string }) {
  if (!children) return null
  return (
    <p id={id} className="field-error">
      <Icon name="alert" size={16} className="mt-0.5 shrink-0" /> {children}
    </p>
  )
}
