'use client'
import { useEffect, useState } from 'react'
import Icon from '@/components/ui/Icon'
import { api } from '@/lib/client'
import { satApi, SatApiError } from '@/lib/satellite/client'
import { useSession } from '@/lib/session'
import { zoneApi } from '@/lib/zones/client'
import { LINK_TARGETS, LINK_TARGET_LABELS, type LinkTarget } from '@/lib/satellite/types'

export default function LinkPanel({ analysisId, onLinked, presetType, presetId }: { analysisId: string; onLinked: () => void; presetType?: LinkTarget; presetId?: string }) {
  const { user } = useSession()
  const [type, setType] = useState<LinkTarget>(presetType ?? 'report')
  const [targetId, setTargetId] = useState(presetId ?? '')
  const [note, setNote] = useState('')
  const [options, setOptions] = useState<{ id: string; label: string }[]>([])
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    setOptions([])
    if (type === 'report') api.listReports({ status: 'open' }).then((r) => alive && setOptions(r.reports.slice(0, 60).map((x) => ({ id: x.id, label: `#${x.id.slice(0, 8)} · ${x.area} · ${x.priority} urgency` })))).catch(() => {})
    if (type === 'zone') zoneApi.list(user, { hidden: true, full: true }).then((r) => alive && setOptions(r.zones.slice(0, 80).map((z) => ({ id: z.id, label: `${z.name} · ${z.hazard_type}` })))).catch(() => {})
    return () => { alive = false }
  }, [type, user])

  async function link() {
    setBusy(true); setMsg(null)
    try { await satApi.link(analysisId, { targetType: type, targetId, note }); setMsg({ ok: true, text: 'Linked. The record itself was not changed.' }); setNote(''); onLinked() }
    catch (e) { setMsg({ ok: false, text: e instanceof SatApiError ? e.message : 'Could not link.' }) }
    finally { setBusy(false) }
  }
  return (
    <div className="mt-3 grid gap-2">
      <div className="grid gap-2 sm:grid-cols-[11rem_1fr]">
        <div><label className="label" htmlFor="lt">Link to</label><select id="lt" className="input" value={type} onChange={(e) => { setType(e.target.value as LinkTarget); setTargetId('') }}>{LINK_TARGETS.map((t) => <option key={t} value={t}>{LINK_TARGET_LABELS[t]}</option>)}</select></div>
        <div>
          <label className="label" htmlFor="lid">{type === 'hazard' ? 'Hazard ID' : 'Record'}</label>
          {options.length > 0 ? <select id="lid" className="input" value={targetId} onChange={(e) => setTargetId(e.target.value)}><option value="">Choose...</option>{options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select> : <input id="lid" className="input" value={targetId} onChange={(e) => setTargetId(e.target.value)} placeholder={type === 'hazard' ? 'e.g. route_hazards:…' : 'Record ID'} />}
        </div>
      </div>
      <input className="input" aria-label="Link note" placeholder="Why is this relevant? (optional)" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      <button type="button" className="btn-ghost" disabled={busy || !targetId} onClick={link}><Icon name="check" size={18} /> {busy ? 'Linking...' : 'Link as advisory evidence'}</button>
      {msg && <p role="status" className={`text-sm font-semibold ${msg.ok ? 'text-success-700' : 'text-critical-700'}`}>{msg.text}</p>}
    </div>
  )
}
