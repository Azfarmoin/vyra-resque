import { CHECKED, S, SRC } from './helpers'
import { WAITING_COMMON } from './common'
import type { HazardGuide } from '../types'

export const fire: HazardGuide = {
  id: 'fire', title: 'Fires and smoke', short: 'Get out, stay out. Stay low under smoke. Never use a lift.', icon: 'flame', group: 'fire',
  keywords: ['fire', 'smoke', 'burning', 'blaze', 'flames', 'wildfire', 'burn'],
  scope: 'Building and home fires and smoke. For wildfire or smoke from a distant fire, follow official evacuation and air-quality advice.',
  before: [
    S('b1', 'Know two ways out', 'exitdoor', ['Plan two exits from every room and a meeting point outside. Practise at night.', 'Keep exits and stairs clear.'], ['Do not lock or block exits.']),
    S('b2', 'Install and test alarms', 'listen', ['Fit smoke alarms where you can and test them often.'], ['Do not remove the batteries.']),
    S('b3', 'Reduce fire risks', 'gasleak', ['Never leave cooking unattended. Keep flames and heaters away from curtains and bedding.', 'Have damaged wiring and gas fittings checked.'], ['Do not overload sockets.']),
    S('b4', 'Plan for everyone', 'family', ['Plan how children, older adults and people with disabilities will get out. Know your emergency number.'], ['Do not plan to carry people down smoky stairs alone: tell the fire service where they are.']),
  ],
  during: [
    S('d1', 'Get out and stay out', 'exitdoor', ['Leave at once by the safest exit and go to your meeting point.', 'Call the emergency number from outside.'], ['Do not stop to collect things.', 'Do not go back inside for people or pets.'], 'Smoke can overcome you in minutes.'),
    S('d2', 'Stay low under smoke', 'crawlsmoke', ['Crawl or stay low where the air is clearer.', 'Check a door with the back of your hand before opening. If it is hot, do not open it.'], ['Do not open a hot door.', 'Do not use the lift in a building fire.']),
    S('d3', 'Close doors behind you', 'exitdoor', ['Close doors as you go to slow the fire and smoke.'], ['Do not leave doors open behind you.']),
    S('d4', 'If your clothes catch fire', 'stopdrop', ['Stop, drop to the ground, cover your face and roll to put the flames out.'], ['Do not run: it feeds the fire.']),
  ],
  waiting: [
    { id: 'trapped', label: 'Cannot get out of a burning building', when: 'Your exit is blocked by fire or smoke', steps: [
      S('w1', 'Seal yourself in a room with a window', 'sealroom', ['Go to a room with a window and close the door. Block gaps with wet cloth or clothing.', 'Stay low.'], ['Do not open the door to a smoky corridor.', 'Do not hide in a cupboard or under a bed.']),
      S('w2', 'Call and signal', 'signal', ['Call the emergency number and tell them your address, floor and which room you are in.', 'Go to the window and signal with a bright cloth or torch.'], ['Do not break a window unless you need air or to signal, and only if the glass cannot hurt you.']),
      ...WAITING_COMMON,
    ] },
    { id: 'outside', label: 'Outside, waiting for the fire service', when: 'You have got out', steps: [
      S('w3', 'Stay out and clear the way', 'keepback', ['Stay at the meeting point, well away from the building and smoke.', 'Keep the road and hydrant access clear for fire engines.', 'Tell firefighters who is still inside and where.'], ['Do not go back in, even for someone you can hear.', 'Do not stand under windows: glass can fall.']),
      ...WAITING_COMMON,
    ] },
    { id: 'smoke', label: 'Indoors, smoke from a fire nearby', when: 'The fire is outside and you were not told to leave', steps: [
      S('w4', 'Limit smoke indoors only if officials say stay', 'sealroom', ['If officials say to stay indoors, close windows and doors and stay in a cleaner room.', 'Leave if officials tell you to evacuate.'], ['Do not stay if you are told to evacuate.']),
    ] },
  ],
  after: [
    S('a1', 'Do not go back until the fire service says so', 'checkhome', ['Wait for the fire service to say it is safe. Structures can still fall.'], ['Do not re-enter to get things.']),
    S('a2', 'Get medical care', 'firstaid', ['Get checked for smoke inhalation and burns, even if you feel fine.'], ['Do not ignore coughing, breathlessness, or burns.']),
    S('a3', 'Check gas, power and food', 'gasleak', ['Have gas and electrical systems checked before use.', 'Throw away food that was exposed to heat or smoke.'], ['Do not switch on power in a damaged building.']),
    S('a4', 'Report and support', 'phone', ['Report damage and hazards through VYRA when safe. Check on neighbours.'], ['Do not post unverified claims about people.']),
  ],
  quick: {
    danger: ['Get out now and stay out. Do not go back for things or people.', 'Stay low under smoke. Check doors with the back of your hand; do not open a hot door.', 'Do not use the lift. Call emergency services from outside.'],
    trapped: ['Close the door, seal gaps with wet cloth, go to a window and stay low.', 'Call and say your address, floor and room, and signal from the window.'],
    injured: ['Move the person out of the smoke or fire only if you can do so safely. Do not go back in.', 'Tell the fire service about every person inside.'],
    waiting: ['Stay outside, far from the building, and keep the road clear for fire engines.', 'Do not go back in.'],
    safe: ['Know two exits from every room. Test alarms. Never leave cooking unattended.'],
  },
  related: ['collapse', 'electrical', 'chemical'],
  sources: [SRC.readyFireEscape, SRC.readyFire, SRC.redCross], content_checked_on: CHECKED, expert_reviewed: null,
}

export const storm: HazardGuide = {
  id: 'storm', title: 'Cyclones, severe storms and strong winds', short: 'Shelter in a strong building, away from windows. Stay clear of poles and billboards.', icon: 'wave', group: 'weather',
  keywords: ['cyclone', 'storm', 'wind', 'hurricane', 'typhoon', 'thunderstorm', 'lightning', 'gale', 'surge'],
  scope: 'Cyclones, severe thunderstorms and damaging winds. Storm surge on the coast is a flood risk: follow evacuation orders.',
  before: [
    S('b1', 'Secure your home', 'storm', ['Fix loose roof sheets and secure items outside that wind could blow away.', 'Remove or trim weak branches near the house.'], ['Do not leave loose objects, ladders or boards outside.']),
    S('b2', 'Know your shelter and route', 'route', ['Identify a strong building or designated shelter and the route to it.', 'If told to evacuate, go early.'], ['Do not wait until the wind is strong to leave.']),
    S('b3', 'Pack a kit and charge devices', 'kit', ['Water, medicines, a torch, a radio or power bank, documents.', 'Charge phones before the storm.'], ['Do not rely on mains power staying on.']),
    S('b4', 'Follow official warnings', 'listen', ['Follow the meteorological and disaster authorities for your area and any evacuation instructions.'], ['Do not ignore a warning because earlier storms were weak.']),
  ],
  during: [
    S('d1', 'Take shelter in a strong building', 'storm', ['Go indoors to a strong building. Choose an inner room or the lowest safe floor, away from windows and glass doors.', 'Stay inside until officials say the storm has passed.'], ['Do not stay in a weak or temporary structure.', 'Do not stay near windows.'], 'A calm period can be the eye of a cyclone. The wind returns from the other side.'),
    S('d2', 'Stay away from poles, billboards and weak structures', 'wire', ['Stay clear of power lines, electricity poles, billboards, trees and weak walls.', 'In lightning, stay away from windows and avoid using wired electrical equipment.'], ['Do not shelter under a tree, billboard or pole.']),
    S('d3', 'In a vehicle', 'roadside', ['Pull over away from trees and poles. Do not cross flooded roads.'], ['Do not drive through floodwater or fallen trees.']),
  ],
  waiting: [
    { id: 'indoor', label: 'Sheltering in a building', when: 'You are indoors during the storm', steps: [
      S('w1', 'Stay in the inner room, away from windows', 'storm', ['Protect your head with sturdy furniture or a mattress if the roof is failing.', 'Keep your kit and phone with you.'], ['Do not go out to check damage while the wind is strong.', 'Do not go out during the calm of the eye.']),
      ...WAITING_COMMON,
    ] },
    { id: 'shelter', label: 'At an evacuation shelter', when: 'You are in a shelter', steps: [
      S('w2', 'Stay in the shelter until officials say it is safe', 'shelter', ['Stay with your family, follow shelter staff and listen to updates.'], ['Do not leave to check your home until officials say it is safe.']),
    ] },
  ],
  after: [
    S('a1', 'Stay clear of damaged power lines and trees', 'wire', ['Treat every fallen wire as live and stay far away.', 'Watch for broken glass and unstable trees and walls.'], ['Do not touch fallen wires or anything touching them.']),
    S('a2', 'Avoid floodwater', 'nowade', ['Floodwater can hide hazards and be electrified.'], ['Do not walk or drive through floodwater.']),
    S('a3', 'Use generators and stoves safely', 'gasleak', ['Use generators outdoors, far from windows and doors.'], ['Do not run generators or burn charcoal indoors: carbon monoxide can kill without warning.']),
    S('a4', 'Report hazards', 'phone', ['Report fallen wires, blocked roads and damaged buildings through VYRA when safe.'], ['Do not return home until it has been checked and officials say it is safe.']),
  ],
  quick: {
    danger: ['Go to a strong building now, inner room or lowest safe floor, away from windows.', 'Stay clear of poles, billboards, trees and weak structures.'],
    trapped: ['Protect your head. Stay away from windows and call or text your location.'],
    injured: ['Stay sheltered. Call for help and keep the person away from windows and debris.'],
    waiting: ['Stay in the inner room away from windows. Do not go out in the calm of the eye.'],
    safe: ['Secure loose items, know your shelter and charge your phone.', 'Follow official warnings and evacuate early if told.'],
  },
  related: ['flood', 'urban-flood', 'electrical', 'tsunami'],
  sources: [SRC.readyHurricane, SRC.ndmaKarachi, SRC.pmd, SRC.ndma], content_checked_on: CHECKED, expert_reviewed: null,
}

export const heat: HazardGuide = {
  id: 'heat', title: 'Extreme heat and heatwaves', short: 'Stay cool, drink water, check on others. Heatstroke is an emergency.', icon: 'info', group: 'weather',
  keywords: ['heat', 'heatwave', 'heatstroke', 'sun', 'hot', 'dehydration', 'temperature'],
  scope: 'Hot weather and heatwaves. Heat is most dangerous for babies, older adults, outdoor workers and people with health conditions.',
  before: [
    S('b1', 'Plan to keep cool', 'sun', ['Know where you can keep cool: shade, a cooler room, a public cooling point.', 'Keep drinking water and oral rehydration salts at home.'], ['Do not plan outdoor work in the middle of the day.']),
    S('b2', 'Follow heat warnings', 'listen', ['Follow national and local heat warnings and advice.'], ['Do not ignore a heatwave warning because you feel fine.']),
    S('b3', 'Plan for people at higher risk', 'checkon', ['Arrange to check on older neighbours, young children and people with health problems.'], ['Do not assume they will ask for help.']),
    S('b4', 'Prepare your home', 'sun', ['Use light curtains or reflective covers on sun-facing windows if possible. Keep a thermometer.'], ['Do not rely on one cooling method.']),
  ],
  during: [
    S('d1', 'Stay out of the heat', 'sun', ['Stay indoors or in shade, especially around the hottest part of the day (NDMA advice mentions 11 am to 4 pm).', 'Rest often if you must be outside.'], ['Do not do hard physical work in the hottest hours.']),
    S('d2', 'Drink water often', 'sun', ['Drink water regularly, even if you are not thirsty. Wear light, loose clothing and a hat.'], ['Do not wait until you feel thirsty.']),
    S('d3', 'Never leave anyone in a parked vehicle', 'floodcar', ['Check that children, older adults and pets are not left in a parked vehicle, even for a short time.'], ['Do not leave anyone in a car in the heat.']),
    S('d4', 'Know the danger signs', 'firstaid', ['Confusion, fainting, very high body temperature, hot dry skin or very heavy sweating, a rapid pulse, vomiting or seizures: this is an emergency. Call for help.'], ['Do not wait to see if it passes.']),
  ],
  waiting: [
    { id: 'person', label: 'Someone shows signs of heatstroke', when: 'A person is confused, faint or very hot and help is on the way', steps: [
      S('w1', 'Cool them while you wait', 'sun', ['Move the person to shade or a cooler place and lay them down.', 'Loosen or remove extra clothing and cool the skin with water, wet cloths and fanning.', 'Give small sips of water only if they are awake and able to swallow.'], ['Do not give drinks to a person who is unconscious or confused and cannot swallow.', 'Do not leave them alone.'], 'Heatstroke can be fatal. Keep cooling until responders arrive.'),
      ...WAITING_COMMON,
    ] },
    { id: 'home', label: 'At home, waiting for help or power to return', when: 'You are waiting indoors in the heat', steps: [
      S('w2', 'Stay in the coolest place', 'sun', ['Stay in the coolest room, low to the floor. Keep drinking. Use wet cloths on your neck and wrists.', 'Check on others in the home regularly.'], ['Do not go out into the heat unless you are told to or it is an emergency.']),
      ...WAITING_COMMON,
    ] },
  ],
  after: [
    S('a1', 'Rehydrate and rest', 'sun', ['Keep drinking water and rest. Cool down gradually.'], ['Do not go back to hard work the same day if you felt unwell.']),
    S('a2', 'Watch for delayed symptoms', 'firstaid', ['Seek medical help for headaches, nausea, dizziness or weakness that persist.'], ['Do not ignore symptoms that return.']),
    S('a3', 'Check on neighbours', 'checkon', ['Check on older and isolated people.'], ['Do not assume silence means they are fine.']),
    S('a4', 'Report problems', 'phone', ['Report water shortages or cooling-point problems through VYRA when you can.'], ['Do not keep problems to yourself: others may share them.']),
  ],
  quick: {
    danger: ['Move to shade or a cool place now and start drinking water.', 'If someone is confused, faint or has very hot skin, call for emergency help.'],
    trapped: ['If trapped in heat (for example a locked car or room), call for help and get to shade or air if you can.'],
    injured: ['For heatstroke: move to a cooler place and cool the body with water and fanning. Call for help.'],
    waiting: ['Stay in the coolest place, keep drinking, and cool the neck and wrists with wet cloths.', 'Never leave a child, older person or pet in a parked car.'],
    safe: ['Avoid the midday heat, drink often, and check on people at higher risk.'],
  },
  related: ['electrical', 'fire'],
  sources: [SRC.ndmaHeat, SRC.whoHeat, SRC.cdcHeat, SRC.readyHeat, SRC.pmd], content_checked_on: CHECKED, expert_reviewed: null,
}

export const chemical: HazardGuide = {
  id: 'chemical', title: 'Chemical spills and hazardous fumes', short: 'Follow official shelter or evacuation orders. Get away from fumes.', icon: 'alert', group: 'other',
  keywords: ['chemical', 'spill', 'fumes', 'gas', 'gas leak', 'toxic', 'hazmat', 'smell', 'leak'],
  scope: 'Chemical spills, industrial leaks, gas leaks and unknown fumes. The right action depends on the substance: always follow official instructions.',
  before: [
    S('b1', 'Know the risks near you', 'chemcloud', ['Find out whether factories, storage yards or main pipelines are near your home, school or work.', 'Know how official alerts will reach you.'], ['Do not ignore an unusual smell, haze or hissing sound.']),
    S('b2', 'Pick a shelter-in-place room', 'sealroom', ['Choose an inner room with few windows. Know how to close windows and switch off fans and air conditioning.'], ['Do not choose a room with many windows.']),
    S('b3', 'Know your evacuation route', 'route', ['Know two routes away from the area and a place to meet.'], ['Do not plan routes that pass near the hazard.']),
    S('b4', 'Learn the gas basics', 'gasleak', ['Know where the gas shut-off is, and how to leave quickly.'], ['Do not look for a leak with a flame.']),
  ],
  during: [
    S('d1', 'Follow official instructions first', 'listen', ['Listen for official instructions: shelter in place or evacuate. The right choice depends on the substance and where you are.'], ['Do not choose on your own if instructions are available.']),
    S('d2', 'If told to shelter in place', 'sealroom', ['Go inside, close all windows and doors, switch off fans, air conditioning and heating that draw in outside air.', 'Go to the room officials suggest and stay there.'], ['Do not go outside to look.', 'Do not leave the shelter to help others outdoors until officials say it is safe.']),
    S('d3', 'If told to leave, or you smell fumes', 'chemcloud', ['Move away from the source and out of the direction the fumes are travelling, ideally upwind. Avoid low ground where gas can collect.', 'Leave quickly and warn others.'], ['Do not walk through a cloud or spilled liquid.', 'Do not touch spilled substances.']),
    S('d4', 'Suspected gas leak', 'gasleak', ['Leave the building at once, leaving doors open. Call for help from a safe distance outside.'], ['Do not use light switches, lighters, matches or phones inside.']),
  ],
  waiting: [
    { id: 'inside', label: 'Sheltering in place', when: 'Officials told you to stay indoors', steps: [
      S('w1', 'Stay sealed in until the all-clear', 'sealroom', ['Keep windows, doors and fans off. Stay in your room and listen for instructions.', 'Check on people with you. Tell responders if anyone feels unwell.'], ['Do not open windows to ventilate until officials say so.', 'Do not leave to look at the incident.']),
      ...WAITING_COMMON,
    ] },
    { id: 'exposed', label: 'You or someone was exposed', when: 'A person has contact or breathing symptoms', steps: [
      S('w2', 'Get to fresh air and wash off', 'chemcloud', ['Move to fresh air, away from the source.', 'Take off contaminated clothing without pulling it over the head, and rinse skin and eyes with plenty of clean water.', 'Tell responders what the substance was, if you know.'], ['Do not rub eyes or skin.', 'Do not induce vomiting unless told by a medical professional.'], 'Get medical help for any breathing difficulty, burning or dizziness.'),
      ...WAITING_COMMON,
    ] },
  ],
  after: [
    S('a1', 'Wait for the all-clear', 'listen', ['Wait for officials to say it is safe to leave or return.'], ['Do not go back into the area.']),
    S('a2', 'Ventilate only when told', 'sealroom', ['When told it is safe, open windows and doors as advised.'], ['Do not ventilate while the hazard remains.']),
    S('a3', 'Get a medical check', 'firstaid', ['Get checked if you had any symptoms or contact, even if mild.'], ['Do not ignore symptoms that start later.']),
    S('a4', 'Report and avoid spills', 'phone', ['Report spills or smells through VYRA from a safe distance.'], ['Do not touch or clean up spills yourself.']),
  ],
  quick: {
    danger: ['Follow official instructions: shelter in place or evacuate.', 'If you smell gas or fumes and there is no instruction, leave the area, moving away from the source and out of the fumes. Do not use switches or flames.', 'Do not touch spilled substances.'],
    trapped: ['Cover your nose and mouth, move to the cleanest air you can, and call for help with your exact location.'],
    injured: ['Move the person to fresh air, away from the source, if it is safe. Rinse skin and eyes with plenty of clean water. Tell responders the substance.'],
    waiting: ['If told to stay indoors, keep windows, doors and fans closed until officials say it is safe.'],
    safe: ['Know how alerts will reach you, and pick a sealable inner room and two routes out.'],
  },
  related: ['fire', 'collapse', 'electrical'],
  sources: [SRC.readyHazmat, SRC.redCross, SRC.ndma], content_checked_on: CHECKED, expert_reviewed: null,
}
