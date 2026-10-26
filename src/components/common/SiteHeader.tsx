'use client'

<<<<<<< HEAD
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut, useSession } from '@/lib/session'
import Icon, { type IconName } from '@/components/ui/Icon'

const links: { href: string; label: string; icon: IconName }[] = [
  { href: '/dashboard', label: 'Dispatcher', icon: 'list' },
  { href: '/alerts', label: 'Alerts', icon: 'bell' },
  { href: '/map', label: 'Map', icon: 'map' },
  { href: '/safety', label: 'Safety', icon: 'shield' },
  { href: '/dispatches', label: 'Missions', icon: 'boat' },
  { href: '/resources', label: 'Supplies', icon: 'box' },
  { href: '/shelters', label: 'Shelters', icon: 'home' },
]
// Shown to administrators only.
// Shown to responders and administrators (zone editing is permission-checked on the server too).
const staffLinks: { href: string; label: string; icon: IconName }[] = [{ href: '/admin/zones', label: 'Zones', icon: 'pin' }, { href: '/satellite', label: 'Satellite', icon: 'satellite' }]
const adminLinks: { href: string; label: string; icon: IconName }[] = [
  { href: '/admin/users', label: 'Accounts', icon: 'users' },
  { href: '/admin/safety', label: 'Safety content', icon: 'edit' },
  { href: '/admin/support', label: 'Support', icon: 'bell' },
  { href: '/admin/alerts', label: 'Alert admin', icon: 'shield' },
]
// Help pages, open to everyone.
export const helpLinks: { href: string; label: string; icon: IconName }[] = [
  { href: '/faq', label: 'FAQ', icon: 'info' },
  { href: '/contact', label: 'Contact us', icon: 'phone' },
  { href: '/precautions', label: 'Emergency precautions', icon: 'shield' },
]

export function Logo({ dark = false }: { dark?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true">
        <rect width="36" height="36" rx="12" fill="#182B3A" />
        <circle cx="18" cy="18" r="9" fill="none" stroke="#F47755" strokeWidth="5.500" />
        <path d="M18 6.500v5m0 13v5M6.500 18h5m13 0h5" stroke="#F6F0E7" strokeWidth="3" />
        <circle cx="18" cy="18" r="2.600" fill="#E9B94D" />
      </svg>
      <span className={`font-display text-[22px] font-semibold tracking-tight ${dark ? 'text-white' : 'text-ink-900'}`}>VYRA</span>
    </span>
  )
}

// Drop-down group of links (desktop): "Help" for everyone, "Admin" for administrators. A real button with aria-expanded; closes on Escape, outside click and navigation.
function NavMenu({ label, icon, id, items, active }: { label: string; icon: IconName; id: string; items: { href: string; label: string; icon: IconName }[]; active: (href: string) => boolean }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const path = usePathname()
  const anyActive = items.some((l) => active(l.href))
  useEffect(() => setOpen(false), [path])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); box.current?.querySelector('button')?.focus() } }
    const onClick = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClick)
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onClick) }
  }, [open])
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-bold transition ${anyActive ? 'clay-inset text-ink-900' : 'text-ink-600 hover:bg-sand-200/70 hover:text-ink-900'}`}
      >
        <Icon name={icon} size={18} />
        {label}
        <Icon name="chevron" size={14} className={open ? 'rotate-180' : ''} />
      </button>
      {open && (
        <ul id={id} className="clay absolute left-0 top-full z-[1200] mt-2 w-60 space-y-1 p-2" style={{ borderRadius: 20 }}>
          {items.map((l) => (
            <li key={l.href}>
              <Link href={l.href} aria-current={active(l.href) ? 'page' : undefined} className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-bold hover:bg-sand-200/70 ${active(l.href) ? 'clay-inset' : ''}`}>
                <Icon name={l.icon} size={18} /> {l.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function SiteHeader() {
  const path = usePathname()
  const [open, setOpen] = useState(false)
  const { user } = useSession()
  const isAdmin = user?.role === 'admin'
  const navLinks = isAdmin ? [...links, ...staffLinks, ...adminLinks] : user?.role === 'responder' ? [...links, ...staffLinks] : links
  // Administrators have two more menus, so they switch to the burger menu at a wider screen.
  const bar = isAdmin ? { nav: 'hidden items-center gap-1 xl:flex', burger: 'btn-ghost btn-sm xl:hidden', panel: 'xl:hidden' } : { nav: 'hidden items-center gap-1 lg:flex', burger: 'btn-ghost btn-sm lg:hidden', panel: 'lg:hidden' }
  const active = (href: string) => path === href || path.startsWith(`${href}/`)

  return (
    <header className="sticky top-0 z-[1100] px-3 pt-3 sm:px-5">
      <div className="clay-sm mx-auto flex max-w-7xl items-center gap-2 px-3 py-2 sm:px-4" style={{ borderRadius: 24 }}>
        <Link href="/" aria-label="VYRA home" className="mr-1 shrink-0 rounded-xl p-1">
          <Logo />
        </Link>
        <nav className={`ml-3 ${bar.nav}`} aria-label="Main">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active(l.href) ? 'page' : undefined}
              className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-bold transition ${
                active(l.href) ? 'clay-inset text-ink-900' : 'text-ink-600 hover:bg-sand-200/70 hover:text-ink-900'
              }`}
            >
              <Icon name={l.icon} size={18} />
              {l.label}
            </Link>
          ))}
          {isAdmin && <NavMenu label="Admin" icon="users" id="admin-menu" items={adminLinks} active={active} />}
          <NavMenu label="Help" icon="info" id="help-menu" items={helpLinks} active={active} />
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {user ? (
            <span className="hidden items-center gap-2 text-sm sm:flex">
              <span className="max-w-[10rem] truncate font-bold" title={`${user.full_name} (${user.role})`}>{user.full_name}</span>
              <button type="button" onClick={() => signOut()} className="rounded-xl px-2.5 py-2 font-bold text-ink-700 underline decoration-2 underline-offset-4 hover:bg-sand-200/70">Sign out</button>
            </span>
          ) : (
            <Link href="/auth/login" className="hidden rounded-xl px-3 py-2 text-sm font-bold text-ink-700 hover:bg-sand-200/70 sm:block">
              Sign in
            </Link>
          )}
          <Link href="/report" className="btn-primary btn-sm">
            <Icon name="alert" size={18} />
            <span>Report<span className="hidden sm:inline"> an emergency</span></span>
          </Link>
          <button
            type="button"
            className={bar.burger}
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen((v) => !v)}
          >
            <Icon name={open ? 'close' : 'menu'} size={20} />
          </button>
        </div>
      </div>
      {open && (
        <nav id="mobile-nav" aria-label="Main" className={`clay mx-auto mt-2 max-w-7xl space-y-1 p-3 ${bar.panel}`} style={{ borderRadius: 22 }}>
          {navLinks.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              aria-current={active(l.href) ? 'page' : undefined}
              className={`flex items-center gap-3 rounded-xl px-4 py-3 font-bold ${active(l.href) ? 'clay-inset' : ''}`}
            >
              <Icon name={l.icon} />
              {l.label}
            </Link>
          ))}
          <p className="px-4 pt-2 text-xs font-bold uppercase tracking-widest text-ink-600">Help</p>
          {helpLinks.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              aria-current={active(l.href) ? 'page' : undefined}
              className={`flex items-center gap-3 rounded-xl px-4 py-3 font-bold ${active(l.href) ? 'clay-inset' : ''}`}
            >
              <Icon name={l.icon} />
              {l.label}
            </Link>
          ))}
          {user ? (
            <button type="button" onClick={() => { setOpen(false); signOut() }} className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left font-bold">
              <Icon name="user" /> Sign out ({user.full_name})
            </button>
          ) : (
            <Link href="/auth/login" onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-xl px-4 py-3 font-bold">
              <Icon name="user" /> Sign in
            </Link>
          )}
        </nav>
      )}
=======
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const links = [
  { href: '/report', label: 'Request help', urgent: true },
  { href: '/dashboard', label: 'Triage dashboard' },
  { href: '/map', label: 'Live map' },
  { href: '/resources', label: 'Resources' },
]

export default function SiteHeader() {
  const path = usePathname()
  return (
    <header className="sticky top-0 z-[1100] border-b border-gray-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 text-gray-900">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-600 font-black text-white">V</span>
          <span className="text-lg font-bold tracking-tight">VYRA</span>
        </Link>
        <nav className="flex gap-1 overflow-x-auto">
          {links.map((l) => {
            const active = path === l.href || path.startsWith(`${l.href}/`)
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${
                  active ? 'bg-primary-100 text-primary-800' : l.urgent ? 'text-red-700 hover:bg-red-50' : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {l.label}
              </Link>
            )
          })}
        </nav>
      </div>
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
    </header>
  )
}
