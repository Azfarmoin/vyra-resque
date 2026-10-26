<<<<<<< HEAD
# VYRA Project Plan
=======
# ResQNet Project Plan
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895

## Stage 1: Project Scope and Features

### Core Features

#### 1. Emergency Reporting System
- Citizens can submit emergency reports with:
  - GPS location or manual location selection
  - Number of people needing assistance
  - Injury or immediate danger details
  - Medical needs (essential medication)
  - Contact information (optional)

#### 2. Responder Dashboard
- View all emergency reports
- Filter by area, status, and urgency
- See priority rankings with explanations
- Assign rescue teams to cases
- Track case status updates

#### 3. Disaster Map
- Display emergency locations on interactive map
- Different markers for urgency levels
- Show shelters, rescue teams, and blocked roads
- Filter reports by area and status

#### 4. Resource Management
- Register rescue teams and capabilities
- Track vehicles, boats, first-aid kits, medical supplies
- View resource availability
- Match urgent cases with available teams

#### 5. Authentication & Authorization
- User registration and login
- Role-based access (Citizen, Responder, Administrator)
- Secure session management

### User Roles

| Role | Permissions |
|------|-------------|
| Citizen | Submit emergency reports, view own report status |
| Responder | View all reports, update statuses, assign teams |
| Administrator | Manage users, teams, resources, shelters |

### Database Schema (Supabase)

#### Tables

1. **profiles**
   - id (uuid, primary key)
   - email (text, unique)
   - full_name (text)
   - role (enum: citizen, responder, admin)
   - created_at (timestamp)
   - updated_at (timestamp)

2. **emergency_reports**
   - id (uuid, primary key)
   - reporter_id (uuid, references profiles)
   - location_lat (numeric)
   - location_lng (numeric)
   - location_address (text)
   - people_count (integer)
   - immediate_danger (boolean)
   - injury_details (text)
   - medical_needs (text)
   - contact_info (text)
   - status (enum: pending, investigating, assigned, resolved)
   - priority_score (integer)
   - priority_explanation (jsonb)
   - created_at (timestamp)
   - updated_at (timestamp)

3. **rescue_teams**
   - id (uuid, primary key)
   - team_name (text)
   - team_leader (text)
   - contact_number (text)
   - capabilities (text[])
   - current_location_lat (numeric)
   - current_location_lng (numeric)
   - status (enum: available, assigned, unavailable)
   - created_at (timestamp)
   - updated_at (timestamp)

4. **resources**
   - id (uuid, primary key)
   - resource_type (enum: vehicle, boat, first_aid, medical_supplies, food, water)
   - quantity (integer)
   - team_id (uuid, references rescue_teams)
   - status (enum: available, in_use, maintenance)
   - created_at (timestamp)
   - updated_at (timestamp)

5. **dispatches**
   - id (uuid, primary key)
   - report_id (uuid, references emergency_reports)
   - team_id (uuid, references rescue_teams)
   - assigned_by (uuid, references profiles)
   - assigned_at (timestamp)
   - status (enum: pending, en_route, on_scene, completed)
   - notes (text)
   - created_at (timestamp)
   - updated_at (timestamp)

6. **shelters**
   - id (uuid, primary key)
   - name (text)
   - location_lat (numeric)
   - location_lng (numeric)
   - address (text)
   - capacity (integer)
   - current_occupancy (integer)
   - contact_number (text)
   - status (enum: open, full, closed)
   - created_at (timestamp)
   - updated_at (timestamp)

### Technology Stack

**Frontend:**
- Next.js 14 (App Router)
- TypeScript
- Tailwind CSS
- shadcn/ui components
- React Leaflet (for maps)
- Supabase Auth Client

**Backend:**
- Next.js API Routes
- Supabase (PostgreSQL database)
- Supabase Auth
- Supabase Realtime (for future real-time features)

**Development:**
- ESLint
- Prettier
- Git

### API Routes Structure

```
/api/auth/
  - register (POST)
  - login (POST)
  - logout (POST)
  - session (GET)

/api/reports/
  - (GET) - List all reports (responder/admin)
  - (POST) - Create new report
  - [id]/ (GET) - Get single report
  - [id]/status (PATCH) - Update report status

/api/teams/
  - (GET) - List all teams
  - (POST) - Create team (admin)
  - [id]/ (GET, PATCH, DELETE)

/api/resources/
  - (GET) - List all resources
  - (POST) - Add resource (admin)

/api/dispatches/
  - (GET) - List all dispatches
  - (POST) - Create dispatch
  - [id]/status (PATCH) - Update dispatch status

/api/shelters/
  - (GET) - List all shelters
  - (POST) - Add shelter (admin)
```

### Future Stages (Foundation for Later Implementation)

- **Stage 4:** Complete emergency reporting with offline queue
- **Stage 5:** Enhanced disaster map with real-time updates
- **Stage 6:** Explainable triage engine with priority scoring
- **Stage 7:** Advanced resource matching algorithms
- **Stage 8:** IndexedDB offline storage and sync
- **Stage 9:** Socket.IO real-time updates
- **Stage 10:** Testing, deployment, and demo preparation
