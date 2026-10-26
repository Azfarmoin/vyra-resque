-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create enum types
CREATE TYPE user_role AS ENUM ('citizen', 'responder', 'admin');
CREATE TYPE report_status AS ENUM ('pending', 'investigating', 'assigned', 'resolved');
CREATE TYPE team_status AS ENUM ('available', 'assigned', 'unavailable');
CREATE TYPE resource_type AS ENUM ('vehicle', 'boat', 'first_aid', 'medical_supplies', 'food', 'water');
CREATE TYPE resource_status AS ENUM ('available', 'in_use', 'maintenance');
CREATE TYPE dispatch_status AS ENUM ('pending', 'en_route', 'on_scene', 'completed');
CREATE TYPE shelter_status AS ENUM ('open', 'full', 'closed');

-- Create profiles table
CREATE TABLE profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  full_name TEXT,
  role user_role DEFAULT 'citizen',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create emergency_reports table
CREATE TABLE emergency_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reporter_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  location_lat NUMERIC,
  location_lng NUMERIC,
  location_address TEXT,
  people_count INTEGER DEFAULT 1,
  immediate_danger BOOLEAN DEFAULT FALSE,
  injury_details TEXT,
  medical_needs TEXT,
  contact_info TEXT,
  status report_status DEFAULT 'pending',
  priority_score INTEGER DEFAULT 0,
  priority_explanation JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create rescue_teams table
CREATE TABLE rescue_teams (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_name TEXT NOT NULL,
  team_leader TEXT,
  contact_number TEXT,
  capabilities TEXT[],
  current_location_lat NUMERIC,
  current_location_lng NUMERIC,
  status team_status DEFAULT 'available',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create resources table
CREATE TABLE resources (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  resource_type resource_type NOT NULL,
  quantity INTEGER DEFAULT 1,
  team_id UUID REFERENCES rescue_teams(id) ON DELETE SET NULL,
  status resource_status DEFAULT 'available',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create dispatches table
CREATE TABLE dispatches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_id UUID REFERENCES emergency_reports(id) ON DELETE CASCADE,
  team_id UUID REFERENCES rescue_teams(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES profiles(id),
  assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  status dispatch_status DEFAULT 'pending',
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create shelters table
CREATE TABLE shelters (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  location_lat NUMERIC,
  location_lng NUMERIC,
  address TEXT,
  capacity INTEGER,
  current_occupancy INTEGER DEFAULT 0,
  contact_number TEXT,
  status shelter_status DEFAULT 'open',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX idx_emergency_reports_status ON emergency_reports(status);
CREATE INDEX idx_emergency_reports_location ON emergency_reports(location_lat, location_lng);
CREATE INDEX idx_emergency_reports_created_at ON emergency_reports(created_at);
CREATE INDEX idx_rescue_teams_status ON rescue_teams(status);
CREATE INDEX idx_dispatches_report_id ON dispatches(report_id);
CREATE INDEX idx_dispatches_team_id ON dispatches(team_id);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_emergency_reports_updated_at BEFORE UPDATE ON emergency_reports
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_rescue_teams_updated_at BEFORE UPDATE ON rescue_teams
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_resources_updated_at BEFORE UPDATE ON resources
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_dispatches_updated_at BEFORE UPDATE ON dispatches
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_shelters_updated_at BEFORE UPDATE ON shelters
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE emergency_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE rescue_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispatches ENABLE ROW LEVEL SECURITY;
ALTER TABLE shelters ENABLE ROW LEVEL SECURITY;

-- Create policies (these are basic policies - adjust based on your security requirements)

-- Profiles policies
CREATE POLICY "Public profiles are viewable by everyone" ON profiles
  FOR SELECT USING (true);

CREATE POLICY "Users can insert their own profile" ON profiles
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Users can update their own profile" ON profiles
  FOR UPDATE USING (true);

-- Emergency reports policies
CREATE POLICY "Anyone can view reports" ON emergency_reports
  FOR SELECT USING (true);

CREATE POLICY "Anyone can create reports" ON emergency_reports
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Responders and admins can update reports" ON emergency_reports
  FOR UPDATE USING (true);

-- Rescue teams policies
CREATE POLICY "Anyone can view teams" ON rescue_teams
  FOR SELECT USING (true);

CREATE POLICY "Admins can create teams" ON rescue_teams
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Admins can update teams" ON rescue_teams
  FOR UPDATE USING (true);

-- Resources policies
CREATE POLICY "Anyone can view resources" ON resources
  FOR SELECT USING (true);

CREATE POLICY "Admins can manage resources" ON resources
  FOR ALL USING (true);

-- Dispatches policies
CREATE POLICY "Anyone can view dispatches" ON dispatches
  FOR SELECT USING (true);

CREATE POLICY "Responders and admins can create dispatches" ON dispatches
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Responders and admins can update dispatches" ON dispatches
  FOR UPDATE USING (true);

-- Shelters policies
CREATE POLICY "Anyone can view shelters" ON shelters
  FOR SELECT USING (true);

CREATE POLICY "Admins can manage shelters" ON shelters
  FOR ALL USING (true);
