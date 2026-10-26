// Content for /precautions. Kept in one place so it is easy to review and update.
//
// Two kinds of information are kept apart on the page, and must stay apart here:
//   1. OFFICIAL_CONTACTS - phone numbers. Only numbers read from an official government page are listed,
//      each with its source and the date it was checked. Anything not checked is NOT listed as a number.
//   2. PRECAUTIONS - general safety guidance. It is common, widely published advice, not an instruction
//      from any authority. During a real event, official instructions always come first.
//
// To add a number: read it from the authority's own page, then add it with `source`, `sourceUrl` and
// `checked`. Never copy a number from a blog, a forum or memory.

export const CONTENT_REVIEWED = '2026-10-24' // general guidance; each phone number carries its own `checked` date

export interface OfficialContact {
  name: string
  number: string
  use: string
  /** What the source page actually says, and what it does not say. */
  note: string
  source: string
  sourceUrl: string
  checked: string
  /** Other official pages that list the same number. */
  alsoListedBy?: { source: string; sourceUrl: string }[]
}

export const OFFICIAL_CONTACTS: OfficialContact[] = [
  {
    name: 'Rescue 1122',
    number: '1122',
    use: 'Medical emergencies, road crashes, fires, building collapse, and water and flood emergencies.',
    note: 'The Punjab page names it the Punjab Emergency Service number without listing districts. PDMA Sindh also lists it as its "Rescue Helpline". Neither page says which districts are covered, so if a call does not connect, try another emergency line.',
    source: 'Rescue 1122, Emergency Services Department, Government of the Punjab',
    sourceUrl: 'https://rescue.gov.pk/',
    checked: '2026-10-25',
    alsoListedBy: [{ source: 'PDMA Sindh, Government of Sindh', sourceUrl: 'https://pdma.gos.pk/' }],
  },
  {
    name: 'PDMA Sindh helpline',
    number: '1736',
    use: 'Disaster-related helpline of the Provincial Disaster Management Authority, Sindh.',
    note: 'Shown on the PDMA Sindh home page as "PDMA Helpline" and "Emergency". The page does not say what hours it is staffed.',
    source: 'PDMA Sindh, Government of Sindh',
    sourceUrl: 'https://pdma.gos.pk/',
    checked: '2026-10-25',
  },
  {
    name: 'Police',
    number: '15',
    use: 'Crime, danger to life, and incidents that need the police.',
    note: 'Listed as the Punjab Police number, and as "Sindh Police Madadgar" on the Government of Sindh page. The pages do not give coverage areas.',
    source: 'Lahore Police, Government of the Punjab (police helplines)',
    sourceUrl: 'https://lahorepolice.punjab.gov.pk/node/22',
    checked: '2026-10-25',
    alsoListedBy: [{ source: 'Government of Sindh, emergency contacts', sourceUrl: 'https://www.sindh.gov.pk/emergency-contacts' }],
  },
  {
    name: 'Edhi Ambulance Service',
    number: '115',
    use: 'Ambulance. A charity service, listed on a Government of Sindh page.',
    note: 'The page lists it without a region. VYRA has not checked the charity\'s own site.',
    source: 'Government of Sindh, emergency contacts',
    sourceUrl: 'https://www.sindh.gov.pk/emergency-contacts',
    checked: '2026-10-25',
  },
  {
    name: 'Aman Foundation ambulance',
    number: '+92 (21) 1021',
    use: 'Ambulance. A private foundation, listed on a Government of Sindh page.',
    note: 'The page lists it without a region. VYRA has not checked the foundation\'s own site.',
    source: 'Government of Sindh, emergency contacts',
    sourceUrl: 'https://www.sindh.gov.pk/emergency-contacts',
    checked: '2026-10-25',
  },
]

/** Official bodies to check for numbers and instructions that VYRA has not verified. These are links, not phone numbers. */
export const OFFICIAL_SOURCES_TO_CHECK = [
  { name: 'Rescue 1122', url: 'https://rescue.gov.pk/', note: 'Emergency service pages' },
  { name: 'PDMA Sindh', url: 'https://pdma.gos.pk/', note: 'Alerts and helplines for Sindh.' },
  { name: 'Government of Sindh: emergency contacts', url: 'https://www.sindh.gov.pk/emergency-contacts', note: 'More services; the page may list more than are shown here.' },
  { name: 'Provincial Disaster Management Authority (Punjab PDMA)', url: 'https://www.pdma.gov.pk', note: 'Alerts and instructions for Punjab. For other provinces, use your own provincial authority.' },
]

export type PrecautionIcon = 'home' | 'droplet' | 'flame' | 'pulse' | 'wave' | 'road' | 'heart'

export interface PrecautionGroup {
  heading: string
  tone?: 'do' | 'avoid'
  items: string[]
}

export interface PrecautionCategory {
  id: string
  title: string
  icon: PrecautionIcon
  summary: string
  groups: PrecautionGroup[]
}

export const PRECAUTIONS: PrecautionCategory[] = [
  {
    id: 'preparedness',
    title: 'General emergency preparedness',
    icon: 'home',
    summary: 'A few minutes of preparation makes every other emergency easier to handle.',
    groups: [
      {
        heading: 'Prepare ahead',
        tone: 'do',
        items: [
          'Save the emergency numbers you have confirmed for your area, in your phone and on paper.',
          'Agree with your household on a meeting place and on how you will contact each other if phone lines are busy.',
          'Pack a small bag: drinking water, non-perishable food, a torch, spare batteries or a power bank, any regular medicines, a first-aid kit, copies of important documents.',
          'Learn the evacuation routes and the official shelters announced for your neighbourhood by your local authorities.',
          'Keep your phone charged when severe weather is forecast, and follow official alerts.',
        ],
      },
      {
        heading: 'When an emergency starts',
        tone: 'do',
        items: [
          'Follow official evacuation orders and instructions straight away, even if your own street looks calm.',
          'Check on people near you who may need help to leave, such as older people, young children and people with disabilities, but only if you can do it safely.',
          'Send a VYRA report if you need help, and keep your phone on and charged so responders can reach you.',
        ],
      },
      {
        heading: 'Avoid',
        tone: 'avoid',
        items: [
          'Waiting to see whether things get worse before leaving, once an evacuation has been ordered.',
          'Spreading unconfirmed claims about which roads, buildings or shelters are safe.',
        ],
      },
    ],
  },
  {
    id: 'flood',
    title: 'Floods and rising water',
    icon: 'droplet',
    summary: 'Water can rise fast and hide hazards. Move to higher ground early rather than late.',
    groups: [
      {
        heading: 'Do',
        tone: 'do',
        items: [
          'Move to higher ground as soon as you are told to, or as soon as water starts rising near you.',
          'Switch off electricity and gas at the main switch only if you can reach it without standing in water.',
          'If you are trapped, go to the highest safe level you can reach and call emergency services or send a VYRA report with your location. Do not climb into a closed attic with no way out.',
          'Boil or treat drinking water after a flood unless officials say your supply is safe.',
        ],
      },
      {
        heading: 'Avoid',
        tone: 'avoid',
        items: [
          'Walking, swimming or driving through floodwater. It can be deeper and faster than it looks, and can carry sewage, debris and live electrical current.',
          'Touching electrical equipment, wires or poles that are wet or in water. Keep well away from downed power lines.',
          'Crossing flooded roads, bridges or streams, even if others are doing it.',
          'Going back to your home before officials say it is safe to return.',
        ],
      },
    ],
  },
  {
    id: 'fire',
    title: 'Fires and smoke',
    icon: 'flame',
    summary: 'Smoke is often more dangerous than flames. Get out first, then call for help.',
    groups: [
      {
        heading: 'Do',
        tone: 'do',
        items: [
          'Leave immediately, closing doors behind you if you can do so without delay. Closed doors slow fire and smoke.',
          'Stay low where the air is clearer. Cover your nose and mouth with a damp cloth if you can.',
          'Before opening a door, feel it with the back of your hand. If it is hot, do not open it; use another way out or signal from a window.',
          'Once outside, move away from the building, stay out, and call the emergency number from a safe place.',
          'If clothes catch fire: stop, drop to the ground and roll to smother the flames.',
        ],
      },
      {
        heading: 'Avoid',
        tone: 'avoid',
        items: [
          'Going back inside for belongings, pets or people. Tell the fire service who may still be inside.',
          'Using lifts during a fire.',
          'Trying to fight a fire that is spreading, that is larger than a small contained flame, or that blocks your exit.',
          'Using water on an electrical or oil fire.',
        ],
      },
    ],
  },
  {
    id: 'earthquake',
    title: 'Earthquakes and aftershocks',
    icon: 'pulse',
    summary: 'During shaking, protect yourself where you are. Expect aftershocks afterwards.',
    groups: [
      {
        heading: 'During shaking',
        tone: 'do',
        items: [
          'Drop to your hands and knees, take cover under a sturdy table or desk if there is one, or cover your head and neck with your arms, and hold on until the shaking stops.',
          'Stay away from windows, mirrors, heavy furniture and anything that could fall.',
          'If you are outside, move away from buildings, walls, trees, lamp posts and power lines.',
          'If you are in a vehicle, stop in a clear spot away from bridges, overpasses and power lines, and stay inside until the shaking stops.',
        ],
      },
      {
        heading: 'After the shaking stops',
        tone: 'do',
        items: [
          'Expect aftershocks. Drop, cover and hold on again each time.',
          'If you smell gas or hear hissing, leave and warn others, and do not use matches, lighters or switches.',
          'Use text messages instead of calls when you can, to keep phone lines free for emergencies.',
          'Follow official instructions about whether to stay put or evacuate.',
        ],
      },
      {
        heading: 'Avoid',
        tone: 'avoid',
        items: [
          'Running out of a building during the shaking, or using the stairs or lifts while it shakes.',
          'Re-entering a building that is cracked, leaning or damaged until a qualified person has said it is safe.',
          'Standing under a doorway thinking it is safer; take cover under sturdy furniture instead.',
        ],
      },
    ],
  },
  {
    id: 'storm',
    title: 'Severe weather and storms',
    icon: 'wave',
    summary: 'Heavy rain, lightning and strong wind can arrive quickly. Shelter early and stay informed.',
    groups: [
      {
        heading: 'Do',
        tone: 'do',
        items: [
          'Go indoors into a sturdy building when thunder is heard or a storm warning is issued. A parked vehicle with a hard roof is better than being outside.',
          'Stay away from windows, and bring in or secure loose objects if you have time.',
          'Charge your phone and torch, and follow official weather alerts.',
          'In a heatwave, drink water regularly, avoid the hottest part of the day, and check on people at risk.',
        ],
      },
      {
        heading: 'Avoid',
        tone: 'avoid',
        items: [
          'Sheltering under isolated trees, towers, poles or metal fences, or standing in open ground, on high ground or near water during lightning.',
          'Driving through heavy rain or flooded roads. If visibility is very low, pull over somewhere safe.',
          'Touching fallen wires or anything in contact with them.',
          'Going out to look at the storm or to take photos.',
        ],
      },
    ],
  },
  {
    id: 'landslide',
    title: 'Landslides and structural damage',
    icon: 'road',
    summary: 'Slopes and damaged buildings can fail without warning, especially after heavy rain or shaking.',
    groups: [
      {
        heading: 'Warning signs of a landslide',
        tone: 'do',
        items: [
          'New cracks in the ground, slope, walls or pavement; tilting trees, poles or fences; doors and windows that suddenly stick.',
          'Unusual sounds such as rumbling, cracking or a sudden change in water flow in a stream.',
          'If you see these signs, move away from the slope and its downhill path now, and tell your local authorities.',
        ],
      },
      {
        heading: 'Do',
        tone: 'do',
        items: [
          'Move to a safe place away from the slope, ideally to higher, stable ground on the side away from the path of the slide.',
          'If you cannot leave, curl up and protect your head.',
          'Keep clear of the area after a landslide: more material can still move.',
          'Report blocked roads, damaged bridges and collapsed buildings to the authorities from a safe distance.',
        ],
      },
      {
        heading: 'Avoid',
        tone: 'avoid',
        items: [
          'Entering or standing near buildings that are cracked, leaning, partly collapsed or that have lost walls or floors, until a qualified person has said they are safe.',
          'Crossing a river or road that may be undercut or washed out.',
          'Treating a route, building or place as safe because it looks fine. Damage is often hidden.',
        ],
      },
    ],
  },
  {
    id: 'firstaid',
    title: 'First aid and immediate danger',
    icon: 'heart',
    summary: 'Keep yourself safe first. First aid does not replace a trained medic or emergency services.',
    groups: [
      {
        heading: 'First: danger',
        tone: 'do',
        items: [
          'Check that the place is safe for you before helping anyone. A second casualty does not help the first.',
          'Call emergency services and give your exact location, what has happened, and how many people are hurt. Stay on the line if you are told to.',
          'Contact trained emergency responders for anyone who is trapped, in water, in a damaged building or near fire. Wait for them.',
        ],
      },
      {
        heading: 'Basic first aid (if you are able to help safely)',
        tone: 'do',
        items: [
          'Heavy bleeding: press firmly and continuously on the wound with a clean cloth. Add more cloth on top if it soaks through; do not remove the first.',
          'Not breathing or no response: call emergency services and follow their instructions. If you are trained, start CPR.',
          'Burns: cool the burn under clean, cool running water for about 20 minutes. Remove rings and watches from the area before it swells. Cover loosely with a clean non-fluffy cloth.',
          'Keep an injured or unwell person warm and calm, and keep watching their breathing until help arrives.',
        ],
      },
      {
        heading: 'Avoid',
        tone: 'avoid',
        items: [
          'Entering floodwater, a burning building, a damaged structure or any other dangerous area to rescue someone. Call trained rescuers and give them your location.',
          'Moving someone with a possible neck or back injury, unless they are in immediate danger.',
          'Giving food or drink to someone who is drowsy, confused or unconscious.',
          'Applying ice, butter or creams to burns.',
        ],
      },
    ],
  },
]

export const DISCLAIMER =
  'VYRA does not replace emergency services or professional rescue teams. If someone is in danger, call the emergency number for your area. A VYRA report may take time to reach a responder and is not a guarantee that help is on its way.'
