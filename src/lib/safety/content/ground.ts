import { CHECKED, S, SRC } from './helpers'
import { WAITING_COMMON } from './common'
import type { HazardGuide } from '../types'

export const earthquake: HazardGuide = {
  id: 'earthquake', title: 'Earthquakes and aftershocks', short: 'Drop, Cover and Hold On. Stay put until the shaking stops.', icon: 'pulse', group: 'ground',
  keywords: ['earthquake', 'quake', 'shaking', 'aftershock', 'tremor', 'seismic'],
  scope: 'During and after shaking. If you are on a coast, also see Tsunamis. After a collapse, see Building collapse.',
  before: [
    S('b1', 'Find your safe spots', 'dropcover', ['Pick a sturdy table or desk in each room, away from windows, mirrors and heavy furniture that can fall.', 'Practise Drop, Cover and Hold On with your family.'], ['Do not choose a spot under a heavy shelf or hanging light.']),
    S('b2', 'Make your home safer', 'checkhome', ['Fix tall furniture and heavy items to walls. Keep heavy items on low shelves.', 'Learn where the gas, electricity and water shut-offs are.'], ['Do not store heavy objects above beds.']),
    S('b3', 'Pack a kit and a plan', 'kit', ['Water, medicines, a torch, a whistle, a power bank, documents.', 'Agree where to meet if you are separated.'], ['Do not keep the kit where a fallen cupboard could block it.']),
    S('b4', 'Plan for everyone', 'family', ['Plan how children, older adults and people with disabilities will protect themselves and get out.'], ['Do not assume everyone can drop to the floor quickly.']),
  ],
  during: [
    S('d1', 'Drop, Cover and Hold On', 'dropcover', ['DROP to your hands and knees. COVER your head and neck, under a sturdy table if you can. HOLD ON until the shaking stops.', 'If you are in bed, stay there and cover your head with a pillow.', 'If you use a wheelchair, lock the wheels and cover your head and neck.'], ['Do not run outside while the ground is shaking.', 'Do not stand in a doorway unless you know it is strong.'], 'Most injuries come from falling objects and from people trying to move during shaking.'),
    S('d2', 'Stay away from glass and falling objects', 'dropcover', ['Move away from windows, mirrors, shelves and hanging objects only if it is a few steps.'], ['Do not use the lift (elevator).'], 'You may find the power goes out or alarms and sprinklers come on.'),
    S('d3', 'If you are outside', 'exitdoor', ['Move to a clear area away from buildings, trees, street lights and wires, then drop, cover and hold on.'], ['Do not stand next to walls, signs, balconies or poles.']),
    S('d4', 'If you are in a vehicle', 'roadside', ['Pull over to a clear spot and stop. Stay inside with your seat belt on until shaking stops.'], ['Do not stop on or under bridges, overpasses, trees or power lines.']),
  ],
  waiting: [
    { id: 'trapped', label: 'Trapped under debris', when: 'You cannot get out', steps: [
      S('w1', 'Protect your breathing and stay still', 'dustmask', ['Cover your nose and mouth with a cloth to keep out dust.', 'Move as little as possible.'], ['Do not kick or shout hard: it raises dust.', 'Do not light a match or lighter: there may be gas.']),
      S('w2', 'Signal so rescuers can find you', 'tap', ['Tap on a pipe, wall or hard surface, or blow a whistle, in short bursts, then listen.', 'Call or text if your phone works.'], ['Do not keep shouting: save your energy and avoid breathing in dust.']),
      ...WAITING_COMMON,
    ] },
    { id: 'outside', label: 'Outside in the open', when: 'You are out and aftershocks may come', steps: [
      S('w3', 'Stay in the open, away from damaged buildings', 'keepback', ['Stay in a clear open area away from walls, trees and wires.', 'If an aftershock comes, drop, cover and hold on.'], ['Do not go back inside to collect things.', 'Do not enter a damaged building to look for others.']),
      ...WAITING_COMMON,
    ] },
    { id: 'shelter', label: 'At a shelter or gathering point', when: 'You are in a designated shelter or open gathering point', steps: [
      S('w4', 'Stay until officials say it is safe', 'shelter', ['Register with staff, stay with family and keep your phone charged.'], ['Do not go back to a damaged home until it has been checked.']),
    ] },
  ],
  after: [
    S('a1', 'Expect aftershocks', 'dropcover', ['Every time you feel an aftershock, drop, cover and hold on.', 'Leave damaged buildings and stay out.'], ['Do not go back into a damaged building.']),
    S('a2', 'Check for injuries and hazards', 'firstaid', ['Check yourself and others. Get medical help for injuries.', 'If you smell gas, leave at once and call for help from outside. Do not use switches or flames.'], ['Do not use matches or lighters. Do not touch fallen wires.']),
    S('a3', 'Only enter when authorities confirm safe', 'checkhome', ['Wait for qualified people to check your home.', 'Follow official advice on water, food and returning.'], ['Do not enter cracked or leaning buildings.']),
    S('a4', 'Coast and report', 'wave', ['If you are on a coast and felt strong shaking, move inland and uphill (see Tsunamis).', 'Report new hazards through VYRA when it is safe.'], ['Do not wait for a warning if the sea pulls back.']),
  ],
  quick: {
    danger: ['If it is shaking: Drop, Cover and Hold On. Do not run outside.', 'When it stops, leave a damaged building by the safest exit. Do not use the lift.', 'On a coast: after strong shaking go inland and uphill at once.'],
    trapped: ['Cover your nose and mouth with cloth. Do not light a match.', 'Tap on a pipe or wall or blow a whistle in short bursts. Avoid shouting and kicking up dust.'],
    injured: ['Do not move the person unless the structure is collapsing or there is fire or gas.', 'Keep them still and call emergency services.'],
    waiting: ['Stay in an open area away from damaged buildings and expect aftershocks (drop, cover and hold on).', 'Do not go back inside.'],
    safe: ['Secure heavy furniture, pick safe spots, keep a kit.', 'Practise Drop, Cover and Hold On.'],
  },
  related: ['collapse', 'tsunami', 'fire', 'landslide'],
  sources: [SRC.nycQuake, SRC.cdphQuake, SRC.readyQuake, SRC.usgs, SRC.ndma], content_checked_on: CHECKED, expert_reviewed: null,
}

export const collapse: HazardGuide = {
  id: 'collapse', title: 'Building collapse and structural damage', short: 'Get out of damaged buildings. If trapped, stay still, cover your mouth and signal.', icon: 'alert', group: 'ground',
  keywords: ['collapse', 'building', 'structural', 'cracks', 'rubble', 'trapped', 'debris', 'wall'],
  scope: 'Collapsed or cracked buildings, walls and bridges, with or without an earthquake.',
  before: [
    S('b1', 'Watch for warning signs', 'checkhome', ['Report new cracks, leaning walls, sagging floors or doors that suddenly stick.', 'Ask a qualified engineer to inspect before using the building.'], ['Do not ignore signs because the building has stood for years.']),
    S('b2', 'Know your exits', 'exitdoor', ['Learn two ways out of every building you use. Keep exits clear.'], ['Do not block stairs or exits with stored items.']),
    S('b3', 'Do not overload', 'checkhome', ['Do not add floors or remove walls without engineering advice.'], ['Do not store heavy loads on weak floors or roofs.']),
    S('b4', 'Carry a whistle', 'kit', ['Keep a whistle and a small torch with your bag. Save a cloth you can cover your nose with.'], ['Do not rely on shouting to be found.']),
  ],
  during: [
    S('d1', 'Get out if the exit is clear and it is safe', 'exitdoor', ['If you notice cracking, falling plaster or shaking and can reach an exit safely, leave and move well away.', 'Take the stairs.'], ['Do not use the lift.', 'Do not run through areas where things are falling.']),
    S('d2', 'If you cannot get out, protect yourself', 'dropcover', ['Get under strong furniture and cover your head and neck.'], ['Do not stand under heavy lights, shelves or unsupported walls.']),
    S('d3', 'Once outside, keep back', 'keepback', ['Move well away from the building and from falling glass and debris.'], ['Do not stand near the building or go back in.'], 'More parts can fall after the first collapse.'),
  ],
  waiting: [
    { id: 'trapped', label: 'Trapped inside rubble or a damaged building', when: 'You cannot get out', steps: [
      S('w1', 'Protect your breathing and stay still', 'dustmask', ['Cover your nose and mouth with a cloth.', 'Stay still unless something is about to fall on you. Move only a little.'], ['Do not kick, shout hard or move rubble: you can cause it to shift and raise dust.', 'Do not light a match or lighter.']),
      S('w2', 'Signal rescuers', 'tap', ['Tap on a pipe, wall or hard surface, or blow a whistle, in short bursts, then listen.', 'Call or text with your phone if it works, and say where you are.'], ['Do not shout for long periods.']),
      ...WAITING_COMMON,
    ] },
    { id: 'outside', label: 'Outside, waiting for rescue teams', when: 'You got out or are a bystander', steps: [
      S('w3', 'Stay back and keep the way clear', 'keepback', ['Stay far from the damaged structure. Keep the access route clear for responders.', 'Tell responders how many people are missing and where they were last seen.'], ['Do not go in or dig by hand to reach someone.', 'Do not move injured people unless there is immediate danger such as fire or further collapse.'], 'Rescuers use special training and tools to avoid causing a second collapse.'),
      ...WAITING_COMMON,
    ] },
  ],
  after: [
    S('a1', 'Stay out until it is declared safe', 'checkhome', ['Do not enter until qualified authorities confirm it is safe.'], ['Do not go in to recover belongings.']),
    S('a2', 'Watch for gas and electrical hazards', 'gasleak', ['If you smell gas, move away and call for help from outside.', 'Keep away from broken wires.'], ['Do not use switches, flames or lighters near a possible gas leak.']),
    S('a3', 'Get medical help', 'firstaid', ['Get checked for injuries, even if you feel fine. Crush injuries and dust inhalation can be serious.'], ['Do not ignore chest pain, breathing trouble or numbness.']),
    S('a4', 'Report it', 'phone', ['Report unsafe buildings and blocked roads through VYRA when it is safe.'], ['Do not post unverified claims about who is trapped.']),
  ],
  quick: {
    danger: ['If the exit is clear, get out and move well away from the building. Use stairs, not the lift.', 'If you cannot get out, get under strong furniture and cover your head and neck.'],
    trapped: ['Cover your nose and mouth with cloth. Stay as still as you can.', 'Tap on a pipe or wall or use a whistle in short bursts. Do not light a match.'],
    injured: ['Do not move the person unless fire or further collapse threatens them.', 'Call emergency services and say how many people are hurt and where.'],
    waiting: ['Stay well back from the damaged building and keep the route clear for rescuers.', 'Do not go in or dig yourself: tell responders who is missing and where.'],
    safe: ['Report cracks and leaning walls. Know two exits. Keep a whistle.'],
  },
  related: ['earthquake', 'electrical', 'chemical'],
  sources: [SRC.nycQuake, SRC.cdphQuake, SRC.readyQuake, SRC.redCross, SRC.ndma], content_checked_on: CHECKED, expert_reviewed: null,
}

export const landslide: HazardGuide = {
  id: 'landslide', title: 'Landslides and mudslides', short: 'Move out of the slide path, to stable ground. Do not go back.', icon: 'alert', group: 'ground',
  keywords: ['landslide', 'mudslide', 'debris flow', 'hillside', 'slope', 'rockfall'],
  scope: 'Steep slopes, valleys and roads below hillsides, especially during or after heavy rain.',
  before: [
    S('b1', 'Know your slope risk', 'slope', ['Ask local authorities whether your home or road is below an unstable slope.', 'Learn a route away from the slide path.'], ['Do not build or camp at the foot of a steep slope or in a drainage channel.']),
    S('b2', 'Know the warning signs', 'slope', ['New cracks in the ground or walls, tilting trees or poles, sudden muddy streams, or a rumbling sound are warnings.', 'Report them to the authorities.'], ['Do not ignore a stream that suddenly turns muddy or stops flowing.']),
    S('b3', 'Follow rain warnings', 'listen', ['Heavy or long rain raises the risk. Follow official warnings and evacuation orders.'], ['Do not stay on a risky slope because the rain has paused.']),
    S('b4', 'Kit and plan', 'kit', ['Water, medicines, a torch, documents, a whistle, and a meeting point away from slopes.'], ['Do not keep the kit where a slide could block the door.']),
  ],
  during: [
    S('d1', 'Move out of the path now', 'slope', ['Get away from the slide path to stable, higher ground, moving sideways out of the path rather than straight down it.', 'Warn others as you go.'], ['Do not run down the channel of a slide.', 'Do not stop to collect belongings.'], 'Slides can move faster than you can run. Leave early.'),
    S('d2', 'If you cannot escape', 'dropcover', ['Curl into a tight ball and protect your head.'], ['Do not stand still in the open path.']),
    S('d3', 'In a vehicle', 'roadside', ['Watch the road for fallen rocks, mud and debris. Stop only in a safe place away from the slope.'], ['Do not drive across mud or debris.']),
  ],
  waiting: [
    { id: 'safe', label: 'On stable ground, away from the slide', when: 'You have moved out of the path', steps: [
      S('w1', 'Stay out of the slide area', 'keepback', ['Stay on stable ground well clear of the slide and the slope above it.', 'Warn others to keep away.'], ['Do not go back to look or to collect things.', 'Do not walk onto the debris to reach someone.'], 'More material can come down without warning.'),
      ...WAITING_COMMON,
    ] },
    { id: 'house', label: 'In a building that cannot be left', when: 'You cannot leave safely', steps: [
      S('w2', 'Move to the part of the building away from the slope', 'storm', ['Go to an upper floor or the side of the building facing away from the slope, if it is strong.', 'Keep away from windows.'], ['Do not go into the room facing the slope.']),
      ...WAITING_COMMON,
    ] },
  ],
  after: [
    S('a1', 'Stay away from the slide area', 'keepback', ['Stay out until the authorities say it is safe. More slides can follow.'], ['Do not walk onto loose earth or debris.']),
    S('a2', 'Help from a safe distance', 'phone', ['Tell rescuers about anyone missing and where they were.'], ['Do not try to dig by hand.']),
    S('a3', 'Watch for floods and damage', 'wire', ['A slide can block a stream and cause a flood later. Stay clear of broken wires and damaged roads.'], ['Do not cross damaged bridges or roads.']),
    S('a4', 'Report and recover', 'firstaid', ['Report damaged roads, blocked streams and cracks through VYRA when safe.', 'Get medical help for injuries.'], ['Do not return home until it has been checked.']),
  ],
  quick: {
    danger: ['Move out of the slide path now, to stable higher ground, sideways rather than down the channel.', 'Do not stop for belongings. If you cannot escape, curl into a ball and protect your head.'],
    trapped: ['Protect your head. Cover your nose and mouth. Call or text your location.', 'Tap or use a whistle to be found.'],
    injured: ['Do not walk onto the slide to reach people. Call emergency services and tell them where the person is.'],
    waiting: ['Stay well clear of the slide and the slope above it: more can fall.', 'Do not go back.'],
    safe: ['Know the warning signs: new cracks, tilting trees, muddy streams, rumbling.', 'Follow rain warnings and evacuation orders.'],
  },
  related: ['flood', 'earthquake', 'road'],
  sources: [SRC.readyWiLandslide, SRC.readyLandslide, SRC.ndma, SRC.pmd], content_checked_on: CHECKED, expert_reviewed: null,
}
