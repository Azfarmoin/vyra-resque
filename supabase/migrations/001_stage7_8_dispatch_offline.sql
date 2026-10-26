-- Stage 7 (resources & dispatch) and Stage 8 (offline sync) schema changes.
-- Safe to run on an existing database created from schema.sql.

-- Stage 8: idempotency key so offline-queued reports are never inserted twice
ALTER TABLE emergency_reports ADD COLUMN IF NOT EXISTS client_id TEXT;
ALTER TABLE emergency_reports ADD COLUMN IF NOT EXISTS submitted_offline BOOLEAN DEFAULT FALSE;
ALTER TABLE emergency_reports ADD COLUMN IF NOT EXISTS client_created_at TIMESTAMP WITH TIME ZONE;
CREATE UNIQUE INDEX IF NOT EXISTS idx_emergency_reports_client_id ON emergency_reports(client_id);

-- Stage 7: richer team registry
ALTER TABLE rescue_teams ADD COLUMN IF NOT EXISTS team_size INTEGER DEFAULT 4;
ALTER TABLE rescue_teams ADD COLUMN IF NOT EXISTS base_location TEXT;

-- Stage 7: resource naming / location
ALTER TABLE resources ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE resources ADD COLUMN IF NOT EXISTS notes TEXT;

-- Stage 7: hazards used for route-safety scoring (flooded roads, collapsed bridges, ...)
CREATE TABLE IF NOT EXISTS route_hazards (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  description TEXT NOT NULL,
  location_lat NUMERIC NOT NULL,
  location_lng NUMERIC NOT NULL,
  radius_km NUMERIC DEFAULT 1,
  severity TEXT DEFAULT 'high' CHECK (severity IN ('low', 'medium', 'high')),
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Stage 7: resources committed to a dispatch
CREATE TABLE IF NOT EXISTS dispatch_resources (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  dispatch_id UUID REFERENCES dispatches(id) ON DELETE CASCADE,
  resource_id UUID REFERENCES resources(id) ON DELETE CASCADE,
  quantity INTEGER DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Stage 7: match details captured at assignment time
ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS match_score INTEGER;
ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS distance_km NUMERIC;
ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS match_explanation JSONB;
ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_dispatches_status ON dispatches(status);
CREATE INDEX IF NOT EXISTS idx_dispatch_resources_dispatch_id ON dispatch_resources(dispatch_id);
CREATE INDEX IF NOT EXISTS idx_route_hazards_active ON route_hazards(active);

DROP TRIGGER IF EXISTS update_route_hazards_updated_at ON route_hazards;
CREATE TRIGGER update_route_hazards_updated_at BEFORE UPDATE ON route_hazards
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE route_hazards ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispatch_resources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view hazards" ON route_hazards;
CREATE POLICY "Anyone can view hazards" ON route_hazards FOR SELECT USING (true);
DROP POLICY IF EXISTS "Responders can manage hazards" ON route_hazards;
CREATE POLICY "Responders can manage hazards" ON route_hazards FOR ALL USING (true);

DROP POLICY IF EXISTS "Anyone can view dispatch resources" ON dispatch_resources;
CREATE POLICY "Anyone can view dispatch resources" ON dispatch_resources FOR SELECT USING (true);
DROP POLICY IF EXISTS "Responders can manage dispatch resources" ON dispatch_resources;
CREATE POLICY "Responders can manage dispatch resources" ON dispatch_resources FOR ALL USING (true);

-- Existing policies only allowed SELECT/INSERT/UPDATE on teams & dispatches
DROP POLICY IF EXISTS "Admins can delete teams" ON rescue_teams;
CREATE POLICY "Admins can delete teams" ON rescue_teams FOR DELETE USING (true);

-- Stage 7: allow responders to cancel an assignment
ALTER TYPE dispatch_status ADD VALUE IF NOT EXISTS 'cancelled';
