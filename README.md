# Duty Sync

A scalable, automated, and fair digital system for military duty roster management.

## Overview

Duty Sync replaces manual duty roster processes with intelligent scheduling, ensuring fair distribution of duties across personnel while respecting qualifications, availability, and rank requirements.

## Features (MVP)

- **Dark Mode First UI** - Professional military theme with Navy Blue/Black color scheme
- **Role-Based Access Control** - App Admin, Unit Admin, and Standard User roles
- **Unit Hierarchy Management** - Battalion → Company → Platoon → Section structure
- **Secure Authentication** - Auth.js with JWT-based session management
- **Duty Thruster Algorithm** - Automated fair scheduling based on duty scores (coming soon)

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
│   │   └── api/               # API routes
│   ├── components/            # React components
│   │   ├── ui/               # Reusable UI components
│   │   └── layout/           # Layout components
│   ├── lib/                   # Utility functions and configurations
│   │   ├── auth.ts           # Auth.js configuration
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

## Roadmap

- [ ] Personnel CSV import
- [ ] Duty types configuration UI
- [ ] Duty Thruster auto-scheduling algorithm
- [ ] Calendar view for roster
- [ ] Non-availability request workflow
- [ ] PDF/Excel export
- [ ] Hasura/Neon integration
- [ ] Real-time updates via GraphQL subscriptions

## Contributing

This is an MVP project. Please coordinate with the project maintainers before making changes.

## License

Proprietary - All rights reserved.
