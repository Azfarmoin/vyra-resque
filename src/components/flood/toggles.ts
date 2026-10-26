// Layer toggles for the flood simulator. Kept apart from FloodLayer so importing them never loads Leaflet on the server.
export interface FloodLayerToggles { extent: boolean; roads: boolean; buildings: boolean; shelters: boolean; hospitals: boolean; observations: boolean }
export const DEFAULT_FLOOD_TOGGLES: FloodLayerToggles = { extent: true, roads: true, buildings: true, shelters: true, hospitals: true, observations: true }
