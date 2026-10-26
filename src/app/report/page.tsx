'use client'

import { useState } from 'react'
<<<<<<< HEAD
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import SiteHeader from '@/components/common/SiteHeader'
import ReportForm from '@/components/reports/ReportForm'
import SavedConfirmation from '@/components/offline/SavedConfirmation'
import Icon from '@/components/ui/Icon'

// Emergency reporting. Reports are saved on the device first and synced when a connection exists.
export default function ReportPage() {
  const router = useRouter()
  const [queuedId, setQueuedId] = useState<string | null>(null)
  const [formKey, setFormKey] = useState(0)
  return (
    <div className="page">
      <SiteHeader />
      <main id="main" className="container-x py-8 sm:py-12">
        {queuedId ? (
          <SavedConfirmation clientId={queuedId} onAnother={() => { setQueuedId(null); setFormKey((k) => k + 1) }} />
        ) : (
          <>
            <header className="rise max-w-2xl">
              <h1 className="text-4xl font-semibold sm:text-5xl">Tell us what is happening</h1>
              <p className="mt-3 text-lg text-ink-700">
                Only the place is required. Answer what you can: it helps responders reach the most urgent cases first. This works without internet: reports are saved on your device and sent later.
              </p>
              <p className="mt-3 flex items-start gap-2 rounded-2xl bg-warning-100 p-3.5 text-[15px] font-semibold text-ink-900 lg:hidden">
                If a life is in danger and phones work, also call Rescue 1122.
              </p>
              <p className="mt-3 text-sm"><Link href="/report/saved" className="inline-flex items-center gap-1.5 font-bold underline"><Icon name="list" size={16} /> Reports saved on this device</Link></p>
            </header>
            <div className="rise rise-1 mt-8">
              <ReportForm key={formKey} onQueued={(r) => setQueuedId(r.client_id)} onReceived={(id) => router.push(`/report/${id}?sent=1`)} />
            </div>
          </>
        )}
=======
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import {
  QueuedReport,
  ReportPayload,
  findPossibleDuplicate,
  getQueuedReport,
  isIndexedDbAvailable,
  saveReport,
  syncQueue
} from '@/lib/offlineQueue'
import { useRouter } from 'next/navigation'
import SiteHeader from '@/components/common/SiteHeader'
import ReportForm from '@/components/reports/ReportForm'

// Stage 4 - Emergency Reporting System
export default function ReportPage() {
  const [formData, setFormData] = useState({
    locationAddress: '',
    locationLat: null as number | null,
    locationLng: null as number | null,
    peopleCount: 1,
    immediateDanger: false,
    injuryDetails: '',
    medicalNeeds: '',
    contactInfo: ''
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<'sent' | 'queued' | 'duplicate' | null>(null)
  const [possibleDuplicate, setPossibleDuplicate] = useState<QueuedReport | null>(null)

  const buildPayload = async (): Promise<ReportPayload> => {
    // getSession reads the locally stored session, so it also works offline
    let reporterId: string | null = null
    try {
      const { data } = await supabase.auth.getSession()
      reporterId = data.session?.user?.id ?? null
    } catch {
      reporterId = null
    }

    return {
      reporter_id: reporterId,
      location_lat: formData.locationLat,
      location_lng: formData.locationLng,
      location_address: formData.locationAddress,
      people_count: formData.peopleCount,
      immediate_danger: formData.immediateDanger,
      injury_details: formData.injuryDetails || null,
      medical_needs: formData.medicalNeeds || null,
      contact_info: formData.contactInfo || null
    }
  }

  const submitDirect = async (reportData: ReportPayload) => {
    const response = await fetch('/api/reports', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(reportData)
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(errorData.error || 'Failed to submit report')
    }
    setResult('sent')
  }

  const submit = async (skipDuplicateCheck: boolean) => {
    setLoading(true)
    setError('')

    try {
      const reportData = await buildPayload()

      if (!isIndexedDbAvailable()) {
        await submitDirect(reportData)
        return
      }

      if (!skipDuplicateCheck) {
        const duplicate = await findPossibleDuplicate(reportData)
        if (duplicate) {
          setPossibleDuplicate(duplicate)
          return
        }
      }
      setPossibleDuplicate(null)

      // Save on the device first so nothing is lost if the upload fails
      const entry = await saveReport(reportData)

      if (navigator.onLine) {
        await syncQueue()
      }
      const stored = await getQueuedReport(entry.client_id)
      if (stored?.status === 'failed') {
        throw new Error(stored.last_error || 'Failed to submit report')
      }
      setResult(stored?.status === 'synced' ? (stored.duplicate ? 'duplicate' : 'sent') : 'queued')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit report. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await submit(false)
  }

  const resetForm = () => {
    setFormData({
      locationAddress: '',
      locationLat: null,
      locationLng: null,
      peopleCount: 1,
      immediateDanger: false,
      injuryDetails: '',
      medicalNeeds: '',
      contactInfo: ''
    })
    setResult(null)
    setError('')
  }

  const handleGetLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setFormData({
            ...formData,
            locationLat: position.coords.latitude,
            locationLng: position.coords.longitude
          })
          setError('')
        },
        (error) => {
          setError('Unable to get your location. Please enter it manually.')
        }
      )
    } else {
      setError('Geolocation is not supported by your browser.')
    }
  }

  if (result) {
    const content = {
      sent: {
        title: 'Report Submitted',
        body: 'Your emergency report has been submitted successfully. Responders have been notified.',
        iconBg: 'bg-green-100',
        iconColor: 'text-green-600'
      },
      duplicate: {
        title: 'Report Already Received',
        body: 'This report had already reached responders, so it was not submitted twice.',
        iconBg: 'bg-green-100',
        iconColor: 'text-green-600'
      },
      queued: {
        title: 'Saved Offline',
        body:
          'You appear to be offline. Your report is saved on this device and will upload automatically as soon as a connection is available. Keep this page or app open if you can. If lives are at risk, also try calling emergency services.',
        iconBg: 'bg-yellow-100',
        iconColor: 'text-yellow-600'
      }
    }[result]

    return (
      <div className="min-h-screen bg-gradient-to-br from-teal-50 to-cyan-50 flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center">
          <div className={`w-16 h-16 ${content.iconBg} rounded-full flex items-center justify-center mx-auto mb-4`}>
            <svg className={`w-8 h-8 ${content.iconColor}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {result === 'queued' ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              )}
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">{content.title}</h2>
          <p className="text-gray-600 mb-6">{content.body}</p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={resetForm}
              className="px-6 py-3 bg-white text-teal-600 font-semibold rounded-lg border-2 border-teal-600 hover:bg-teal-50 transition-colors"
            >
              New Report
            </button>
            <Link
              href="/"
              className="inline-block px-6 py-3 bg-teal-600 text-white font-semibold rounded-lg hover:bg-teal-700 transition-colors"
            >
              Return Home
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const router = useRouter()
  return (
    <div className="page">
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 py-6">
        <h1 className="text-2xl font-bold">Request help</h1>
        <p className="mt-1 text-sm text-gray-600">
          Only the location is required. Answer what you can - it helps responders reach the most urgent cases first.
        </p>
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          If a life is in danger and phone lines work, also call your local emergency number (Rescue 1122).
        </div>

        <div className="bg-white rounded-lg shadow-lg p-8">
          <div className="mb-6">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Submit Emergency Report</h1>
            <p className="text-gray-600">
              Provide details about the emergency situation. Responders will be notified immediately. No connection? Your report is saved on this device and sent automatically once you are back online.
            </p>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-red-600 text-sm">{error}</p>
            </div>
          )}

          {possibleDuplicate && (
            <div className="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded-md" role="alert">
              <p className="text-yellow-800 text-sm font-medium mb-1">Possible duplicate report</p>
              <p className="text-yellow-700 text-sm mb-3">
                An identical report was saved on this device at{' '}
                {new Date(possibleDuplicate.created_at).toLocaleTimeString()} (
                {possibleDuplicate.status === 'synced' ? 'already uploaded' : 'waiting to upload'}). Submitting again
                may send responders the same case twice.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPossibleDuplicate(null)}
                  className="px-3 py-1.5 bg-white border border-yellow-300 text-yellow-800 rounded-md text-sm font-medium hover:bg-yellow-100"
                >
                  Don&apos;t submit
                </button>
                <button
                  type="button"
                  onClick={() => void submit(true)}
                  className="px-3 py-1.5 bg-yellow-600 text-white rounded-md text-sm font-medium hover:bg-yellow-700"
                >
                  Submit anyway
                </button>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Location
              </label>
              <div className="flex gap-2 mb-2">
                <button
                  type="button"
                  onClick={handleGetLocation}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm font-medium"
                >
                  📍 Use My Current Location
                </button>
              </div>
              <input
                type="text"
                value={formData.locationAddress}
                onChange={(e) => setFormData({ ...formData, locationAddress: e.target.value })}
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none transition"
                placeholder="Enter address or location description"
              />
            </div>

            <div>
              <label htmlFor="peopleCount" className="block text-sm font-medium text-gray-700 mb-2">
                Number of People Needing Assistance
              </label>
              <input
                id="peopleCount"
                type="number"
                min="1"
                value={formData.peopleCount}
                onChange={(e) => setFormData({ ...formData, peopleCount: parseInt(e.target.value) || 1 })}
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none transition"
              />
            </div>

            <div className="flex items-center">
              <input
                id="immediateDanger"
                type="checkbox"
                checked={formData.immediateDanger}
                onChange={(e) => setFormData({ ...formData, immediateDanger: e.target.checked })}
                className="w-4 h-4 text-teal-600 border-gray-300 rounded focus:ring-teal-500"
              />
              <label htmlFor="immediateDanger" className="ml-2 text-sm text-gray-700">
                Immediate danger to life (fire, flooding, structural collapse, etc.)
              </label>
            </div>

            <div>
              <label htmlFor="injuryDetails" className="block text-sm font-medium text-gray-700 mb-2">
                Injury Details (Optional)
              </label>
              <textarea
                id="injuryDetails"
                value={formData.injuryDetails}
                onChange={(e) => setFormData({ ...formData, injuryDetails: e.target.value })}
                rows={3}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none transition"
                placeholder="Describe any injuries or immediate medical concerns"
              />
            </div>

            <div>
              <label htmlFor="medicalNeeds" className="block text-sm font-medium text-gray-700 mb-2">
                Medical Needs (Optional)
              </label>
              <textarea
                id="medicalNeeds"
                value={formData.medicalNeeds}
                onChange={(e) => setFormData({ ...formData, medicalNeeds: e.target.value })}
                rows={3}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none transition"
                placeholder="Essential medications, medical equipment, or special care requirements"
              />
            </div>

            <div>
              <label htmlFor="contactInfo" className="block text-sm font-medium text-gray-700 mb-2">
                Contact Information (Optional)
              </label>
              <input
                id="contactInfo"
                type="text"
                value={formData.contactInfo}
                onChange={(e) => setFormData({ ...formData, contactInfo: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none transition"
                placeholder="Phone number or way to reach you"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-teal-600 text-white py-3 rounded-lg font-semibold hover:bg-teal-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Submitting...' : 'Submit Emergency Report'}
            </button>
          </form>
        <div className="mt-4">
          <ReportForm onSubmitted={(report) => router.push(`/report/${report.id}?sent=1`)} />
        </div>
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
      </main>
    </div>
  )
}
