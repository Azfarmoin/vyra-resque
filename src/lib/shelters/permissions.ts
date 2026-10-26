// Who may do what in the shelter module. One table, used by every API handler and tested directly, so a handler cannot
// quietly be more permissive than the documented matrix.
//
//   anonymous / citizen : read the public shelter list only (name, area, location, open/full/closed, verified).
//   responder           : recommend, reserve, confirm arrivals, record departures, cancel, update occupancy,
//                         view the dashboard, coverage map and hypothetical comparisons.
//   admin               : everything a responder can, plus edit the registry, verify records, create / revoke exceptions,
//                         run reconciliation and read the audit log.
// There is no separate "planner" role: adding a role means changing the database enum, which widens the attack surface.
// Planners are responders or administrators.
export type ShelterAction =
  | 'list_public' | 'view_detail' | 'recommend' | 'reserve' | 'view_reservations' | 'update_reservation' | 'update_occupancy'
  | 'view_dashboard' | 'view_coverage' | 'evaluate_hypotheticals' | 'edit_registry' | 'create_shelter' | 'manage_exceptions' | 'reconcile' | 'view_audit'

const ANYONE: ShelterAction[] = ['list_public']
const RESPONDER: ShelterAction[] = ['view_detail', 'recommend', 'reserve', 'view_reservations', 'update_reservation', 'update_occupancy', 'view_dashboard', 'view_coverage', 'evaluate_hypotheticals']
const ADMIN: ShelterAction[] = ['edit_registry', 'create_shelter', 'manage_exceptions', 'reconcile', 'view_audit']

export const PERMISSIONS: Record<'anonymous' | 'citizen' | 'responder' | 'admin', ShelterAction[]> = {
  anonymous: ANYONE,
  citizen: ANYONE,
  responder: [...ANYONE, ...RESPONDER],
  admin: [...ANYONE, ...RESPONDER, ...ADMIN],
}

export function can(role: 'citizen' | 'responder' | 'admin' | null | undefined, action: ShelterAction): boolean {
  return PERMISSIONS[role ?? 'anonymous']?.includes(action) ?? false
}

/** The only fields of a shelter that anonymous callers and citizens ever receive. */
export const PUBLIC_SHELTER_FIELDS = ['id', 'name', 'address', 'area', 'location_lat', 'location_lng', 'status', 'verified', 'contact_number', 'services'] as const
