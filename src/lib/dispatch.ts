export const DISPATCH_SELECT =
  '*, emergency_reports(id, location_address, people_count, priority_score, status, immediate_danger), rescue_teams(id, team_name, team_leader, contact_number, status), dispatch_resources(id, quantity, resources(id, resource_type, name, quantity, status))'

export const ACTIVE_DISPATCH_STATUSES = ['pending', 'en_route', 'on_scene']
export const DISPATCH_STATUSES = [...ACTIVE_DISPATCH_STATUSES, 'completed', 'cancelled']
