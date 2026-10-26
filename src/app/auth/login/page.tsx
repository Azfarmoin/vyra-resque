'use client'

<<<<<<< HEAD
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import AuthShell, { FieldError } from '@/components/auth/AuthShell'
import Icon from '@/components/ui/Icon'
import { saveSession } from '@/lib/session'
import { isHome, type SessionUser } from '@/lib/demoAccounts'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
=======
import { useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
<<<<<<< HEAD
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({})
  const errorRef = useRef<HTMLDivElement>(null)
  const [demo, setDemo] = useState<{ password: string; accounts: { email: string; full_name: string; role: string; blurb: string }[] } | null>(null)

  useEffect(() => {
    fetch('/api/demo/auth')
      .then((r) => r.json())
      .then((d) => d.demo && setDemo(d))
      .catch(() => undefined)
  }, [])

  const failWith = (message: string) => {
    setError(message)
    setTimeout(() => errorRef.current?.focus(), 0)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    // Clear, specific messages instead of the browser's generic bubbles.
    const errs: { email?: string; password?: string } = {}
    if (!email.trim()) errs.email = 'Enter your email address.'
    else if (!EMAIL_RE.test(email.trim())) errs.email = 'Enter a valid email address, like name@example.com.'
    if (!password) errs.password = 'Enter your password.'
    setFieldErrors(errs)
    if (errs.email || errs.password) {
      document.getElementById(errs.email ? 'email' : 'password')?.focus()
      return
    }

    setLoading(true)
    try {
      // Demo mode: sign in against the demo accounts instead of Supabase.
      if (demo) {
        const res = await fetch('/api/demo/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) return failWith(body.error || 'Sign in failed.')
        saveSession(body.user as SessionUser)
        router.push(isHome(body.user.role))
        return
      }
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })

      if (authError) {
        failWith(authError.message)
=======
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password
      })

      if (authError) {
        setError(authError.message)
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
        return
      }

      // Get user profile to determine redirect
      if (data.user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', data.user.id)
          .single()

        // Redirect based on role
        if (profile?.role === 'responder' || profile?.role === 'admin') {
          router.push('/dashboard')
        } else {
          router.push('/')
        }
      }
    } catch (err) {
<<<<<<< HEAD
      failWith('Sign in failed. Check your connection and try again.')
=======
      setError('Login failed. Please try again.')
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
    } finally {
      setLoading(false)
    }
  }

  return (
<<<<<<< HEAD
    <AuthShell variant="login" title="Sign in" intro="Use the email and password you registered with.">
      {error && (
        <div ref={errorRef} tabIndex={-1} role="alert" className="mb-5 flex items-start gap-2 rounded-2xl border-2 border-critical-700 bg-critical-100 p-3.5 text-[15px] font-bold outline-none">
          <Icon name="alert" size={18} className="mt-0.5 shrink-0" /> {error}
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        <div>
          <label htmlFor="email" className="label">Email address</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={!!fieldErrors.email}
            aria-describedby={fieldErrors.email ? 'email-error' : undefined}
            className="input"
            placeholder="you@example.com"
          />
          <FieldError id="email-error">{fieldErrors.email}</FieldError>
        </div>

        <div>
          <label htmlFor="password" className="label">Password</label>
          <div className="relative">
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={!!fieldErrors.password}
              aria-describedby={fieldErrors.password ? 'password-error' : undefined}
              className="input !pr-14"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-pressed={showPassword}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-xl p-2 text-ink-700 hover:bg-sand-200"
            >
              <Icon name="eye" size={20} />
            </button>
          </div>
          <FieldError id="password-error">{fieldErrors.password}</FieldError>
        </div>

        <button type="submit" disabled={loading} className="btn-primary w-full py-3.5 text-base">
          {loading ? 'Signing in...' : 'Sign in'}
        </button>
      </form>

      <p className="mt-6 text-center text-ink-700">
        New to VYRA?{' '}
        <Link href="/auth/register" className="font-bold text-ink-900 underline decoration-2 underline-offset-4">
          Create an account
        </Link>
      </p>

      {demo && (
        <section className="clay-inset mt-6 p-4" aria-labelledby="demo-accounts" style={{ borderRadius: 22 }}>
          <h2 id="demo-accounts" className="text-lg font-semibold">Demo accounts</h2>
          <p className="mt-1 text-sm text-ink-700">Demo mode is on. These accounts live only in this demo. Pick one to fill the form; the password is <code className="rounded bg-sand-200 px-1.5 py-0.5 font-bold">{demo.password}</code>.</p>
          <ul className="mt-3 space-y-2">
            {demo.accounts.map((a) => (
              <li key={a.email}>
                <button type="button" onClick={() => { setEmail(a.email); setPassword(demo.password); setFieldErrors({}) }} className="flex w-full items-center justify-between gap-3 rounded-2xl bg-sand-50 px-3.5 py-2.5 text-left hover:bg-white focus-visible:bg-white">
                  <span><span className="block font-bold">{a.full_name} <span className="font-normal text-ink-600">· {a.role}</span></span><span className="block text-sm text-ink-700">{a.email} · {a.blurb}</span></span>
                  <Icon name="arrow" size={16} className="shrink-0" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </AuthShell>
=======
    <div className="min-h-screen bg-gradient-to-br from-teal-50 to-cyan-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">ResQNet</h1>
          <p className="text-gray-600">Sign in to your account</p>
        </div>

        <div className="bg-white rounded-lg shadow-lg p-8">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-red-600 text-sm">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                Email Address
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none transition"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none transition"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-teal-600 text-white py-3 rounded-lg font-semibold hover:bg-teal-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-gray-600">
              Don&apos;t have an account?{' '}
              <Link href="/auth/register" className="text-teal-600 hover:text-teal-700 font-medium">
                Sign up
              </Link>
            </p>
          </div>
        </div>

        <div className="mt-6 text-center">
          <Link href="/" className="text-gray-600 hover:text-gray-900 text-sm">
            ← Back to Home
          </Link>
        </div>
      </div>
    </div>
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
  )
}
