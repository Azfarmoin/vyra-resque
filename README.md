<<<<<<< HEAD
<h1 align="center">VYRA</h1>

<p align="center">
  <strong>Vulnerability, Yielded Response &amp; Assistance</strong>
  <br />
  <em>Finding who needs help most.</em>
</p>

<p align="center">
  An explainable, resource-aware disaster response platform that helps responders prioritize emergencies, coordinate rescue teams, and reach vulnerable communities, even when connectivity is unreliable.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-14-000000?style=for-the-badge&logo=nextdotjs" alt="Next.js 14" />
  <img src="https://img.shields.io/badge/Supabase-Postgres%20%2B%20Auth-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white" alt="Supabase" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Status-Prototype-F59E0B?style=for-the-badge" alt="Prototype" />
</p>

---

## Table of Contents

- [The Mission](#the-mission)
- [Features](#features)
- [Explainable Triage](#explainable-triage)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Demo Accounts and Data](#demo-accounts-and-data)
- [Pages](#pages)
- [API Reference](#api-reference)
- [Flood Simulator](#flood-simulator)
- [User Roles](#user-roles)
- [Offline-First Reporting](#offline-first-reporting)
- [Project Structure](#project-structure)
- [Scripts](#scripts)
- [Testing](#testing)
- [Deployment](#deployment)
- [Contributing](#contributing)
- [Security and Responsible Use](#security-and-responsible-use)
- [Roadmap](#roadmap)
- [License](#license)

=======
# VYRA— Intelligent Disaster Response & Rescue Coordination

<p align="center">
  <strong>Finding Who Needs Help Most.</strong>
  <br />
  An explainable, resource-aware disaster response platform built to help responders prioritize emergencies, coordinate rescue teams, and reach vulnerable communities.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Project-ResQNet-0D9488?style=for-the-badge" alt="ResQNet" />
  <img src="https://img.shields.io/badge/Stack-MERN-2563EB?style=for-the-badge" alt="MERN Stack" />
  <img src="https://img.shields.io/badge/Focus-Disaster%20Response-EF4444?style=for-the-badge" alt="Disaster Response" />
  <img src="https://img.shields.io/badge/Status-In%20Development-F59E0B?style=for-the-badge" alt="In Development" />
</p>

>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
---

## The Mission

<<<<<<< HEAD
When floods, heatwaves, and other disasters overwhelm communities, responders must make hard decisions with limited time, information, and resources.

VYRA answers one question: **who needs help most right now?**

It collects emergency reports, shows them on a map, recommends priorities with a plain-language explanation, and supports dispatching rescue teams, all designed to keep working when the internet does not.

> Technology should not simply show where a disaster is happening. It should help people understand where assistance is needed most.

## Features

| Capability | What it does |
|---|---|
| **Emergency reporting** | Citizens report location, people affected, dangers, injuries, medical needs, and contact details. No account is required. |
| **Explainable triage** | Every report gets a priority level (Critical, High, Medium, Low) and a list of the exact factors behind it. |
| **Responder dashboard** | A ranked triage queue with case detail, verification, status tracking, and priority override with a recorded reason. |
| **Disaster map** | Leaflet map of cases, verified shelters, rescue teams, and blocked roads, with filters. |
| **Resource management** | Rescue teams, supplies (boats, vehicles, first aid, medical, food, water), and shelters. |
| **Team matching and dispatch** | Suggests suitable teams and supplies for a case, and tracks missions through to completion. |
| **Offline reporting** | Reports are queued in IndexedDB and synchronized when connectivity returns. |
| **Multi-channel delivery** | When there is no internet a saved report can also go out by radio, SMS, Bluetooth or manual transfer to a gateway. A report only counts as received when a gateway or the server acknowledges it. See [docs/MULTICHANNEL_DELIVERY.md](docs/MULTICHANNEL_DELIVERY.md). |
| **Shelter placement assistant** | Explainable shelter recommendations, capacity reservations, a shelter dashboard and a coverage map, built on the existing shelter registry. See [SHELTER_ASSISTANT.md](SHELTER_ASSISTANT.md). |
| **Audit trail** | Status changes, verification, and priority overrides are recorded as append-only history. |
| **Admin accounts** | Administrators can create citizen, responder, and admin accounts from the website. |
| **Early warnings** | Location-aware alerts from official feeds (CAP), push, offline cache, admin tools. See [docs/EARLY_WARNING.md](docs/EARLY_WARNING.md). |
| **Disaster zones** | Colour-and-pattern hazard, evacuation, shelter and restricted zones on the map, with an editor for responders and administrators. See [ZONES.md](ZONES.md). |
| **Demo mode** | The whole app runs on in-memory simulated data with no database or sign-up. |
| **AI photo analysis** | Optional, consent-based suggestions from report photos (title, description, hazards), always labelled unverified and reviewed by a responder. See [PHOTO_ANALYSIS.md](PHOTO_ANALYSIS.md). |

## Explainable Triage

VYRA scores reports with transparent, configurable rules instead of an opaque model. The rules live in [`src/lib/triageRules.ts`](src/lib/triageRules.ts), and every number appears in the explanation a responder sees.

Factors considered:

- **Immediate danger:** drowning, trapped, collapse, fire, rising water, electrocution, gas leak, and more.
- **Injuries and medical need:** severity, number injured, life-sustaining needs (dialysis, oxygen, insulin, and so on).
- **Evacuation difficulty and vulnerability:** people who cannot leave unaided, plus elderly, infants, disability, pregnancy.
- **People affected:** banded by group size.
- **Waiting time:** points accrue the longer an open request waits.
- **Free-text cues:** phrases such as "not breathing" or "trapped", always labelled as text-derived.

| Level | Score threshold |
|---|---|
| Critical | 70 and above |
| High | 45 to 69 |
| Medium | 20 to 44 |
| Low | below 20 |

**Safety principles**

- Recommendations support human decisions; they do not replace trained emergency personnel.
- **Missing information is never treated as low risk.** Unknown key fields add points, raise a "verify" flag, and can set a Medium floor.
- Authorized responders can override any recommendation, and the reason is recorded.

## Architecture

```mermaid
flowchart TD
    A[Citizen Emergency Report] --> B[Next.js Frontend]
    B --> C[Next.js API Routes]
    C --> D[Validation with zod]
    D --> E[(Supabase Postgres)]
=======
When floods, heatwaves, and other disasters overwhelm communities, emergency responders must make difficult decisions with limited time, information, and resources.

**ResQNet helps answer one critical question: Who needs help most right now?**

The platform collects emergency reports, visualizes affected locations, provides explainable urgency recommendations, and supports coordinated rescue-team dispatch. It is designed to work with unreliable internet connectivity and to help responders make better-informed decisions.

> Technology should not simply show where a disaster is happening. It should help people understand where assistance is needed most.

## The Problem

Traditional disaster response can face several challenges:

- Emergency requests scattered across multiple communication channels.
- Difficulty identifying life-threatening situations quickly.
- Limited visibility into available rescue teams and supplies.
- Vulnerable people who may struggle to evacuate independently.
- Unreliable connectivity during floods and other emergencies.
- Limited transparency into why one emergency is prioritized over another.

## The Solution

ResQNet brings emergency reporting, triage, mapping, and resource coordination into one platform.

| Capability | What it does |
|---|---|
| Emergency reporting | Collects location, affected-person count, immediate dangers, injuries, and medical needs. |
| Explainable triage | Recommends case priorities and explains the factors behind each recommendation. |
| Disaster map | Displays reported emergencies and verified operational information geographically. |
| Resource management | Tracks rescue teams, vehicles, boats, medical supplies, and shelters. |
| Team dispatch | Helps authorized responders assign suitable teams to emergency cases. |
| Offline reporting | Queues reports locally and synchronizes them when connectivity returns. |
| Real-time coordination | Updates dashboards when reports or assignments change. |
| Audit trail | Records important decisions and changes for operational accountability. |

## Core Innovation — Explainable Emergency Triage

ResQNet is designed to prioritize reported needs using transparent, configurable rules rather than an unexplained score.

Potential factors include:

- **Immediate danger:** Is someone's life in immediate danger?
- **Medical urgency:** Are serious injuries or essential medical needs reported?
- **Evacuation difficulty:** Does someone require assistance to escape danger?
- **People affected:** How many people may need assistance?
- **Waiting time:** How long has the request remained unresolved?

Each recommendation should include:

1. A suggested priority level.
2. The specific factors that influenced the recommendation.
3. The current report status and relevant information.
4. A way for authorized responders to review and override the recommendation, with a recorded reason.

**Safety principle:** Triage recommendations support human decision-making; they do not replace trained emergency personnel. Missing information must not automatically be interpreted as evidence of low risk.

## System Architecture

```mermaid
flowchart TD
    A[Citizen Emergency Report] --> B[React Frontend]
    B --> C[Express REST API]
    C --> D[Validation and Authentication]
    D --> E[(MongoDB Database)]
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
    E --> F[Explainable Triage Engine]
    F --> G[Responder Dashboard]
    G --> H[Disaster Map]
    G --> I[Resource Management]
    I --> J[Team Dispatch]
<<<<<<< HEAD
=======
    C --> K[Socket.IO Events]
    K --> G
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
    B --> L[IndexedDB Offline Queue]
    L --> M[Sync When Online]
    M --> C
```

<<<<<<< HEAD
The data layer is swappable: the same API routes run against Supabase (`supabaseStore.ts`) or an in-memory store (`memoryStore.ts`) depending on configuration.

## Tech Stack

- **App:** Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS
- **Data and auth:** Supabase (Postgres, Auth) via `@supabase/supabase-js`
- **Maps:** Leaflet and React Leaflet
- **Validation:** zod
- **Offline:** IndexedDB queue and a service worker
- **Tests:** `tsx --test`
- **Hosting:** Vercel (app) and Supabase cloud (database)

## Getting Started

**Requirements:** Node.js 18 or newer, and npm.

### Option 1: Try it with no setup (demo mode)

```bash
npm install
npm run dev:demo
```

Open <http://localhost:3000>. Data is simulated and held in memory, and the sign-in page lists the demo accounts.

### Option 2: Run against your own Supabase cloud project

```bash
npm install
cp .env.example .env.local        # Windows PowerShell: copy .env.example .env.local
```

1. Create a project at <https://supabase.com> and note the database password.
2. In **Project Settings → API Keys**, copy the **Project URL** and **Publishable key**.
3. Fill in `.env.local` (see [Environment Variables](#environment-variables)).
4. Create the tables and load the demo data:

   ```bash
   npm run db:setup -- --seed
   ```

5. Start the app:

   ```bash
   npm run dev
   ```

6. Verify the connection: `curl http://localhost:3000/api/demo/auth` should return `{"demo":false}`.

Prefer the SQL Editor? Paste `supabase/vyra_complete_schema.sql`, then `supabase/migrations/001_stage7_8_dispatch_offline.sql`, then `supabase/seed/vyra_full_seed.sql`. The full walkthrough, including Supabase auth settings and troubleshooting, is in **[SETUP_GUIDE.md](SETUP_GUIDE.md)**.

## Environment Variables

Copy `.env.example` to `.env.local`. Never commit `.env.local`.

| Variable | Required | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes (cloud) | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes (cloud) | Publishable key (the older `anon` key also works) |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional | **Server only.** Lets admins create pre-confirmed accounts. Never prefix with `NEXT_PUBLIC_`. |
| `DATABASE_URL` | Local setup only | Session pooler connection string for `db:setup` and `db:seed`. Do not add it to Vercel. |
| `SEED_PASSWORD` | Local setup only | Password given to all seeded demo accounts (default `VYRA-demo-1`) |
| `VYRA_DATA_MODE` | Optional | Set to `demo` to force in-memory mode |

## Demo Accounts and Data

The seed loads a fictional urban-flooding scenario across ten Karachi areas:

| Data | Count |
|---|---|
| Accounts | 30 (1 administrator, 9 responders, 20 citizens) |
| Emergency cases | 30, covering every urgency level and status |
| Rescue teams, supplies, shelters | 30 each |
| Route hazards and blocked roads | 30 each |
| Missions | 30 (8 live, 16 completed, 6 cancelled) |

Sample sign-ins (password is your `SEED_PASSWORD`, or `VYRA-demo-1`):

| Role | Email |
|---|---|
| Administrator | `admin@demo.vyra` |
| Responder | `dispatcher@demo.vyra`, `fieldlead@demo.vyra`, `logistics@demo.vyra` |
| Citizen | `citizen@demo.vyra`, `neighbour@demo.vyra` |

Run `npm run db:seed` at any time to reset the demo data. Details are in [DEMO_DATA.md](DEMO_DATA.md).

## Pages

| Route | Description |
|---|---|
| `/` | Home and live incident preview |
| `/report` | Submit an emergency report (no sign-in needed, works offline) |
| `/report/[id]` | Case detail and public status for the reporter |
| `/dashboard` | Responder triage queue and case detail |
| `/map` | Disaster map with cases, shelters, teams, and blocked roads |
| `/dispatches` | Missions and team assignments |
| `/resources` | Teams, supplies, and shelters |
| `/shelters` | Shelter placement assistant: find a shelter, reservations, dashboard, coverage (responders and administrators) |
| `/admin/users` | Create and list accounts (administrators only) |
| `/auth/login`, `/auth/register` | Sign in and sign up |

## API Reference

| Method | Endpoint | Purpose |
|---|---|---|
| POST, GET | `/api/reports` | Submit or list reports |
| GET, PATCH | `/api/reports/:id` | Retrieve or update a report |
| PATCH | `/api/reports/:id/status` | Update status |
| PATCH | `/api/reports/:id/verify` | Verify a report |
| PATCH | `/api/reports/:id/triage-override` | Override priority with a recorded reason |
| GET | `/api/reports/:id/matches` | Suggested teams and supplies |
| GET | `/api/reports/:id/public-status` | Reference number and status for the reporter |
| GET | `/api/triage`, `/api/triage/rules` | Priority queue and rules |
| GET | `/api/map/layers` | Verified shelters, teams, and blocked roads |
| GET, POST | `/api/teams`, PATCH, DELETE `/api/teams/:id` | Rescue teams |
| GET, POST | `/api/resources`, PATCH, DELETE `/api/resources/:id` | Supplies |
| GET, POST | `/api/shelters` | Shelters: public list (verified, public fields) or full staff view; create is administrators only |
| GET, PATCH | `/api/shelters/:id` | Shelter detail, headcount update (responders), registry edit (administrators) |
| POST | `/api/shelters/recommend` | Explained shelter ranking for a group |
| GET, POST | `/api/shelters/reservations`, PATCH `/api/shelters/reservations/:id` | Hold places; confirm arrival, depart, cancel, extend |
| GET | `/api/shelters/dashboard` | Occupancy, stale records, access problems, exposure |
| GET, POST | `/api/shelters/coverage` | Coverage grid and hypothetical-site comparison |
| GET, POST, DELETE | `/api/shelters/exceptions` | Authorized exceptions (administrators write) |
| POST, GET | `/api/shelters/reconcile`, `/api/shelters/audit` | Reconciliation and audit trail (administrators) |
| POST | `/api/gateway/ingest`, `/api/gateway/sms` | Radio / SMS gateways hand over short emergency messages (API key or signed Twilio request) |
| GET, POST | `/api/hazards`, PATCH, DELETE `/api/hazards/:id` | Route hazards |
| GET, POST | `/api/dispatches`, PATCH `/api/dispatches/:id` | Missions |
| GET, POST | `/api/admin/users` | Admin account management |
| GET | `/api/demo/auth` | Reports whether the app is in demo mode |

## Flood Simulator

Responders and administrators get a **Flood simulator** button on the live map: draw or choose a Karachi area, run a hypothetical
water level, a terrain-based estimate or imported model output, see affected shelters, hospitals, roads and buildings with data-quality
labels, compare and save scenarios separately from real incidents, and export a PDF/HTML/GeoJSON/JSON report. Everything is labelled an
estimate. See [FLOOD_SIMULATOR.md](FLOOD_SIMULATOR.md) for setup, data and limitations, and [docs/PROJECT_AUDIT.md](docs/PROJECT_AUDIT.md)
for the security audit. **Apply migrations 011 and 012** (in `scripts/setup-db.js`) before deploying.

## User Roles

| Role | Responsibilities |
|---|---|
| **Citizen** | Submit reports and view the status of their submissions |
| **Responder** | Review cases, update statuses, and coordinate field operations |
| **Administrator** | Manage accounts, teams, resources, shelters, and dispatch decisions |

> **Note:** At present a role decides where a user lands after sign-in and which admin features appear. Server-side role enforcement and tighter database policies are still on the roadmap (see [Security](#security-and-responsible-use)).

To promote your own account, register normally and then run in the Supabase SQL Editor:

```sql
UPDATE profiles SET role = 'admin' WHERE email = 'you@example.com';
```

## Offline-First Reporting
=======
## Technology Stack

### Frontend
- React
- Vite
- JavaScript
- Tailwind CSS
- React Router
- Leaflet / React Leaflet
- Socket.IO Client
- IndexedDB for offline storage

### Backend
- Node.js
- Express.js
- MongoDB
- Mongoose
- JSON Web Tokens (JWT)
- bcrypt
- Socket.IO

### Development and Deployment
- Git and GitHub
- Postman
- Vercel or another static frontend host
- Render or another Node.js-compatible backend host
- MongoDB Atlas or a local MongoDB instance

*These are the intended technologies; update this list to reflect the libraries and services actually implemented.*

## Project Structure

```text
ResQNet/
├── client/
│   ├── public/
│   └── src/
│       ├── components/
│       │   ├── common/
│       │   ├── dashboard/
│       │   ├── map/
│       │   └── reports/
│       ├── pages/
│       ├── features/
│       ├── hooks/
│       ├── services/
│       ├── offline/
│       ├── utils/
│       ├── App.jsx
│       └── main.jsx
├── server/
│   ├── src/
│   │   ├── config/
│   │   ├── models/
│   │   ├── controllers/
│   │   ├── routes/
│   │   ├── services/
│   │   ├── middleware/
│   │   ├── sockets/
│   │   ├── validators/
│   │   ├── seed/
│   │   └── server.js
│   └── tests/
├── docs/
├── .github/
│   └── workflows/
├── .gitignore
├── package.json
└── README.md
```

## Emergency Reporting Workflow
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895

```mermaid
flowchart TD
    A[Submit Emergency] --> B{Internet Available?}
    B -- Yes --> C[Send Report to API]
    B -- No --> D[Save Report Locally]
    D --> E[Wait for Connectivity]
    E --> C
    C --> F[Validate and Store Report]
    F --> G[Generate Priority Recommendation]
<<<<<<< HEAD
    G --> H[Responders Review and Dispatch]
```

- Draft reports are stored in IndexedDB and submissions are queued when the backend is unreachable.
- Sync retries when connectivity returns, using unique report identifiers to reduce duplicates.
- The UI shows clear pending, synchronized, and failed states.

Offline storage does not transmit anything by itself. Reports stay pending until a connection exists, and they can be lost if device storage is cleared or the device is damaged.

## Project Structure

```text
VYRA/
├── src/
│   ├── app/              # Pages and API routes (App Router)
│   ├── components/       # UI grouped by feature (map, dashboard, reports, ...)
│   ├── hooks/            # useOfflineSync
│   └── lib/              # triage, matching, dispatch, offline queue, stores, demo data
├── supabase/
│   ├── vyra_complete_schema.sql    # Tables, indexes, triggers, security rules
│   ├── vyra_complete_setup.sql     # Schema + migration + seed in one file
│   ├── migrations/
│   └── seed/vyra_full_seed.sql     # Demo accounts and simulated data
├── scripts/              # db:setup, db:seed, seed generators
├── public/sw.js          # Service worker
├── tests/                # triage, API, ops, admin tests
├── SETUP_GUIDE.md        # Cloud Supabase setup, step by step
├── DEMO_DATA.md          # What the demo data contains
└── PROJECT_PLAN.md       # Original scope and schema plan
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the app against your Supabase project |
| `npm run dev:demo` | Start with in-memory demo data |
| `npm run build` / `npm start` | Production build and server |
| `npm run lint` | Run ESLint |
| `npm test` | Run the triage, API, ops, and admin tests |
| `npm run db:setup` | Create or update the tables |
| `npm run db:setup -- --seed` | Tables plus the full demo seed |
| `npm run db:seed` | Reset the demo data and accounts only |
| `npm run db:seed:generate` | Rebuild the seed SQL after editing the demo data files |

## Testing

```bash
npm test
```

Tests cover the triage engine, API routes, dispatch and operations logic, and admin account handling. Run `npm run build` before opening a pull request to catch type and lint errors.

**Example demo scenario (urban flooding):**

1. A citizen reports a flooded home with several occupants.
2. A second report describes a person with an urgent medical need.
3. The dashboard ranks both and shows the factors behind each priority.
4. A responder reviews the cases and assigns an available rescue team.
5. The dashboard reflects the assignment and the new status.
6. A third report, prepared offline, syncs when the connection returns.

## Deployment

VYRA deploys to **Vercel** with **Supabase cloud** as the database.

1. Push the repository to GitHub, and develop on feature branches merged through pull requests.
2. In Vercel choose **Add New → Project**, import the repository, and keep the detected Next.js settings.
3. Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (and optionally `SUPABASE_SERVICE_ROLE_KEY`) as environment variables. Do **not** add `DATABASE_URL` or `SEED_PASSWORD`.
4. Deploy, then in Supabase set **Authentication → URL Configuration → Site URL** to your Vercel address and add it to the Redirect URLs.
5. Every pull request now gets a preview deployment, and every merge to `main` deploys to production.

## Contributing

1. Fork the repository.
2. Create a branch: `git switch -c feature/your-change`
3. Make and test your changes (`npm test`, `npm run build`).
4. Confirm no secrets or `.env` files are staged.
5. Push the branch and open a pull request describing what changed and how you tested it.

Contributions of all kinds are welcome: testing, accessibility, documentation, and responsible feature suggestions.

## Security and Responsible Use

VYRA is a **prototype**. It is not a certified emergency-dispatch system and does not replace official emergency services or trained rescue personnel.

**Known limitations to resolve before real emergency data is stored:**

- The `profiles` role-escalation hole is closed by `supabase/migrations/011_profiles_role_hardening.sql` (apply it). Other tables' policies in `vyra_complete_schema.sql` are still permissive, and several staff-only API routes (teams, resources, dispatches, report status/verify/override, shelters) still have no authentication: see `docs/PROJECT_AUDIT.md` before any public deployment.
- Roles are not yet enforced in pages or API routes.
- Seeded demo accounts share a password that is public in this repository unless you set `SEED_PASSWORD`.

**Good practice**

- Use simulated data for public demos.
- Never commit `.env.local`, keys, or real contact details.
- Keep `SUPABASE_SERVICE_ROLE_KEY` on the server only.
- Restrict access to contact details and sensitive locations by role.
- Label unverified reports and stale location data clearly.

## Roadmap

- [x] Stage 1: Requirements and scope
- [x] Stage 2: User interface
- [x] Stage 3: Backend and database models
- [x] Stage 4: Emergency reporting
- [x] Stage 5: Disaster map
- [x] Stage 6: Explainable triage
- [x] Stage 7: Resource management and dispatch
- [x] Stage 8: Offline reporting and synchronization
- [ ] Stage 9: Real-time updates (currently polling), role enforcement, tightened database policies
- [ ] Stage 10: Final testing, deployment hardening, and presentation

## License

No license file is included yet. Add a `LICENSE` file (for example MIT) before distributing or accepting outside contributions.
=======
    G --> H[Notify Responders]
    H --> I[Review and Dispatch]
    I --> J[Track Resolution]
```

Reports should support GPS coordinates or manual location selection, the number of people affected, immediate dangers, medical needs, and available contact information. Duplicate detection and synchronization status should help operators distinguish pending reports from confirmed server records.

## Getting Started

### Prerequisites

Install the following before running the project:

- Node.js (an active LTS version)
- npm
- MongoDB locally or a MongoDB Atlas connection
- Git

### 1. Clone the Repository

```bash
git clone https://github.com/YOUR_USERNAME/ResQNet.git
cd ResQNet
```

Replace `YOUR_USERNAME/ResQNet` with your actual GitHub repository URL.

### 2. Install Dependencies

```bash
npm install
npm install --prefix client
npm install --prefix server
```

These commands assume the root, client, and server each have their own `package.json`.

### 3. Configure Environment Variables

Create `server/.env`:

```env
PORT=5000
NODE_ENV=development
MONGODB_URI=mongodb://127.0.0.1:27017/resqnet
JWT_SECRET=replace_with_a_long_random_secret
CLIENT_URL=http://localhost:5173
```

Create `client/.env`:

```env
VITE_API_URL=http://localhost:5000/api
```

Use your actual database connection string where necessary. Never commit `.env` files, production secrets, credentials, or real emergency-contact information to GitHub.

### 4. Start the Backend

```bash
npm run dev --prefix server
```

### 5. Start the Frontend

Open another terminal in the project root:

```bash
npm run dev --prefix client
```

Open the local URL displayed by Vite, usually `http://localhost:5173`.

**Note:** These commands require corresponding scripts to exist in each `package.json`. If your project uses different scripts or ports, adjust this section accordingly.

## Suggested API Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/auth/register` | Register an account |
| POST | `/api/auth/login` | Authenticate a user |
| POST | `/api/reports` | Submit an emergency report |
| GET | `/api/reports` | Retrieve authorized reports |
| GET | `/api/reports/:id` | Retrieve an individual report |
| PATCH | `/api/reports/:id/status` | Update report status |
| GET | `/api/triage` | Retrieve priority recommendations |
| GET | `/api/teams` | List available rescue teams |
| POST | `/api/dispatches` | Create a team assignment |
| GET | `/api/resources` | View resource availability |
| GET | `/api/shelters` | View verified shelter information |

These are proposed endpoints, not a claim that they have already been implemented.

## User Roles

| Role | Responsibilities |
|---|---|
| Citizen | Submit emergency reports and view permitted submission status. |
| Responder | Review assigned cases, update statuses, and coordinate field operations. |
| Administrator | Manage users, rescue teams, resources, shelters, and dispatch decisions. |

Access to sensitive personal and operational information must be restricted according to role and operational need.

## Offline-First Design

Disasters can disrupt internet access and power infrastructure. ResQNet aims to:

- Store draft reports in IndexedDB.
- Queue submissions when the backend is unreachable.
- Retry synchronization when connectivity returns.
- Use unique report identifiers and idempotent server operations to reduce duplicates.
- Display clear pending, synchronized, and failed states.

Offline storage does not itself transmit reports. Reports remain pending until a working communication path becomes available. Users should be warned that locally stored reports may be lost if device storage is cleared or the device is damaged.

## Testing and Demo Scenario

Use simulated data only for the hackathon demonstration.

**Example: Urban flooding**

1. A citizen submits a report describing a flooded home with several occupants.
2. Another report describes a person with an urgent medical need.
3. The responder dashboard receives both reports.
4. ResQNet displays the relevant triage factors and suggested priorities.
5. An authorized responder reviews the cases and assigns an available rescue team.
6. The dashboard reflects the assignment and updated case status.
7. A third report is prepared offline and synchronized when the connection returns.

The demo should show that recommendations are explainable, reports are traceable, and final dispatch decisions remain under human control.

## Roadmap

- [ ] Stage 1 — Define requirements and project scope.
- [ ] Stage 2 — Build the React user interface.
- [ ] Stage 3 — Implement the backend and MongoDB models.
- [ ] Stage 4 — Implement emergency reporting.
- [ ] Stage 5 — Display reports on the disaster map.
- [ ] Stage 6 — Build explainable triage recommendations.
- [ ] Stage 7 — Implement resource management and dispatch.
- [ ] Stage 8 — Implement offline reporting and synchronization.
- [ ] Stage 9 — Add real-time updates, security, and audit logs.
- [ ] Stage 10 — Test, deploy, and prepare the hackathon presentation.

Mark each item complete only after the corresponding feature has been implemented and tested.

## Security and Responsible Use

- Validate incoming data on the server.
- Enforce role-based access controls.
- Protect authentication tokens and environment secrets.
- Limit access to contact details and sensitive locations.
- Keep an audit trail of important triage overrides and dispatch decisions.
- Label unverified reports and stale location data clearly.
- Use simulated emergency data during public demos.
- Do not represent the MVP as a certified emergency-dispatch system.

ResQNet is a prototype intended to support disaster-response coordination. It is not a replacement for official emergency services or trained rescue personnel.

## Contributing

Contributions, testing, accessibility improvements, documentation, and responsible feature suggestions are welcome.

1. Fork the repository.
2. Create a feature branch.
3. Implement and test your changes.
4. Submit a pull request describing the change.

## License

This project is released under the MIT License, unless another license is selected in the repository. Add a corresponding `LICENSE` file before claiming that the project is officially licensed.
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895

---

<p align="center">
<<<<<<< HEAD
  <strong>VYRA</strong>
  <br />
  Prioritize needs. Coordinate resources. Help communities recover.
</p>

## Offline-first reporting

Reports can be written and saved with no connection and sync automatically later. Setup, schema, airplane-mode test steps and limits: see [OFFLINE.md](OFFLINE.md).

## Satellite imagery comparison

Responders and administrators can compare satellite imagery from two periods, see candidate surface-water and vegetation changes on the map, and link reviewed findings to incidents, hazards and zones. Findings are advisory and never trigger emergency actions. Setup, environment variables, provider access, limits and tests: see [SATELLITE.md](SATELLITE.md).

## Multi-channel delivery

Delivery no longer waits for Wi-Fi: a saved report can also be handed over by radio, SMS, Bluetooth and manual transfer. Gateway ingestion stays off until `GATEWAY_API_KEY` is set. Setup, channels, acknowledgement rules and limits: see [docs/MULTICHANNEL_DELIVERY.md](docs/MULTICHANNEL_DELIVERY.md).

## Shelter placement assistant

Explainable shelter recommendations, capacity reservations, a shelter dashboard and a coverage map, built on the existing shelter registry. See **SHELTER_ASSISTANT.md** (features, setup, what is and is not implemented) and **SECURITY_REVIEW.md** (role-escalation fixes and the remaining pre-launch risks). Every state-changing operations route (verify, triage override, dispatch, supplies, teams) now requires a signed-in responder or administrator, and demo sign-in is refused in production unless `VYRA_ALLOW_DEMO_IN_PRODUCTION=true`.
=======
  <strong>ResQNet</strong>
  <br />
  Prioritize needs. Coordinate resources. Help communities recover.
</p>
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
