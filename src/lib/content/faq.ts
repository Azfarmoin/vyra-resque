// Content for /faq. Every answer describes what VYRA actually does today (checked against the code:
// the report form, /report/[id] status page, the map's verified layers, the triage engine).
// If a feature changes, update the matching answer. Links are internal pages only.

export type FaqCategoryId = 'using' | 'reports' | 'ai' | 'privacy' | 'safety'

export const FAQ_CATEGORIES: { id: FaqCategoryId; label: string }[] = [
  { id: 'using', label: 'Using VYRA' },
  { id: 'reports', label: 'Emergency reports' },
  { id: 'ai', label: 'AI analysis' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'safety', label: 'Emergency safety' },
]

export interface FaqLink {
  href: string
  label: string
}

export interface FaqItem {
  id: string
  category: FaqCategoryId
  question: string
  /** Plain text paragraphs. */
  answer: string[]
  links?: FaqLink[]
}

export const FAQ_ITEMS: FaqItem[] = [
  // ---- Using VYRA
  {
    id: 'what-is-vyra',
    category: 'using',
    question: 'What is VYRA?',
    answer: [
      'VYRA helps people ask for help during a disaster and helps responders decide which cases to reach first. People send reports, responders see the most urgent cases at the top of a queue with the reasons for the ranking, and they can assign rescue teams.',
      'VYRA is a coordination tool. It is not an emergency phone line and it does not replace emergency services.',
    ],
    links: [{ href: '/report', label: 'Report an emergency' }],
  },
  {
    id: 'need-account',
    category: 'using',
    question: 'Do I need an account to ask for help?',
    answer: [
      'No. Anyone can send an emergency report without signing in. An account is mainly for responders and administrators, who use the dispatcher queue, missions and supplies pages.',
    ],
    links: [{ href: '/auth/register', label: 'Create an account' }, { href: '/auth/login', label: 'Sign in' }],
  },
  {
    id: 'shelters',
    category: 'using',
    question: 'How do I find shelters?',
    answer: [
      'Open the live map and switch on the shelters layer. The map only shows shelters that VYRA staff have marked as verified. A shelter that is not on the map may still exist, and one that is on the map may have changed since it was last checked.',
      'Capacity and occupancy shown on the map are what was last recorded and may be out of date. Follow instructions from local authorities about where to go.',
    ],
    links: [{ href: '/map', label: 'Open the live map' }, { href: '/precautions', label: 'Emergency precautions' }],
  },
  {
    id: 'blocked-roads',
    category: 'using',
    question: 'How do I see blocked roads?',
    answer: [
      'The live map has a layer for blocked roads and hazards. Only verified road blocks are displayed, so a missing marker does not mean a road is open or safe.',
      'Do not assume any route is safe because VYRA does not show a problem on it. Roads can flood, collapse or be blocked at any time. Follow official guidance and avoid crossing floodwater.',
    ],
    links: [{ href: '/map', label: 'Open the live map' }],
  },
  {
    id: 'offline',
    category: 'using',
    question: 'What happens if my internet connection drops while I report?',
    answer: [
      'The report form saves your answers as you type on your device, and a report sent while you are offline is queued on your device and sent when the connection returns. A small status indicator shows when reports are waiting.',
      'A queued report has not reached responders yet. If a life is in danger, use a phone call if lines are working.',
    ],
    links: [{ href: '/report', label: 'Open the report form' }],
  },

  // ---- Emergency reports
  {
    id: 'submit-report',
    category: 'reports',
    question: 'How do I submit an emergency report?',
    answer: [
      'Choose "Report an emergency", then share your location. Only the location is required. You can then answer what you can about the dangers around you, injuries, medical needs, how many people are with you and whether you can evacuate, and optionally leave a name and phone number.',
      'When you send the report, VYRA shows a reference number. Save it: it is how you look up the status of your report later.',
    ],
    links: [{ href: '/report', label: 'Report an emergency' }],
  },
  {
    id: 'upload-pictures',
    category: 'reports',
    question: 'Can I upload pictures with my report?',
    answer: [
      'Not at the moment. The report form does not accept photos or other files. Describe what you see in the text fields instead, for example the type of danger, the water level, or visible damage.',
    ],
    links: [{ href: '/report', label: 'Report an emergency' }],
  },
  {
    id: 'report-status',
    category: 'reports',
    question: 'How do I see the status of my report?',
    answer: [
      'After you send a report you are taken to its status page, which shows your reference number and the current status: New, Investigating, Team assigned, Resolved, or Cancelled / duplicate. Open that page again from the link you were given to check progress.',
      'The status page shows only the reference, status and area. It does not show contact details, and it is not a live tracker of a rescue team.',
    ],
    links: [{ href: '/report', label: 'Send a report' }],
  },
  {
    id: 'response-time',
    category: 'reports',
    question: 'How quickly will someone respond?',
    answer: [
      'VYRA cannot promise a response time. Responders work through the most urgent cases first and can only send teams that are available and can reach you safely. Waiting time is one of the factors in the ranking, so a case moves up the queue the longer it waits.',
      'If a life is in danger and phones work, also call the emergency number for your area.',
    ],
    links: [{ href: '/precautions', label: 'Emergency numbers and safety' }],
  },
  {
    id: 'report-problem',
    category: 'reports',
    question: 'I made a mistake in my report, or my situation has changed. What can I do?',
    answer: [
      'Reports cannot be edited after they are sent. Send a new report with the correct information, and contact support with your first report’s reference number so the duplicate can be marked.',
      'If the emergency is over, you can also tell support so responders can close the case.',
    ],
    links: [{ href: '/contact', label: 'Contact support' }, { href: '/report', label: 'Send a new report' }],
  },

  // ---- AI analysis
  {
    id: 'how-ranking',
    category: 'ai',
    question: 'How does VYRA decide which reports are urgent?',
    answer: [
      'VYRA scores each report using the answers given: dangers present, injuries, medical needs, vulnerable people, whether people can evacuate, and how long the report has been waiting. Responders can see which factors raised the score and by how much, so a ranking can be questioned.',
      'The ranking is a rule-based aid for responders. A responder can change any ranking and has to give a reason, and the change is kept in the case history.',
    ],
  },
  {
    id: 'ai-accuracy',
    category: 'ai',
    question: 'How accurate is the AI analysis?',
    answer: [
      'Automated findings can be wrong. The ranking only reflects what a person typed into the report, which may be incomplete, mistaken or out of date. It can place a serious case too low or a minor case too high.',
      'Responders review and can override the result, but neither the ranking nor any automated finding should be treated as a fact or as a decision about whether someone gets help. It must never replace official emergency guidance, your own judgement of danger, or a call to emergency services.',
    ],
    links: [{ href: '/precautions', label: 'Emergency precautions' }],
  },
  {
    id: 'ai-low-priority',
    category: 'ai',
    question: 'My report was ranked low. Does that mean I am safe?',
    answer: [
      'No. A low ranking only means that, based on the answers given, other cases looked more urgent at that moment. It is not an assessment that you are safe.',
      'If your situation gets worse, send a new report and call emergency services if you can.',
    ],
    links: [{ href: '/report', label: 'Send an updated report' }, { href: '/contact', label: 'Contact support' }],
  },

  // ---- Privacy
  {
    id: 'who-sees-data',
    category: 'privacy',
    question: 'Who can see my report and my contact details?',
    answer: [
      'Contact details are for responders only. The person who sent a report sees its reference number, status and area. Public pages, such as the home page preview, show cases without addresses or contact details.',
      'Responders and administrators can see the details of a report to do their work.',
    ],
  },
  {
    id: 'location',
    category: 'privacy',
    question: 'Why does VYRA need my location?',
    answer: [
      'Responders need to know where help is needed. You can share your device location or choose a place on the map yourself. Only the location is required to send a report.',
    ],
    links: [{ href: '/report', label: 'Report an emergency' }],
  },
  {
    id: 'support-privacy',
    category: 'privacy',
    question: 'What happens to what I write in the Contact us form?',
    answer: [
      'Support requests are saved in VYRA’s database and shown to VYRA administrators on an admin page. If you are signed in, you can only see your own requests. VYRA does not send emails: you get a reference ID on screen when your request is saved.',
      'The email address is optional and only for reference. Do not put passwords or other secrets in your message. For emergencies, do not use the contact form: use an emergency report or call emergency services.',
    ],
    links: [{ href: '/contact', label: 'Contact support' }],
  },
  {
    id: 'privacy-concern',
    category: 'privacy',
    question: 'I have a privacy concern. How do I raise it?',
    answer: ['Use the Contact us form and choose "Privacy concern" as the category. Include your report reference if it is about a report.'],
    links: [{ href: '/contact', label: 'Contact support' }],
  },

  // ---- Emergency safety
  {
    id: 'replace-services',
    category: 'safety',
    question: 'Does VYRA replace emergency services?',
    answer: [
      'No. VYRA does not replace emergency services or professional rescue teams. If someone is in danger, call the emergency number for your area, and follow instructions from official authorities.',
    ],
    links: [{ href: '/precautions', label: 'Emergency numbers and safety' }],
  },
  {
    id: 'what-to-do',
    category: 'safety',
    question: 'What should I do in a flood, fire or earthquake?',
    answer: [
      'The Emergency Precautions page has short guidance for general preparedness, floods, fires, earthquakes, storms, landslides and first aid. It is general guidance, not an official instruction. Official evacuation orders and instructions always come first.',
    ],
    links: [{ href: '/precautions', label: 'Emergency precautions' }],
  },
  {
    id: 'rescue-someone',
    category: 'safety',
    question: 'Should I go into a dangerous area to rescue someone?',
    answer: [
      'No. Do not enter floodwater, damaged buildings, burning buildings or other dangerous places to rescue someone. Call trained emergency responders, give them the exact location, and wait somewhere safe. You can also send a VYRA report for the person.',
    ],
    links: [{ href: '/precautions#firstaid', label: 'First aid and immediate danger' }, { href: '/report', label: 'Report an emergency' }],
  },
  {
    id: 'is-it-safe',
    category: 'safety',
    question: 'Can VYRA tell me whether a road, building or place is safe?',
    answer: [
      'No. VYRA does not certify any road, building, shelter or area as safe. The map shows reports and verified markers, but the absence of a marker is not evidence of safety. Use official instructions and your own judgement.',
    ],
    links: [{ href: '/map', label: 'Live map' }],
  },
]

/** Lower-case text of a question used for searching (question, answer text, category label). */
export const faqSearchText = (item: FaqItem) =>
  `${item.question} ${item.answer.join(' ')} ${FAQ_CATEGORIES.find((c) => c.id === item.category)?.label ?? ''}`.toLowerCase()

/** Items matching every word of the query, within an optional category. Pure, so it is unit-tested. */
export function filterFaq(items: FaqItem[], query: string, category: FaqCategoryId | 'all' = 'all'): FaqItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  return items.filter((i) => (category === 'all' || i.category === category) && words.every((w) => faqSearchText(i).includes(w)))
}
