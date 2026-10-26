// "What should I do right now?": a deterministic, rule-based checklist built ONLY from the reviewed guide text.
// No AI is involved and nothing here is generated: the same answers always give the same checklist.
import { emergencyCallText, LIVE_INFO_NOTE } from './config'
import { INJURY_GENERAL } from './content/common'
import { getGuide } from './index'
import type { HazardId } from './types'

export type Situation = 'none' | 'trapped' | 'injured' | 'both'
export interface NowAnswers {
  hazard: HazardId | null
  danger: boolean // am I in immediate danger?
  situation: Situation
  waiting: boolean // have I reported and am waiting for rescue?
  online: boolean
}
export interface NowItem { id: string; text: string; tone: 'urgent' | 'action' | 'info'; link?: { href: string; label: string } }
export interface NowResult { urgent: boolean; items: NowItem[]; also: { id: HazardId; title: string; href: string }[]; notes: string[] }

export const DEFAULT_ANSWERS: NowAnswers = { hazard: null, danger: false, situation: 'none', waiting: false, online: true }

export function buildChecklist(a: NowAnswers): NowResult {
  const g = a.hazard ? getGuide(a.hazard) : null
  const items: NowItem[] = []
  const add = (id: string, text: string, tone: NowItem['tone'] = 'action', link?: NowItem['link']) => items.push({ id, text, tone, link })
  const trapped = a.situation === 'trapped' || a.situation === 'both'
  const injured = a.situation === 'injured' || a.situation === 'both'

  if (a.danger) {
    add('danger-1', 'You said you are in immediate danger. Get to the safest place you can reach, if you can do so safely.', 'urgent')
    add('danger-2', emergencyCallText(), 'urgent')
    g?.quick.danger.forEach((t, i) => add(`danger-h${i}`, t, 'urgent'))
    if (!g) add('danger-pick', 'Choose the type of disaster above to see specific actions.', 'info')
  }
  if (trapped) g?.quick.trapped.forEach((t, i) => add(`trapped-${i}`, t, a.danger ? 'urgent' : 'action'))
  if (trapped && !g) add('trapped-generic', 'Stay as still as you safely can, protect your nose and mouth from dust or smoke, and make noise in short bursts (tap or whistle) so rescuers can find you.')
  if (injured) {
    g?.quick.injured.forEach((t, i) => add(`injured-${i}`, t))
    INJURY_GENERAL.forEach((t, i) => add(`injured-g${i}`, t))
  }
  if (a.waiting) {
    // Never tell someone in danger to wait where they are.
    if (a.danger) add('waiting-danger', 'Do not wait where you are. Move to a safer place first, then wait there for rescue.', 'urgent')
    else g?.quick.waiting.forEach((t, i) => add(`waiting-${i}`, t))
    if (!g && !a.danger) add('waiting-generic', 'If where you are is safe, stay there unless officials tell you to move.')
  }
  if (!a.danger && !trapped && !injured && !a.waiting) {
    g?.quick.safe.forEach((t, i) => add(`safe-${i}`, t, 'info'))
    if (!g) add('safe-pick', 'Choose a disaster type to see what to do before, during and after it.', 'info')
  }

  // Always useful, any hazard.
  if (a.danger || trapped || injured || a.waiting) {
    add('common-location', 'When you call, say where you are, a nearby landmark, what has happened and how many people need help.')
    add('common-officials', 'Follow instructions from official emergency authorities. If they differ from this guide, follow them.')
    add('common-battery', 'Keep your phone with you and save battery: lower brightness and send short messages.')
  }
  if (a.online) add('online', 'Send or update your VYRA report so responders know where you are.', 'action', { href: '/report', label: 'Open report form' })
  else add('offline', 'You are offline. Your VYRA report is saved on this device and is sent when you reconnect. Call or send an SMS if you can. This checklist works offline.', 'info', { href: '/report', label: 'Open report form' })

  const notes = [LIVE_INFO_NOTE]
  if (!a.online) notes.push('Warnings and zones shown on the map may be old when you are offline.')
  const also = (g?.related ?? []).map((r) => getGuide(r)!).filter(Boolean).slice(0, 3).map((r) => ({ id: r.id, title: r.title, href: `/safety/${r.id}` }))
  return { urgent: a.danger, items, also, notes }
}
