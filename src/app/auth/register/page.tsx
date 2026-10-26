'use client'

<<<<<<< HEAD
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import AuthShell, { FieldError } from '@/components/auth/AuthShell'
import Icon from '@/components/ui/Icon'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// Nobody can choose their own role. Everyone starts as a citizen; asking for responder access only sends a
// request that an administrator approves (Accounts page). Administrators are never self-service.
type Role = 'citizen' | 'responder'

const ROLES: { value: Role; title: string; text: string }[] = [
  { value: 'citizen', title: 'Citizen', text: 'Ask for help and follow your reports.' },
  { value: 'responder', title: 'Request responder access', text: 'You start as a citizen. An administrator must approve responder access before you can use the dispatcher queue, map tools and missions.' },
]
=======
import { useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895

export default function RegisterPage() {
  const router = useRouter()
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    fullName: '',
<<<<<<< HEAD
    role: 'citizen' as Role,
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<'fullName' | 'email' | 'password' | 'confirmPassword', string>>>({})
  const errorRef = useRef<HTMLDivElement>(null)
  const [demo, setDemo] = useState(false)
  useEffect(() => {
    fetch('/api/demo/auth').then((r) => r.json()).then((d) => setDemo(!!d.demo)).catch(() => undefined)
  }, [])
  const set = (k: keyof typeof formData) => (e: React.ChangeEvent<HTMLInputElement>) => setFormData({ ...formData, [k]: e.target.value })

  const failWith = (message: string) => {
    setError(message)
    setTimeout(() => errorRef.current?.focus(), 0)
  }
  const mismatch = formData.confirmPassword.length > 0 && formData.password !== formData.confirmPassword
  const matches = formData.confirmPassword.length > 0 && formData.password === formData.confirmPassword

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    const errs: typeof fieldErrors = {}
    if (!formData.fullName.trim()) errs.fullName = 'Enter your full name.'
    if (!formData.email.trim()) errs.email = 'Enter your email address.'
    else if (!EMAIL_RE.test(formData.email.trim())) errs.email = 'Enter a valid email address, like name@example.com.'
    if (formData.password.length < 6) errs.password = 'Use at least 6 characters.'
    if (formData.password !== formData.confirmPassword) errs.confirmPassword = 'Passwords do not match.'
    setFieldErrors(errs)
    const firstBad = (['fullName', 'email', 'password', 'confirmPassword'] as const).find((k) => errs[k])
    if (firstBad) {
      document.getElementById(firstBad)?.focus()
      return
    }

    setLoading(true)
    try {
      if (demo) {
        const res = await fetch('/api/demo/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'register', email: formData.email, password: formData.password, full_name: formData.fullName, role: formData.role }) })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) return failWith(body.error || 'Registration failed.')
        router.push('/auth/login')
        return
      }
      // The browser never writes the profile or a role. The database creates a 'citizen' profile when the auth user
      // is created (migration 011), and "responder" is only a REQUEST that an administrator approves on the Accounts page.
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: formData.email.trim(),
        password: formData.password,
        options: { data: { full_name: formData.fullName.trim(), requested_role: formData.role === 'responder' ? 'responder' : undefined } },
      })

      if (authError) {
        failWith(authError.message)
=======
    role: 'citizen' as 'citizen' | 'responder' | 'admin'
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match')
      setLoading(false)
      return
    }

    try {
      // Create Supabase auth user
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: formData.email,
        password: formData.password
      })

      if (authError) {
        setError(authError.message)
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
        return
      }

      if (authData.user) {
<<<<<<< HEAD
        router.push('/auth/login')
      }
    } catch (err) {
      failWith('Registration failed. Check your connection and try again.')
=======
        // Create profile record
        const { error: profileError } = await supabase
          .from('profiles')
          .insert({
            id: authData.user.id,
            full_name: formData.fullName,
            email: formData.email,
            role: formData.role
          })

        if (profileError) {
          setError('Failed to create profile. Please try again.')
          return
        }

        // Redirect to login
        router.push('/auth/login')
      }
    } catch (err) {
      setError('Registration failed. Please try again.')
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
    } finally {
      setLoading(false)
    }
  }

  return (
<<<<<<< HEAD
    <AuthShell variant="register" title="Create your account" intro="It takes a minute. You can ask for help without an account too.">
      {error && (
        <div ref={errorRef} tabIndex={-1} role="alert" className="mb-5 flex items-start gap-2 rounded-2xl border-2 border-critical-700 bg-critical-100 p-3.5 text-[15px] font-bold outline-none">
          <Icon name="alert" size={18} className="mt-0.5 shrink-0" /> {error}
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        <div>
          <label htmlFor="fullName" className="label">Full name</label>
          <input id="fullName" type="text" autoComplete="name" value={formData.fullName} onChange={set('fullName')} className="input" aria-invalid={!!fieldErrors.fullName} aria-describedby={fieldErrors.fullName ? 'fullName-error' : undefined} />
          <FieldError id="fullName-error">{fieldErrors.fullName}</FieldError>
        </div>

        <div>
          <label htmlFor="email" className="label">Email address</label>
          <input id="email" type="email" autoComplete="email" value={formData.email} onChange={set('email')} className="input" placeholder="you@example.com" aria-invalid={!!fieldErrors.email} aria-describedby={fieldErrors.email ? 'email-error' : undefined} />
          <FieldError id="email-error">{fieldErrors.email}</FieldError>
        </div>

        <fieldset>
          <legend className="label">How will you use VYRA?</legend>
          <div className="grid gap-2.5">
            {ROLES.map((r) => (
              <label key={r.value} className="chip !items-start !py-3">
                <input type="radio" name="role" value={r.value} checked={formData.role === r.value} onChange={() => setFormData({ ...formData, role: r.value })} className="mt-0.5" />
                <span>
                  <span className="block font-bold">{r.title}</span>
                  <span className="block text-sm font-normal text-ink-700">{r.text}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <label htmlFor="password" className="label">Password</label>
          <input id="password" type="password" autoComplete="new-password" value={formData.password} onChange={set('password')} className="input" aria-invalid={!!fieldErrors.password} aria-describedby={fieldErrors.password ? 'password-error password-hint' : 'password-hint'} />
          <p id="password-hint" className="hint mt-1.5">At least 6 characters.</p>
          <FieldError id="password-error">{fieldErrors.password}</FieldError>
        </div>

        <div>
          <label htmlFor="confirmPassword" className="label">Confirm password</label>
          <input id="confirmPassword" type="password" autoComplete="new-password" value={formData.confirmPassword} onChange={set('confirmPassword')} className="input" aria-invalid={!!fieldErrors.confirmPassword || mismatch} aria-describedby="confirm-status" />
          <p id="confirm-status" className={`mt-1.5 flex items-center gap-1.5 text-sm font-semibold ${matches ? 'text-success-800' : mismatch ? 'text-critical-700' : 'sr-only'}`} aria-live="polite">
            {matches && <><Icon name="check" size={16} /> Passwords match.</>}
            {mismatch && <><Icon name="alert" size={16} /> Passwords do not match yet.</>}
          </p>
        </div>

        <button type="submit" disabled={loading} className="btn-primary w-full py-3.5 text-base">
          {loading ? 'Creating account...' : 'Create account'}
        </button>
      </form>

      <p className="mt-6 text-center text-ink-700">
        Already have an account?{' '}
        <Link href="/auth/login" className="font-bold text-ink-900 underline decoration-2 underline-offset-4">
          Sign in
        </Link>
      </p>
    </AuthShell>
=======
    <div className="min-h-screen bg-gradient-to-br from-teal-50 to-cyan-50 flex items-center justify-center px-4 py-8">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">ResQNet</h1>
          <p className="text-gray-600">Create your account</p>
        </div>

        <div className="bg-white rounded-lg shadow-lg p-8">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-red-600 text-sm">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="fullName" className="block text-sm font-medium text-gray-700 mb-2">
                Full Name
              </label>
              <input
                id="fullName"
                type="text"
                value={formData.fullName}
                onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none transition"
                placeholder="John Doe"
              />
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                Email Address
              </label>
              <input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none transition"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label htmlFor="role" className="block text-sm font-medium text-gray-700 mb-2">
                Role
              </label>
              <select
                id="role"
                value={formData.role}
                onChange={(e) => setFormData({ ...formData, role: e.target.value as any })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none transition"
              >
                <option value="citizen">Citizen</option>
                <option value="responder">Responder</option>
                <option value="admin">Administrator</option>
              </select>
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                required
                minLength={6}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none transition"
                placeholder="••••••••"
              />
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-2">
                Confirm Password
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={formData.confirmPassword}
                onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                required
                minLength={6}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none transition"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-teal-600 text-white py-3 rounded-lg font-semibold hover:bg-teal-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Creating account...' : 'Sign Up'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-gray-600">
              Already have an account?{' '}
              <Link href="/auth/login" className="text-teal-600 hover:text-teal-700 font-medium">
                Sign in
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
