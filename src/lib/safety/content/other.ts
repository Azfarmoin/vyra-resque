import { CHECKED, S, SRC } from './helpers'
import { WAITING_COMMON } from './common'
import type { HazardGuide } from '../types'

export const electrical: HazardGuide = {
  id: 'electrical', title: 'Electrical hazards and downed power lines', short: 'Treat every fallen wire as live. Stay far away and call for help.', icon: 'alert', group: 'other',
  keywords: ['electrical', 'electric', 'power line', 'downed wire', 'live wire', 'electrocution', 'shock', 'pole'],
  scope: 'Fallen or low wires, damaged poles, and electrical equipment in water or damaged by storms and floods.',
  before: [
    S('b1', 'Know your main switch', 'wire', ['Know where the main electricity switch is and how to turn it off safely with dry hands.', 'Have damaged wiring repaired by a qualified electrician.'], ['Do not overload sockets or use damaged cables.']),
    S('b2', 'Keep clear of wires', 'wire', ['Keep children away from poles, transformers and wires. Look up before using ladders or poles.'], ['Do not fly kites near power lines or climb poles.']),
    S('b3', 'Protect equipment from water', 'cleanup', ['Raise important electrical items above possible flood level. Unplug devices before storms or floods if you can.'], ['Do not use electrical devices when wet or standing in water.']),
    S('b4', 'Know who to call', 'phone', ['Save the electricity company and emergency numbers where you can find them.'], ['Do not try to fix pole or line faults yourself.']),
  ],
  during: [
    S('d1', 'Assume a fallen wire is live', 'wire', ['Stay far away. Keep others away and warn people. Call the electricity company and emergency services.', 'About 10 metres (33 ft) or more is commonly advised, and wet ground can carry current further.'], ['Do not touch a fallen wire or anything touching it: fences, puddles, vehicles, branches.']),
    S('d2', 'Never go near water around wires', 'nowade', ['Stay out of flooded areas that may have live wires or electrical equipment.'], ['Do not wade through water near poles, cables or switchboards.']),
    S('d3', 'If a wire falls on your vehicle', 'floodcar', ['Stay inside and wait for the electricity company. Call for help and warn people to stay away.', 'Only if fire forces you out: jump clear with feet together, without touching the car and the ground at the same time, and shuffle away with small steps.'], ['Do not step out normally or touch the car while standing on the ground.']),
    S('d4', 'Someone is being shocked', 'keepback', ['Do not touch them. Switch off the power at the main switch if you can do so safely, then call for emergency help.'], ['Do not touch the person or the wire until the power is off.']),
  ],
  waiting: [
    { id: 'near', label: 'Waiting near a fallen wire', when: 'A downed line is close and help is on the way', steps: [
      S('w1', 'Stay well back and keep others away', 'wire', ['Move away, taking small steps and keeping your feet together if you are close.', 'Warn people and keep children and animals away until the electricity company says it is safe.'], ['Do not approach to move the wire or help someone near it.']),
      ...WAITING_COMMON,
    ] },
    { id: 'vehicle', label: 'Inside a vehicle touched by a wire', when: 'The wire is on or near your car', steps: [
      S('w2', 'Stay in the vehicle unless there is fire', 'floodcar', ['Stay inside, keep others away, call for help and tell them a power line is on the vehicle.'], ['Do not step out unless there is fire or the electricity company tells you to.']),
      ...WAITING_COMMON,
    ] },
  ],
  after: [
    S('a1', 'Stay away until declared safe', 'keepback', ['Stay away until the electricity company confirms the line is dead.'], ['Do not assume a wire is safe because nothing seems to happen.']),
    S('a2', 'Check equipment before use', 'wire', ['Have wet or damaged wiring and appliances checked by a qualified person.'], ['Do not switch on power in a wet or damaged room.']),
    S('a3', 'Get medical help for shocks', 'firstaid', ['Anyone who has had an electric shock should get medical help, even if they feel fine.'], ['Do not ignore chest pain, burns or irregular heartbeat.']),
    S('a4', 'Report it', 'phone', ['Report fallen wires and damaged poles through VYRA and to the electricity company when it is safe.'], ['Do not go near the wire to take photos.']),
  ],
  quick: {
    danger: ['Stay far away from the fallen wire and keep others away. Assume it is live.', 'Do not touch anything touching the wire. Call the electricity company and emergency services.'],
    trapped: ['If a wire is on your vehicle, stay inside unless there is fire, and call for help.'],
    injured: ['Do not touch the person until the power is off. Call for emergency help.'],
    waiting: ['Stay well back and keep others away until the electricity company says it is safe.'],
    safe: ['Know your main switch, keep children away from wires and poles, and keep electrical items out of water.'],
  },
  related: ['flood', 'urban-flood', 'storm', 'fire'],
  sources: [SRC.readyPower, SRC.readyFloods, SRC.ndmaKarachi, SRC.redCross], content_checked_on: CHECKED, expert_reviewed: null,
}

export const road: HazardGuide = {
  id: 'road', title: 'Road accidents and blocked roads', short: 'Make the scene safe, get out of traffic, call for help, and use another route.', icon: 'road', group: 'other',
  keywords: ['road', 'accident', 'crash', 'collision', 'blocked road', 'traffic', 'vehicle', 'highway', 'bridge'],
  scope: 'Road crashes, vehicle breakdowns and roads blocked by floods, landslides or debris.',
  before: [
    S('b1', 'Drive and ride safely', 'roadside', ['Wear seat belts and helmets. Keep your vehicle in good condition.', 'Check road conditions and warnings before travelling in bad weather.'], ['Do not drive tired or too fast for conditions.']),
    S('b2', 'Carry basics', 'kit', ['Water, a charged phone and power bank, a torch, a first-aid kit and a warning triangle if you have one.'], ['Do not travel in storms or floods unless you have to.']),
    S('b3', 'Plan alternatives', 'route', ['Know alternative routes. Check which roads are blocked.'], ['Do not rely on a single route.']),
    S('b4', 'Tell someone', 'phone', ['Tell someone your route and when you expect to arrive.'], ['Do not travel in remote areas without telling anyone.']),
  ],
  during: [
    S('d1', 'Make the scene safer', 'roadside', ['Stop in a safe place. Turn on hazard lights. Get yourself and passengers out and behind a barrier or well off the road.', 'Call for help.'], ['Do not stand in traffic lanes.']),
    S('d2', 'Do not drive into blocked or flooded roads', 'floodcar', ['Turn around at flooded, blocked or damaged roads. Use another route.'], ['Do not drive around barriers or through floodwater.']),
    S('d3', 'Help only if it is safe', 'firstaid', ['If someone is bleeding heavily, press firmly on the wound with a clean cloth.'], ['Do not move injured people unless there is fire, fuel or traffic danger.', 'Do not remove a motorcyclist\u2019s helmet unless it is essential.']),
    S('d4', 'Beware of fuel and fire', 'keepback', ['Switch off engines. Move people away from a smoking or leaking vehicle.'], ['Do not smoke or use flames near a crash.']),
  ],
  waiting: [
    { id: 'crash', label: 'At a crash scene, waiting for help', when: 'You have called and help is on the way', steps: [
      S('w1', 'Stay out of traffic and keep injured people still', 'roadside', ['Stay behind a barrier or off the road. Keep injured people still and warm and talk to them.', 'Tell responders the road name, direction, nearest landmark, number of vehicles and people hurt.', 'Keep access clear for ambulances.'], ['Do not move injured people unless there is fire or danger.', 'Do not let people stand in traffic lanes.']),
      ...WAITING_COMMON,
    ] },
    { id: 'stuck', label: 'Stuck behind a blocked road', when: 'A flood, landslide or crash blocks the road', steps: [
      S('w2', 'Stay in a safe place and keep the road clear', 'roadside', ['Stay in your vehicle or beside the road in a safe place, away from slopes, water and traffic.', 'Keep the route clear for emergency vehicles.'], ['Do not try to cross a blocked or flooded section.']),
      ...WAITING_COMMON,
    ] },
  ],
  after: [
    S('a1', 'Get checked', 'firstaid', ['Get a medical check even if you feel fine. Some injuries show later.'], ['Do not ignore neck pain, headache or abdominal pain.']),
    S('a2', 'Report blocked or damaged roads', 'phone', ['Report blocked roads, damaged bridges and hazards through VYRA when safe.'], ['Do not stop on the road to take photos.']),
    S('a3', 'Move the vehicle only when safe', 'roadside', ['Wait for responders. Move vehicles only if it is safe and does not destroy evidence.'], ['Do not leave a damaged vehicle in a travel lane.']),
    S('a4', 'Follow up', 'checkon', ['Tell your family you are safe. Follow up on repairs and insurance later.'], ['Do not post details about injured people online.']),
  ],
  quick: {
    danger: ['Get yourself and others out of traffic and behind a barrier or well off the road.', 'Turn on hazard lights and call for help. Move people away from a smoking or leaking vehicle.'],
    trapped: ['Stay in the vehicle if it is safer than outside, turn on hazard lights and call for help. If there is fire or fuel, get out and away.'],
    injured: ['Do not move the person unless there is fire, fuel or traffic danger. Press firmly on heavy bleeding with a clean cloth. Call for help.'],
    waiting: ['Stay out of traffic lanes, keep injured people still and warm, and keep access clear for ambulances.'],
    safe: ['Turn around at flooded or blocked roads and use another route.'],
  },
  related: ['flood', 'landslide', 'fire'],
  sources: [SRC.nidirectRoad, SRC.whoRoad, SRC.ndmaKarachi, SRC.redCross], content_checked_on: CHECKED, expert_reviewed: null,
}
