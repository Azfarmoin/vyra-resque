import type { SceneId } from '../scenes'
import type { Source, Step } from '../types'

export const S = (id: string, title: string, scene: SceneId, doList: string[], dontList: string[], remember?: string, detail?: string): Step => ({ id, title, scene, do: doList, dont: dontList, remember, detail })
export const CHECKED = '2026-10-25'
const src = (org: string, title: string, url: string, checked = false): Source => ({ org, title, url, checked })

// `checked: true` = the page was opened and read while this content was written. The others are the agencies' standard
// public guidance pages; their addresses were not re-opened, so a reviewer should confirm them.
export const SRC = {
  readyFloods: src('Ready.gov (US DHS/FEMA)', 'Floods', 'https://www.ready.gov/floods', true),
  nwsFlood: src('US National Weather Service', 'Flood safety: Turn Around Don\u2019t Drown', 'https://www.weather.gov/box/flood_safety', true),
  ndmaKarachi: src('NDMA Pakistan (via Press Information Department)', 'Advisory: Urban inundation in Karachi', 'https://pid.gov.pk/site/press_detail/26029', true),
  ndmaHeat: src('NDMA Pakistan (reported by APP)', 'Heatwave advisory: precautionary measures', 'https://www.app.com.pk/national/ndma-advises-precautionary-measures-as-intense-heatwave-to-grip-multiple-regions/', true),
  nycQuake: src('NYC Emergency Management', 'Earthquakes: what to do', 'https://www.nyc.gov/site/em/ready/earthquakes.page', true),
  cdphQuake: src('California Dept. of Public Health', 'What to do during an earthquake', 'https://www.cdph.ca.gov/Programs/EPO/Pages/What-to-do-during-an-Earthquake.aspx', true),
  readyQuake: src('Ready.gov', 'Earthquakes', 'https://www.ready.gov/earthquakes'),
  readyFire: src('Ready.gov', 'Home fires', 'https://www.ready.gov/home-fires'),
  readyFireEscape: src('Ready.gov', 'Home fire escape plan (crawl low, feel doors, stop-drop-roll)', 'https://www.ready.gov/home-fire-escape-plan', true),
  readyWiLandslide: src('Ready Wisconsin (state emergency management, citing Ready.gov / FEMA)', 'Landslides: warning signs, during and after', 'https://readywisconsin.wi.gov/landslides/', true),
  nzTsunami: src('NZ National Emergency Management Agency (Civil Defence)', 'Tsunami: Long or Strong, Get Gone', 'https://getready.govt.nz/emergency/tsunami', true),
  noaaTsunami: src('US NOAA / National Weather Service', 'Tsunami safety brochure', 'https://www.weather.gov/media/safety/Tsunami-brochure17.pdf', true),
  nidirectRoad: src('UK Highway Code Annex 7 (with St John Ambulance, British Heart Foundation, British Red Cross)', 'First aid on the road', 'https://nidirect.gov.uk/articles/first-aid-road', true),
  readyHurricane: src('Ready.gov', 'Hurricanes', 'https://www.ready.gov/hurricanes'),
  readyLandslide: src('Ready.gov', 'Landslides and debris flow', 'https://www.ready.gov/landslides-debris-flow'),
  readyHeat: src('Ready.gov', 'Extreme heat', 'https://www.ready.gov/heat'),
  readyPower: src('Ready.gov', 'Power outages (downed lines)', 'https://www.ready.gov/power-outages'),
  readyHazmat: src('Ready.gov', 'Chemicals and hazardous materials incidents', 'https://ready.gov/hazmat', true),
  readyTsunami: src('Ready.gov', 'Tsunamis', 'https://www.ready.gov/tsunamis'),
  tsunamiGov: src('US NOAA Tsunami Warning Centers', 'Tsunami safety', 'https://www.tsunami.gov/'),
  iocTsunami: src('UNESCO IOC Tsunami Ready', 'Tsunami Ready programme', 'https://tsunamiready.ioc-unesco.org/'),
  cdcFlood: src('US CDC', 'Floods: staying safe after', 'https://www.cdc.gov/floods/'),
  cdcHeat: src('US CDC', 'Heat and your health', 'https://www.cdc.gov/heat-health/'),
  whoHeat: src('World Health Organization', 'Heat and health', 'https://www.who.int/news-room/fact-sheets/detail/climate-change-heat-and-health'),
  whoRoad: src('World Health Organization', 'Road traffic injuries', 'https://www.who.int/news-room/fact-sheets/detail/road-traffic-injuries'),
  redCross: src('International Red Cross and Red Crescent / Red Cross', 'Disaster safety and first aid', 'https://www.redcross.org/get-help/how-to-prepare-for-emergencies.html'),
  pmd: src('Pakistan Meteorological Department', 'Official weather warnings (live)', 'https://www.pmd.gov.pk/'),
  ndma: src('NDMA Pakistan', 'National Disaster Management Authority', 'https://ndma.gov.pk/'),
  usgs: src('US Geological Survey', 'Earthquake hazards', 'https://www.usgs.gov/programs/earthquake-hazards'),
}
