# Duty Sync

A scalable, automated, and fair digital system for military duty roster management.

## Overview

Duty Sync replaces manual duty roster processes with intelligent scheduling, ensuring fair distribution of duties across personnel while respecting qualifications, availability, and rank requirements.

## Features (MVP)

- **Dark Mode First UI** - Professional military theme with Navy Blue/Black color scheme
- **Role-Based Access Control** - App Admin, Unit Admin, and Standard User roles
- **Unit Hierarchy Management** - Battalion → Company → Platoon → Section structure
- **Secure Authentication** - Auth.js with JWT-based session management
- **Personnel Management** - CSV import and manual entry of personnel data
- **Duty Types Configuration** - Configure duty types with requirements and point values
- **Duty Thruster Algorithm** - Automated fair scheduling based on duty scores
- **Calendar View** - Monthly calendar displaying duty assignments
- **Non-Availability Workflow** - Request and approve duty exemptions
- **Export Functionality** - Export rosters to CSV/Excel and PDF

## Tech Stack

| Component | Technology |
|-----------|------------|
| Frontend | Next.js 14 (App Router, React 19) |
| Styling | Tailwind CSS v4 |
| API/Backend | Hasura Cloud (GraphQL Engine) |
| Database | Neon (PostgreSQL Serverless) |
| Authentication | Auth.js (NextAuth.js) |
| Scheduling Engine | Serverless Function (Next.js API Routes) |

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- Neon PostgreSQL database (for production)
- Hasura Cloud account (for production)

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/your-org/duty-sync.git
   cd duty-sync
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables:
   ```bash
   cp .env.example .env.local
   ```
   Edit `.env.local` with your configuration.

4. Run the development server:
   ```bash
   npm run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000) in your browser.

### Default Admin Credentials

For development, a default admin account is available:
- **Username:** admin
- **Password:** admin123

## Database Setup

The database schema is located in `database/schema.sql`. To set up your Neon PostgreSQL database:

1. Create a new Neon project at [neon.tech](https://neon.tech)
2. Run the schema SQL in the Neon SQL Editor
3. Update your `.env.local` with the connection string

### Hasura Setup

1. Create a Hasura Cloud project
2. Connect to your Neon database
3. Track all tables in the schema
4. Configure permissions as documented in `schema.sql`

## Project Structure

```
duty-sync/
├── src/
│   ├── app/                    # Next.js App Router pages
│   │   ├── (auth)/            # Authentication pages (login, signup)
│   │   ├── (dashboard)/       # Protected dashboard pages
│   │   │   ├── admin/         # Admin-only pages
│   │   │   │   ├── duty-types/    # Duty types configuration
│   │   │   │   ├── non-availability/ # Non-availability management
│   │   │   │   ├── personnel/     # Personnel management
│   │   │   │   ├── scheduler/     # Duty Thruster scheduler
│   │   │   │   ├── units/         # Unit sections management
│   │   │   │   └── users/         # User management
│   │   │   ├── profile/       # User profile
│   │   │   └── roster/        # Duty roster calendar
│   │   └── api/               # API routes
│   ├── components/            # React components
│   │   ├── ui/               # Reusable UI components
│   │   └── layout/           # Layout components
│   ├── lib/                   # Utility functions and configurations
│   │   ├── auth.ts           # Auth.js configuration
│   │   ├── duty-thruster.ts  # Scheduling algorithm
│   │   └── stores.ts         # In-memory stores (MVP)
│   └── types/                 # TypeScript type definitions
├── database/
│   └── schema.sql            # PostgreSQL database schema
├── public/                    # Static assets
└── package.json
```

## Color Scheme

| Element | Color | Hex |
|---------|-------|-----|
| Primary Background | Deep Black | #0a0a0f |
| Secondary Background | Navy Blue | #1A237E |
| Accent (CTA) | Bright Red | #D32F2F |
| Highlight (Success) | Gold | #FFC107 |
| Text | Light Gray | #ededed |

## API Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/api/auth/[...nextauth]` | * | Auth.js authentication |
| `/api/auth/signup` | POST | User registration |
| `/api/units` | GET, POST | Unit sections CRUD |
| `/api/units/[id]` | GET, PUT, DELETE | Single unit operations |
| `/api/users` | GET | List all users (Admin only) |
| `/api/users/[id]/roles` | POST | Assign roles to user |
| `/api/personnel` | GET, POST | Personnel CRUD |
| `/api/personnel/import` | POST | CSV import |
| `/api/duty-types` | GET, POST | Duty types CRUD |
| `/api/duty-types/[id]` | GET, PUT, DELETE | Single duty type operations |
| `/api/duty-slots` | GET, PATCH, DELETE | Duty slot management |
| `/api/scheduler` | POST | Generate/preview schedules |
| `/api/non-availability` | GET, POST | Non-availability requests |
| `/api/non-availability/[id]` | GET, PATCH, DELETE | Single request operations |
| `/api/export` | GET | Export roster to CSV |

## Duty Thruster Algorithm

The Duty Thruster is the core scheduling algorithm that ensures fair duty distribution:

1. **Fairness First** - Personnel with lowest duty scores are assigned first
2. **Smart Point System** - Weekends earn 1.5x points, holidays earn 2x points
3. **Qualification Aware** - Only qualified personnel are considered for each duty type
4. **Availability Checking** - Respects approved non-availability periods

## Completed Features

- [x] Personnel CSV/CAB import
- [x] Duty types configuration UI
- [x] Duty Thruster auto-scheduling algorithm
- [x] Calendar view for roster
- [x] Non-availability request workflow
- [x] PDF/Excel export

## Roadmap

- [ ] Hasura/Neon integration (production database)
- [ ] Real-time updates via GraphQL subscriptions
- [ ] Mobile-responsive optimizations
- [ ] Duty swap requests between personnel
- [ ] Email notifications for duty assignments

## Contributing

This is an MVP project. Please coordinate with the project maintainers before making changes.

## License

Proprietary - All rights reserved.
