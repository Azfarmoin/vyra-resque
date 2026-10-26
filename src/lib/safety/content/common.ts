import type { Step } from '../types'

export const PHASE_INFO = {
  before: { label: 'BEFORE', sub: 'Prepare in advance', glyph: '1' },
  during: { label: 'DURING', sub: 'Immediate safety actions', glyph: '2' },
  waiting: { label: 'WHILE WAITING FOR RESCUE', sub: 'After you have reported, before help arrives', glyph: '3' },
  after: { label: 'AFTER', sub: 'Recovery and continued safety', glyph: '4' },
} as const

// Shown at the top of every "waiting for rescue" section. Immediate safety always comes first.
export const WAITING_SAFETY_FIRST =
  'First: is where you are safe right now? If not, move to the safest place you can reach and follow official evacuation instructions. Never wait in a place that is actively dangerous.'

// Appended to the default waiting scenario of EVERY hazard. Each step is safe for all hazards.
export const WAITING_COMMON: Step[] = [
  {
    id: 'common-tell', title: 'Tell responders exactly where you are', scene: 'phone',
    do: ['Give your location, a nearby landmark, what has happened, and how many people need help.', 'Say who is injured, trapped, a child, or an older person.', 'Keep your phone with you and answer calls from unknown numbers: it may be a rescuer.'],
    dont: ['Do not keep the line busy with calls that are not needed.'],
    remember: 'If your phone has no signal, move only if the move is safe. Do not walk into danger to find signal.',
  },
  {
    id: 'common-battery', title: 'Save your phone battery', scene: 'phone',
    do: ['Lower screen brightness and close apps you do not need.', 'Use low-power or airplane mode between calls, and switch back on to check messages at set times.', 'Send short messages instead of long calls when the network is weak.'],
    dont: ['Do not use your phone torch or games for long periods.'],
  },
  {
    id: 'common-norescue', title: 'Do not go into danger to rescue someone', scene: 'keepback',
    do: ['Tell responders where the person is and what you saw.', 'Throw or reach with an object only if you are standing on firm, safe ground.'],
    dont: ['Do not enter floodwater, a burning building, a collapsed structure or a hazardous area to attempt a rescue.', 'Do not touch fallen power lines or electrical equipment that is wet.'],
    remember: 'Rescuers are trained and equipped. A second victim makes the rescue harder.',
  },
]

// Condition-independent first aid line used by the checklist. Kept minimal on purpose.
export const INJURY_GENERAL = [
  'Do not move an injured person unless staying put is dangerous (for example fire, rising water or a collapsing structure).',
  'If someone is bleeding heavily, press firmly on the wound with a clean cloth and keep pressing.',
  'Tell emergency services about every injury and whether the person is awake and breathing.',
]
