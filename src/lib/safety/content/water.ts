import { CHECKED, S, SRC } from './helpers'
import { WAITING_COMMON } from './common'
import type { HazardGuide } from '../types'

export const flood: HazardGuide = {
  id: 'flood', title: 'Floods and flash floods', short: 'Rivers, streams and sudden water rising fast. Move up and away from water.', icon: 'droplet', group: 'water',
  keywords: ['flood', 'flash flood', 'river', 'rising water', 'dam', 'drowning', 'monsoon', 'water'],
  scope: 'River, stream and flash floods. For flooded city streets and drains, also see Urban flooding.',
  before: [
    S('b1', 'Know where floods happen near you', 'route', ['Find out if your home, work and school are in a flood-prone area.', 'Learn two routes to higher ground and where the nearest shelter is.'], ['Do not assume a route is open: roads can flood.'], 'Write the routes down. Phones can fail.'),
    S('b2', 'Pack a flood kit', 'kit', ['Drinking water, medicines, a torch, a power bank, a whistle.', 'Put documents and cash in a waterproof bag.', 'Keep the kit upstairs or on a high shelf.'], ['Do not store the kit in a basement or low room.']),
    S('b3', 'Follow official warnings', 'listen', ['Follow the national weather and disaster authorities for your area.', 'Know the difference: a watch means flooding is possible; a warning means take action now.'], ['Do not rely on social media rumours.'], undefined, 'Warnings change quickly. Check again before travelling.'),
    S('b4', 'Plan for everyone', 'family', ['Agree a meeting point. Plan how to move children, older adults, people with disabilities and pets.', 'Save emergency contacts on paper and on your phone.'], ['Do not leave the slowest-moving person for last.']),
  ],
  during: [
    S('d1', 'Move to higher ground now', 'highground', ['If flooding is possible where you are, go up and away from the water immediately.', 'Follow official evacuation orders.'], ['Do not wait to see how bad it gets.', 'Do not camp or park beside rivers or streams in heavy rain.'], 'Flash floods can arrive with little warning.'),
    S('d2', 'Never walk through floodwater', 'nowade', ['Stay out of moving water and standing floodwater.', 'Turn around and find another way.'], ['Do not walk, swim or drive through floodwater.'], 'Just 15 cm (6 in) of moving water can knock an adult over.'),
    S('d3', 'Never drive through floodwater', 'floodcar', ['Turn around at flooded roads.', 'If water rises around your car and is not moving, leave the car and go to higher ground if you can do so safely.'], ['Do not drive around barriers.', 'Do not leave the car into moving water.'], '60 cm (2 ft) of moving water can carry away most vehicles. Depth and current are hard to judge.'),
    S('d4', 'Keep away from electricity', 'wire', ['Stay away from fallen wires and anything electrical that is in or near water.', 'Switch off power at the main switch only if the switch is dry, you are standing on dry ground and you have been told to.'], ['Do not touch electrical equipment if you are wet or standing in water.']),
  ],
  waiting: [
    { id: 'high', label: 'On higher ground or an upper floor', when: 'You have reported and are above the water', steps: [
      S('w1', 'Stay above the water, away from the current', 'highground', ['Stay on the higher ground or upper floor you reached.', 'Move higher if the water keeps rising toward you.', 'Stay away from windows and doors facing moving water.'], ['Do not go back down to collect belongings.', 'Do not enter water to reach other people or things.'], 'If you must go higher, a roof is better than a closed attic: a closed attic can trap you if water keeps rising.'),
      S('w2', 'Make yourself seen only where it is safe', 'signal', ['Wave a bright cloth or use a torch from a safe window or roof, away from the edge.', 'Use a whistle in short bursts.'], ['Do not lean out or climb to a point where you could fall into the water.']),
      ...WAITING_COMMON,
    ] },
    { id: 'car', label: 'Stuck in a vehicle', when: 'Your car is surrounded by water', steps: [
      S('w3', 'If the water is not moving, leave for higher ground', 'floodcar', ['If water is rising but not moving and you can reach higher ground safely, leave the car and go there.', 'If you cannot leave safely, climb onto the roof of the car and call for help.'], ['Do not step out into moving water.', 'Do not stay inside if water is rising fast around the car.'], 'Tell emergency services your road name and direction.'),
      ...WAITING_COMMON,
    ] },
    { id: 'shelter', label: 'At an evacuation shelter', when: 'You are in a shelter or safe building', steps: [
      S('w4', 'Stay at the shelter until officials say it is safe', 'shelter', ['Register with shelter staff and tell them about medical needs.', 'Stay together with your family and keep your phone charged.', 'Follow announcements.'], ['Do not leave to check your home until authorities say it is safe.']),
    ] },
  ],
  after: [
    S('a1', 'Return home only when told it is safe', 'checkhome', ['Wait for official confirmation before going back.', 'Check for cracks, leaning walls and weakened floors before entering.'], ['Do not enter a building that looks damaged or still has water inside until it has been checked.']),
    S('a2', 'Avoid floodwater and wear protection', 'cleanup', ['Wear boots and gloves when cleaning. Wash hands often with safe water and soap.', 'Treat all floodwater as dirty: it can contain sewage, chemicals and sharp objects.'], ['Do not let children play in floodwater.']),
    S('a3', 'Electricity, water and food', 'wire', ['Have wet electrical systems checked by a qualified person before use.', 'Follow official advice about drinking water and food. Throw away food that touched floodwater.'], ['Do not use wet appliances or switch on power in a flooded room.']),
    S('a4', 'Get care and report new hazards', 'firstaid', ['Get medical help for wounds, fever, diarrhoea or any concerning symptoms.', 'Report new hazards (blocked roads, damaged bridges, live wires) through VYRA when it is safe to do so.'], ['Do not ignore a small cut that was in floodwater.']),
  ],
  quick: {
    danger: ['Move to higher ground now, away from the water. Do not wait for the water to reach you.', 'Do not walk, swim or drive through floodwater.', 'Keep away from fallen wires and wet electrical equipment.'],
    trapped: ['Go up: to the highest safe floor or the roof. Do not shelter in a closed attic.', 'Signal from a safe spot and stay away from the current.'],
    injured: ['Stay above the water. Do not enter the water to get help or to move the person unless staying is more dangerous.'],
    waiting: ['Stay on the higher ground or upper floor. Move higher if the water rises.', 'Do not go into the water to reach anyone.'],
    safe: ['Keep a kit ready and know two routes to higher ground.', 'Follow official warnings and evacuation orders for your area.'],
  },
  related: ['urban-flood', 'electrical', 'landslide'],
  sources: [SRC.readyFloods, SRC.nwsFlood, SRC.cdcFlood, SRC.ndma, SRC.pmd], content_checked_on: CHECKED, expert_reviewed: null,
}

export const urbanFlood: HazardGuide = {
  id: 'urban-flood', title: 'Urban flooding and heavy rainfall', short: 'Flooded streets, drains and underpasses. Water can hide open manholes.', icon: 'droplet', group: 'water',
  keywords: ['urban flood', 'heavy rain', 'rainfall', 'drain', 'manhole', 'underpass', 'street', 'inundation', 'monsoon', 'karachi'],
  scope: 'City streets, low-lying neighbourhoods, basements and underpasses during heavy rain.',
  before: [
    S('b1', 'Prepare your home', 'checkhome', ['Make sure roofs and windows are sealed. Clear gutters and drains near your home.', 'Secure loose items outside that wind could blow away.'], ['Do not block drains with rubbish.'], undefined, 'This follows NDMA advice issued for Karachi during heavy rain.'),
    S('b2', 'Know your flood-prone streets', 'route', ['Learn which roads, underpasses and low areas flood near you.', 'Plan alternative routes that avoid them.'], ['Do not park in an underpass or low area when heavy rain is forecast.']),
    S('b3', 'Keep supplies upstairs', 'kit', ['Water, medicines, torch, power bank, documents in a waterproof bag.'], ['Do not keep important items on the floor of a ground-floor room.']),
    S('b4', 'Watch official alerts', 'listen', ['Follow weather alerts from the meteorological and disaster authorities, including the NDMA Disaster Alert app if available.'], ['Do not travel in heavy rain unless you have to.']),
  ],
  during: [
    S('d1', 'Avoid flooded roads and underpasses', 'nowade', ['Use another route. Move to a higher floor or higher ground if water is entering your building.', 'Leave basements and low rooms as soon as water starts coming in.'], ['Do not walk, swim or drive through flooded water.', 'Do not enter a flooded underpass or basement.'], 'Floodwater can hide open manholes, deep holes and debris.'),
    S('d2', 'Keep out of the water', 'floodcar', ['If your vehicle is surrounded by water that is not moving, leave it and move to higher ground if safe.'], ['Do not drive around barriers or through standing water.']),
    S('d3', 'Electricity and wet hands', 'wire', ['Unplug appliances if it is safe to do so while dry.', 'Stay away from fallen wires, poles and wet electrical equipment.'], ['Do not touch electrical equipment with wet hands or while standing in water.']),
  ],
  waiting: [
    { id: 'upper', label: 'Inside a building', when: 'You are in a building, above the water', steps: [
      S('w1', 'Stay on an upper floor', 'highground', ['Move to the highest floor, away from basements and from windows facing the water.', 'Keep your kit and phone with you.'], ['Do not go out to look at the water or help others in the water.'], 'Water in the street can rise quickly and hide open manholes.'),
      ...WAITING_COMMON,
    ] },
    { id: 'car', label: 'In a vehicle', when: 'You are in a car in the flood', steps: [
      S('w2', 'Leave the car if the water is not moving and higher ground is close', 'floodcar', ['Leave the car for higher ground only if the water is still and you can do so safely.', 'Otherwise stay on the car roof and call for help.'], ['Do not step into moving water.']),
      ...WAITING_COMMON,
    ] },
  ],
  after: [
    S('a1', 'Treat the water as dirty', 'cleanup', ['Wear boots and gloves; wash hands with safe water and soap.', 'Boil or treat drinking water if officials tell you to.'], ['Do not drink or cook with water that may be contaminated.'], 'Floodwater in cities often mixes with sewage.'),
    S('a2', 'Check electricity before using it', 'wire', ['Ask a qualified electrician to check wet wiring and appliances.'], ['Do not switch on power in a wet room.']),
    S('a3', 'Check on neighbours', 'checkon', ['Check on older neighbours and people who live alone, from a safe place.'], ['Do not enter flooded areas to do so.']),
    S('a4', 'Report new hazards', 'phone', ['Report open manholes, blocked roads and fallen wires through VYRA when you are safe.'], ['Do not try to fix electrical or drain hazards yourself.']),
  ],
  quick: {
    danger: ['Get to an upper floor or higher ground away from the water.', 'Leave basements and underpasses immediately.', 'Do not walk, swim or drive through floodwater: it can hide open manholes.'],
    trapped: ['Go to the highest floor or roof you can reach safely. Call for help and say your floor and street.'],
    injured: ['Stay out of the water. Call for help and keep the person where they are unless the water is rising toward them.'],
    waiting: ['Stay on an upper floor away from windows facing the water.', 'Do not go outside to look or to help in the water.'],
    safe: ['Avoid flooded streets and underpasses. Keep drains near your home clear.', 'Unplug appliances and keep wet hands away from electricity.'],
  },
  related: ['flood', 'electrical', 'road'],
  sources: [SRC.ndmaKarachi, SRC.readyFloods, SRC.nwsFlood, SRC.cdcFlood], content_checked_on: CHECKED, expert_reviewed: null,
}

export const tsunami: HazardGuide = {
  id: 'tsunami', title: 'Tsunamis', short: 'Near the coast: strong shaking or a receding sea means go inland and uphill at once.', icon: 'wave', group: 'water',
  keywords: ['tsunami', 'coast', 'sea', 'wave', 'earthquake at sea', 'beach', 'surge'],
  scope: 'Relevant only on or near sea coasts. If you live far inland, a tsunami guide does not apply to you. Check official local guidance for your coast.',
  before: [
    S('b1', 'Know if you live in a tsunami zone', 'route', ['Ask your local disaster authority whether your home, school or work is in a tsunami hazard zone.', 'Learn the way to high ground or inland, on foot.'], ['Do not plan to drive: roads can jam or be blocked.']),
    S('b2', 'Know the natural warning signs', 'wave', ['Strong or long shaking near the coast, the sea suddenly pulling back, or a loud roar from the sea are warnings.', 'If you see or feel these, move at once.'], ['Do not wait for an official warning if you see the natural signs.']),
    S('b3', 'Keep a go-bag', 'kit', ['Water, medicines, a torch, documents, a power bank, a whistle.'], ['Do not go back for belongings once you have started to leave.']),
    S('b4', 'Practise', 'family', ['Walk the route with your family. Plan for children, older adults and people with disabilities.'], ['Do not leave the slowest family member without a plan.']),
  ],
  during: [
    S('d1', 'Go inland and uphill immediately', 'wave', ['If the ground shakes strongly or for about a minute or more near the coast, protect yourself until the shaking stops (drop, cover and hold on), then go to high ground or as far inland as you can at once.', 'If you are told to evacuate, go now. Walk or cycle if you can: roads can jam.'], ['Do not wait for an official warning if you felt strong or long shaking.', 'Do not go to the shore to watch or take photos.'], 'The first wave may not be the largest. Waves can keep coming for hours.'),
    S('d2', 'Follow official routes', 'listen', ['Follow evacuation signs and instructions from the authorities.'], ['Do not return to the coast until the authorities give the all-clear.']),
    S('d3', 'If you cannot reach high ground', 'shelter', ['Follow official guidance about designated strong, tall buildings for vertical evacuation, where these exist.', 'Go as high as you can.'], ['Do not use a weak building or a low floor as shelter if you can still reach high ground.']),
  ],
  waiting: [
    { id: 'high', label: 'On high ground', when: 'You have reached high ground or are well inland', steps: [
      S('w1', 'Stay on high ground until the all-clear', 'highground', ['Stay where you are, away from the coast, until officials say it is safe. This can take many hours, sometimes more than a day.', 'Keep listening to official updates.'], ['Do not go back down to the shore or to your home.'], 'Waves can come in sets and the sea can pull back again.'),
      ...WAITING_COMMON,
    ] },
  ],
  after: [
    S('a1', 'Stay away until the all-clear', 'listen', ['Return only when the authorities say it is safe.'], ['Do not go to the coast to look.']),
    S('a2', 'Beware of water and debris', 'cleanup', ['Treat floodwater as contaminated. Watch for sharp debris, weak buildings and fallen wires.'], ['Do not touch fallen power lines.']),
    S('a3', 'Get medical help', 'firstaid', ['Get medical help for injuries and for anyone who swallowed seawater and feels unwell.'], ['Do not move seriously injured people unless there is danger.']),
    S('a4', 'Report hazards', 'phone', ['Report damage and hazards through VYRA when it is safe.'], ['Do not enter damaged buildings.']),
  ],
  quick: {
    danger: ['Go inland and uphill now. Do not wait for an official warning if you felt strong shaking or saw the sea pull back.', 'Do not go to the shore to watch.'],
    trapped: ['Go to the highest point you can reach and call for help. Signal from a safe spot.'],
    injured: ['If waves may be coming, get to high ground first, helping the person only if you can do so safely.'],
    waiting: ['Stay on high ground until officials give the all-clear. Waves can come for hours.'],
    safe: ['Know whether you are in a tsunami zone and your route to high ground.', 'Strong shaking or a receding sea near the coast means go.'],
  },
  related: ['earthquake', 'flood'],
  sources: [SRC.nzTsunami, SRC.noaaTsunami, SRC.readyTsunami, SRC.iocTsunami, SRC.ndma], content_checked_on: CHECKED, expert_reviewed: null,
}
