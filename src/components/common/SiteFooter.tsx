import Link from 'next/link'
import { Logo } from '@/components/common/SiteHeader'

const link = 'underline decoration-primary-500 decoration-2 underline-offset-4'

// Shared footer: the same text and links on every public page.
export default function SiteFooter() {
  return (
    <footer className="mt-10 border-t border-ink-200/80 bg-sand-200/50">
      <div className="container-x grid gap-8 py-10 md:grid-cols-[1.4fr_1fr]">
        <div>
          <Logo />
          <p className="mt-2 text-sm font-bold text-ink-700">Vulnerability, Yielded Response &amp; Assistance</p>
          <p className="mt-4 max-w-md text-[15px] text-ink-700">
            If a life is in danger and phone lines work, call <strong>Rescue 1122</strong> as well as sending a report. VYRA helps responders decide who to reach first. It does not replace emergency services.
          </p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap content-start gap-x-8 gap-y-3 text-[15px] font-bold md:justify-end">
          <Link href="/report" className={link}>Report an emergency</Link>
          <Link href="/map" className={link}>Live map</Link>
          <Link href="/faq" className={link}>FAQ</Link>
          <Link href="/contact" className={link}>Contact us</Link>
          <Link href="/precautions" className={link}>Emergency precautions</Link>
          <Link href="/auth/login" className={link}>Sign in</Link>
        </nav>
      </div>
    </footer>
  )
}
