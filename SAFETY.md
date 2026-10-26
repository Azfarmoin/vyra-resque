# VYRA Hazards & Precautions center

Illustrated survival guides for 12 hazards, each with **BEFORE, DURING, WHILE WAITING FOR RESCUE and AFTER**, a deterministic "What should I do right now?" checklist, offline access, links from reports / zones / the responder view, and an administrator content editor.

## Important: content status
The guide text was written from the public guidance listed below and checked against it. **It has not been reviewed by a local emergency-management professional.** Every guide says so on screen ("Checked against public guidance on 25 Oct 2026. Not yet reviewed by..."). Before launch, have your disaster authority review each guide, then record the reviewer and date in `/admin/safety` (this replaces that notice with "Reviewed by X on Y"). Do not remove the notice by editing code.

## Setup
1. `npm install && npm test && npm run build`
2. Optional (administrator editing): run `supabase/migrations/015_safety_content.sql` after 010 (disaster zones). Without it the built-in guides are used and nothing else changes.
3. Emergency number: the screens already told Karachi users to call "Rescue 1122", so that is the default. For anywhere else set `NEXT_PUBLIC_EMERGENCY_NUMBER` and `NEXT_PUBLIC_EMERGENCY_LABEL` (empty number = "call your local emergency service" with no dial button). No other number appears in any guide; a test enforces this.

## Where things are
- **Tab:** "Safety" in the main and mobile navigation -> `/safety` (grid, search, category filters, help-now panel, save-for-offline button), `/safety/<hazard>` (12 guides), `/safety/now` (checklist; accepts `?hazard=flood`).
- **Categories:** flood, urban-flood, earthquake, fire, collapse, storm, landslide, heat, electrical, road, chemical, tsunami. Tsunami says it applies only near coasts.
- **Waiting for rescue:** every guide has scenario-specific sections (for example trapped under debris vs. at a shelter, car vs. upper floor, heatstroke patient vs. at home), always opening with "is where you are safe? If not, move first", plus shared steps (tell responders location/landmark/incident/people, save battery, never enter danger to rescue).
- **Illustrations:** 29 original inline-SVG scenes (`src/components/safety/Scene.tsx`), each with a text description. Prohibition is drawn with a circle and a bar, DO / DON'T have symbols and words.
- **Integration:** report form (guides for the dangers you pick), report status page, responder case view ("advice to relay"), map zone details (during / waiting links by hazard), `PossibleHazardLink` for photo analysis (labels the suggestion "NOT verified"), and the shelters/waiting scenarios inside each guide.
- **Admin:** `/admin/safety` (administrators only): edit JSON, content checks run live, publish requires reviewer + date + reason, retire, revision history. A published guide that fails the content checks is never shown.

## Content rules enforced by tests (`src/lib/safety/lint.ts`)
All four phases present; known illustrations; sources with https URLs and at least one page actually read; hazard-specific must-haves (for example Drop Cover Hold On, never use the lift in a fire, never touch a fallen wire, "do not light a match" for trapped people, official instructions first for chemicals, wait for the all-clear after a tsunami); no emergency numbers in text; waiting guidance must warn against entering danger; the checklist never tells someone in danger to wait where they are.

## Offline
- Guide pages are static and precached by the service worker (`public/sw.js`, cache `vyra-shell-v3`: /safety, /safety/now and the 12 guides). Illustrations are inline SVG, so nothing else is fetched. The checklist runs entirely on the device.
- "Save all guides for offline use" fetches every page while online; it is disabled offline and says so.
- Administrator-published guides are kept in localStorage; if they cannot load, the built-in guides are shown.
- Offline banners say that current warnings, evacuation orders and zone boundaries need internet; cached warnings are never shown as current.

## Database changes
`015_safety_content.sql` (optional): `safety_content`, `safety_content_revisions`; RLS (public reads published only, administrators write), a guard trigger, an append-only history trigger, and a check that published rows carry a reviewer and date.

## Sources (generated from the content)
| Status | Source | URL | Used by |
|---|---|---|---|
| read | Ready.gov (US DHS/FEMA): Floods | https://www.ready.gov/floods | flood, urban-flood, electrical |
| read | US National Weather Service: Flood safety: Turn Around Don’t Drown | https://www.weather.gov/box/flood_safety | flood, urban-flood |
| read | NDMA Pakistan (via Press Information Department): Advisory: Urban inundation in Karachi | https://pid.gov.pk/site/press_detail/26029 | urban-flood, storm, electrical, road |
| read | NYC Emergency Management: Earthquakes: what to do | https://www.nyc.gov/site/em/ready/earthquakes.page | earthquake, collapse |
| read | California Dept. of Public Health: What to do during an earthquake | https://www.cdph.ca.gov/Programs/EPO/Pages/What-to-do-during-an-Earthquake.aspx | earthquake, collapse |
| read | Ready.gov: Home fire escape plan (crawl low, feel doors, stop-drop-roll) | https://www.ready.gov/home-fire-escape-plan | fire |
| read | Ready Wisconsin (state emergency management, citing Ready.gov / FEMA): Landslides: warning signs, during and after | https://readywisconsin.wi.gov/landslides/ | landslide |
| read | NDMA Pakistan (reported by APP): Heatwave advisory: precautionary measures | https://www.app.com.pk/national/ndma-advises-precautionary-measures-as-intense-heatwave-to-grip-multiple-regions/ | heat |
| read | UK Highway Code Annex 7 (with St John Ambulance, British Heart Foundation, British Red Cross): First aid on the road | https://nidirect.gov.uk/articles/first-aid-road | road |
| read | Ready.gov: Chemicals and hazardous materials incidents | https://ready.gov/hazmat | chemical |
| read | NZ National Emergency Management Agency (Civil Defence): Tsunami: Long or Strong, Get Gone | https://getready.govt.nz/emergency/tsunami | tsunami |
| read | US NOAA / National Weather Service: Tsunami safety brochure | https://www.weather.gov/media/safety/Tsunami-brochure17.pdf | tsunami |
| not re-checked | US CDC: Floods: staying safe after | https://www.cdc.gov/floods/ | flood, urban-flood |
| not re-checked | NDMA Pakistan: National Disaster Management Authority | https://ndma.gov.pk/ | flood, earthquake, collapse, storm, landslide, chemical, tsunami |
| not re-checked | Pakistan Meteorological Department: Official weather warnings (live) | https://www.pmd.gov.pk/ | flood, storm, landslide, heat |
| not re-checked | Ready.gov: Earthquakes | https://www.ready.gov/earthquakes | earthquake, collapse |
| not re-checked | US Geological Survey: Earthquake hazards | https://www.usgs.gov/programs/earthquake-hazards | earthquake |
| not re-checked | Ready.gov: Home fires | https://www.ready.gov/home-fires | fire |
| not re-checked | International Red Cross and Red Crescent / Red Cross: Disaster safety and first aid | https://www.redcross.org/get-help/how-to-prepare-for-emergencies.html | fire, collapse, electrical, road, chemical |
| not re-checked | Ready.gov: Hurricanes | https://www.ready.gov/hurricanes | storm |
| not re-checked | Ready.gov: Landslides and debris flow | https://www.ready.gov/landslides-debris-flow | landslide |
| not re-checked | World Health Organization: Heat and health | https://www.who.int/news-room/fact-sheets/detail/climate-change-heat-and-health | heat |
| not re-checked | US CDC: Heat and your health | https://www.cdc.gov/heat-health/ | heat |
| not re-checked | Ready.gov: Extreme heat | https://www.ready.gov/heat | heat |
| not re-checked | Ready.gov: Power outages (downed lines) | https://www.ready.gov/power-outages | electrical |
| not re-checked | World Health Organization: Road traffic injuries | https://www.who.int/news-room/fact-sheets/detail/road-traffic-injuries | road |
| not re-checked | Ready.gov: Tsunamis | https://www.ready.gov/tsunamis | tsunami |
| not re-checked | UNESCO IOC Tsunami Ready: Tsunami Ready programme | https://tsunamiready.ioc-unesco.org/ | tsunami |

"read" = the page was opened and read while the text was written. "not re-checked" = the agency's standard guidance page, not re-opened: confirm the address and wording during review. Where sources differ (for example US vs. Pakistan advice) the guides use wording common to them, and the NDMA Pakistan items for urban flooding and heat; local official advice always wins.

## Tests (run here): 77 passing
`tests/safety.test.ts` (content, hazard rules, checklist for all 416 answer combinations, links, admin API, merge) plus the earlier zone tests. **Not run here:** `npm install`, `next build`, the existing VYRA tests, any browser or Android rendering, screen-reader and contrast checks, and the SQL migration. Test these on a real device before release, especially the pages offline in airplane mode.

## Known gaps
- The repo has no AI photo analysis or early-warning notification feature, so there was nothing to connect to. `PossibleHazardLink` and `guideFromLabel()` are ready to drop in where analysis results render; early warnings can use `guideHref()`.
- English only. Urdu and other languages need translated, reviewed content.
- Illustrations are simple original drawings; a designer may want to refine them. Admin editing is a validated JSON editor, not a form per step.
- Contrast and touch-target sizes use the app's existing palette and button styles but were not measured.
