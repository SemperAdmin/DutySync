# DutySync Data Flow Chart

This document maps how data is pushed and pulled throughout the application.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              DutySync Data Architecture                         │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  ┌─────────────┐    ┌──────────────────┐    ┌─────────────────────────────────┐│
│  │  UI Layer   │◄──►│  Client Stores   │◄──►│  JSON Seed Files (public/data/) ││
│  │  (React)    │    │  (localStorage)  │    │  + GitHub Actions (persistence) ││
│  └─────────────┘    └──────────────────┘    └─────────────────────────────────┘│
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Data Entities

| Entity | JSON Seed File | localStorage Key | UI Location |
|--------|---------------|------------------|-------------|
| **Unit Sections** | `public/data/unit/{ruc}/unit-structure.json` | `dutysync_units` | `/admin/units` |
| **Personnel** | `public/data/unit/{ruc}/unit-members.json` | `dutysync_personnel` | `/admin/personnel` |
| **Users** | `public/data/user/{id}.json` | Memory cache only | `/admin/users` |
| **Users Index** | `public/data/users-index.json` | - | - |
| **RUCs** | `public/data/rucs.json` | `dutysync_rucs` | Import modal |
| **Duty Types** | - (localStorage only) | `dutysync_duty_types` | `/admin/duty-types` |
| **Duty Slots** | - (localStorage only) | `dutysync_duty_slots` | `/admin/scheduler`, `/roster` |
| **Non-Availability** | - (localStorage only) | `dutysync_non_availability` | `/admin/non-availability` |
| **Qualifications** | - (localStorage only) | `dutysync_qualifications` | `/admin/personnel` |

---

## Flow Chart by Feature

### 1. User Account Creation

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                           USER ACCOUNT CREATION FLOW                             │
└──────────────────────────────────────────────────────────────────────────────────┘

     SIGNUP FORM                CLIENT AUTH               GITHUB API               JSON FILES
     (/signup)                  (client-auth.tsx)         (create-user.yml)        (public/data/)
          │                          │                          │                       │
          │  1. Submit form          │                          │                       │
          │  (edipi, email, pwd)     │                          │                       │
          ├─────────────────────────►│                          │                       │
          │                          │                          │                       │
          │                          │  2. Encrypt EDIPI        │                       │
          │                          │  Hash password (btoa)    │                       │
          │                          │                          │                       │
          │                          │  3. Trigger workflow     │                       │
          │                          ├─────────────────────────►│                       │
          │                          │                          │                       │
          │                          │                          │  4. Create user file  │
          │                          │                          ├──────────────────────►│
          │                          │                          │  user/{uuid}.json     │
          │                          │                          │                       │
          │                          │                          │  5. Update index      │
          │                          │                          ├──────────────────────►│
          │                          │                          │  users-index.json     │
          │                          │                          │                       │
          │                          │                          │  6. Git commit/push   │
          │                          │                          │  (triggers deploy)    │
          │                          │                          │                       │
          │  7. "Account created"    │                          │                       │
          │◄─────────────────────────┤                          │                       │
          │                          │                          │                       │

FILES MODIFIED:
  - public/data/user/{uuid}.json     (NEW - contains user data + roles)
  - public/data/users-index.json     (UPDATED - adds user to index)
```

---

### 2. User Login & Session

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                              USER LOGIN FLOW                                     │
└──────────────────────────────────────────────────────────────────────────────────┘

     LOGIN FORM               CLIENT AUTH               SEED DATA                 LOCALSTORAGE
     (/login)                 (client-auth.tsx)         (loadSeedUsers)           (dutysync_user)
          │                        │                         │                         │
          │  1. Submit login       │                         │                         │
          │  (edipi, password)     │                         │                         │
          ├───────────────────────►│                         │                         │
          │                        │                         │                         │
          │                        │  2. Load seed users     │                         │
          │                        │  (if not cached)        │                         │
          │                        ├────────────────────────►│                         │
          │                        │                         │                         │
          │                        │  3. Fetch user files    │                         │
          │                        │◄────────────────────────┤                         │
          │                        │  from public/data/user/ │                         │
          │                        │                         │                         │
          │                        │  4. Decrypt EDIPI       │                         │
          │                        │  Compare with input     │                         │
          │                        │                         │                         │
          │                        │  5. Verify password     │                         │
          │                        │  (btoa comparison)      │                         │
          │                        │                         │                         │
          │                        │  6. Build SessionUser   │                         │
          │                        │  - Load roles           │                         │
          │                        │  - Lookup personnel     │                         │
          │                        │  - Get unit info        │                         │
          │                        │                         │                         │
          │                        │  7. Store session       │                         │
          │                        ├────────────────────────────────────────────────────►
          │                        │                         │                         │
          │  8. Redirect to        │                         │                         │
          │  dashboard             │                         │                         │
          │◄───────────────────────┤                         │                         │

SESSION DATA STORED (localStorage "dutysync_user"):
  {
    id: "uuid",
    edipi: "1234567890",
    email: "user@example.com",
    personnel_id: "personnel-uuid" | null,
    roles: [{ role_name, scope_unit_id }],
    displayName: "SGT SMITH",
    rank, firstName, lastName, unitId, unitName
  }
```

---

### 3. Role Assignment (Push)

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                              ROLE ASSIGNMENT FLOW                                │
└──────────────────────────────────────────────────────────────────────────────────┘

     USERS PAGE              CLIENT STORES            GITHUB WORKFLOW            JSON FILE
     (/admin/users)          (client-stores.ts)       (update-user-roles.yml)   (public/data/)
          │                        │                         │                       │
          │  1. Click "Edit Roles" │                         │                       │
          │                        │                         │                       │
          │  2. Select role        │                         │                       │
          │  + unit scope          │                         │                       │
          │                        │                         │                       │
          │  3. Click "Assign"     │                         │                       │
          ├───────────────────────►│                         │                       │
          │                        │                         │                       │
          │                        │  4. Update memory cache │                       │
          │                        │  assignUserRole()       │                       │
          │                        │                         │                       │
          │                        │  5. Trigger workflow    │                       │
          │                        ├────────────────────────►│                       │
          │                        │  (roles_json, user_id)  │                       │
          │                        │                         │                       │
          │                        │                         │  6. Update user file  │
          │                        │                         ├──────────────────────►│
          │                        │                         │  user/{id}.json       │
          │                        │                         │                       │
          │                        │                         │  7. Git commit/push   │
          │                        │                         │  (triggers deploy)    │
          │                        │                         │                       │
          │  8. UI refreshes       │                         │                       │
          │◄───────────────────────┤                         │                       │

⚠️  IMPORTANT: Memory cache is updated immediately, but JSON file update
    happens asynchronously via GitHub Actions (may take 30-60 seconds)
```

---

### 4. Unit & Personnel Data (Push/Pull)

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                         UNIT & PERSONNEL DATA FLOW                               │
└──────────────────────────────────────────────────────────────────────────────────┘

                              INITIAL LOAD (PULL)

     APP INIT                SEED LOADER              JSON FILES               LOCALSTORAGE
     (layout.tsx)            (loadSeedDataIfNeeded)   (public/data/)
          │                        │                       │                       │
          │  1. App mounts         │                       │                       │
          ├───────────────────────►│                       │                       │
          │                        │                       │                       │
          │                        │  2. Check localStorage │                       │
          │                        │  for existing data    │                       │
          │                        ├──────────────────────────────────────────────►│
          │                        │                       │                       │
          │                        │  3. If empty, fetch   │                       │
          │                        │  units-index.json     │                       │
          │                        ├──────────────────────►│                       │
          │                        │                       │                       │
          │                        │  4. For each RUC,     │                       │
          │                        │  fetch unit data      │                       │
          │                        ├──────────────────────►│                       │
          │                        │  unit/{ruc}/unit-     │                       │
          │                        │  structure.json       │                       │
          │                        │  unit/{ruc}/unit-     │                       │
          │                        │  members.json         │                       │
          │                        │                       │                       │
          │                        │  5. Decrypt EDIPIs    │                       │
          │                        │  Process data         │                       │
          │                        │                       │                       │
          │                        │  6. Save to           │                       │
          │                        │  localStorage         │                       │
          │                        ├──────────────────────────────────────────────►│
          │                        │  dutysync_units       │                       │
          │                        │  dutysync_personnel   │                       │


                              IMPORT & PUSH

     PERSONNEL PAGE          CLIENT STORES            GITHUB API               JSON FILES
     (import modal)          (importManpowerData)     (github-api.ts)          (public/data/)
          │                        │                       │                       │
          │  1. Upload TSV/CSV     │                       │                       │
          │  (Morning Report)      │                       │                       │
          ├───────────────────────►│                       │                       │
          │                        │                       │                       │
          │                        │  2. Parse file        │                       │
          │                        │  parseManpowerTsv()   │                       │
          │                        │                       │                       │
          │                        │  3. Create units &    │                       │
          │                        │  personnel in         │                       │
          │                        │  localStorage         │                       │
          │                        │                       │                       │
          │                        │  4. (Optional) Push   │                       │
          │                        │  to GitHub            │                       │
          │                        ├──────────────────────►│                       │
          │                        │  pushSeedFilesToGitHub│                       │
          │                        │                       │                       │
          │                        │                       │  5. Update files      │
          │                        │                       ├──────────────────────►│
          │                        │                       │  unit-structure.json  │
          │                        │                       │  unit-members.json    │
          │                        │                       │                       │
          │  6. Show results       │                       │                       │
          │◄───────────────────────┤                       │                       │
```

---

### 5. Duty Types, Slots & Non-Availability (localStorage Only)

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                      DUTY DATA FLOW (LOCALSTORAGE ONLY)                          │
└──────────────────────────────────────────────────────────────────────────────────┘

⚠️  WARNING: These entities do NOT persist to JSON files or GitHub!
              Data exists ONLY in browser localStorage.

     UI PAGES                CLIENT STORES            LOCALSTORAGE
     (scheduler, duties)     (client-stores.ts)       (browser)
          │                        │                       │
          │  CREATE                │                       │
          │  createDutyType()      │                       │
          │  createDutySlot()      │                       │
          │  createNonAvailability()                       │
          ├───────────────────────►│                       │
          │                        ├──────────────────────►│
          │                        │  dutysync_duty_types  │
          │                        │  dutysync_duty_slots  │
          │                        │  dutysync_non_availability
          │                        │                       │
          │  READ                  │                       │
          │  getAllDutyTypes()     │                       │
          │  getAllDutySlots()     │                       │
          │  getAllNonAvailability()                       │
          │◄───────────────────────┤                       │
          │                        │◄──────────────────────┤
          │                        │                       │

LOCALSTORAGE KEYS:
  - dutysync_duty_types       → DutyType[]
  - dutysync_duty_values      → DutyValue[]
  - dutysync_duty_requirements → DutyRequirement[]
  - dutysync_duty_slots       → DutySlot[]
  - dutysync_non_availability → NonAvailability[]
  - dutysync_qualifications   → Qualification[]

❌ NO PERSISTENCE TO:
  - JSON seed files
  - GitHub repository
  - External database
```

---

## Identified Issues & Gaps

### Critical Breaks in Data Flow

| Issue | Location | Impact | Status |
|-------|----------|--------|--------|
| **Duty data not persisted** | `client-stores.ts` | Duty types, slots, schedules lost on localStorage clear | 🔴 BREAK |
| **Non-availability not persisted** | `client-stores.ts` | Leave requests lost on localStorage clear | 🔴 BREAK |
| **Qualifications not persisted** | `client-stores.ts` | Personnel certifications lost on localStorage clear | 🔴 BREAK |
| **Two auth systems** | `auth.ts` vs `client-auth.tsx` | Server auth unused, client auth works | 🟡 UNUSED CODE |
| **In-memory stores unused** | `stores.ts` | Map stores exist but not used by UI | 🟡 UNUSED CODE |
| **Role updates async** | `client-auth.tsx` | Memory updated immediately, GitHub async | 🟡 RACE CONDITION |

---

## File Reference

### Source Files (src/lib/)

| File | Purpose | Connected To |
|------|---------|--------------|
| `client-stores.ts` | Main data layer - localStorage CRUD | All UI pages |
| `client-auth.tsx` | Authentication context & login | Login/Signup, Session |
| `github-api.ts` | GitHub API for file updates | Personnel import, Role updates |
| `auth.ts` | NextAuth (server-side) | ❌ NOT USED |
| `stores.ts` | In-memory Map stores | ❌ NOT USED |

### JSON Seed Files (public/data/)

| File | Contents | Updated By |
|------|----------|------------|
| `units-index.json` | List of available RUCs | Manual |
| `users-index.json` | List of user accounts | `create-user.yml` workflow |
| `rucs.json` | RUC reference data | Manual |
| `unit/{ruc}/unit-structure.json` | Unit hierarchy | Import + `github-api.ts` |
| `unit/{ruc}/unit-members.json` | Personnel records | Import + `github-api.ts` |
| `user/{id}.json` | Individual user data + roles | GitHub workflows |

### GitHub Workflows (.github/workflows/)

| Workflow | Trigger | Action |
|----------|---------|--------|
| `create-user.yml` | `workflow_dispatch` | Creates new user JSON + updates index |
| `update-user-roles.yml` | `workflow_dispatch` | Updates user roles in JSON file |
| `delete-user.yml` | `workflow_dispatch` | Removes user JSON file |
| `deploy.yml` | Push to main | Deploys to GitHub Pages |

---

## Data Flow Summary

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         COMPLETE DATA FLOW MAP                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  PERSISTED DATA (survives browser clear + deploys):                         │
│  ═══════════════════════════════════════════════                           │
│                                                                             │
│  Users ─────────► GitHub Workflow ─────────► public/data/user/*.json       │
│  User Roles ────► GitHub Workflow ─────────► public/data/user/*.json       │
│  Unit Structure ► GitHub API ──────────────► public/data/unit/*/structure  │
│  Personnel ─────► GitHub API ──────────────► public/data/unit/*/members    │
│                                                                             │
│                                                                             │
│  SESSION DATA (survives page refresh, lost on logout/clear):                │
│  ════════════════════════════════════════════════════════════              │
│                                                                             │
│  Current User ──► localStorage ────────────► dutysync_user                 │
│  Units Cache ───► localStorage ────────────► dutysync_units                │
│  Personnel Cache► localStorage ────────────► dutysync_personnel            │
│                                                                             │
│                                                                             │
│  ⚠️  VOLATILE DATA (lost on localStorage clear):                           │
│  ════════════════════════════════════════════════                          │
│                                                                             │
│  Duty Types ────► localStorage ONLY ───────► dutysync_duty_types           │
│  Duty Values ───► localStorage ONLY ───────► dutysync_duty_values          │
│  Duty Slots ────► localStorage ONLY ───────► dutysync_duty_slots           │
│  Non-Availability localStorage ONLY ───────► dutysync_non_availability     │
│  Qualifications ► localStorage ONLY ───────► dutysync_qualifications       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Recommendations

### To Fix Data Persistence Gaps:

1. **Add GitHub workflows for duty data** - Create `update-duty-types.yml`, `update-duty-slots.yml` etc.

2. **Add JSON seed files for duties** - Create `public/data/unit/{ruc}/duties.json`

3. **Add export/push functions** - Similar to `pushSeedFilesToGitHub()` for duty data

4. **Consider background sync** - Periodically push localStorage to GitHub

### To Clean Up Unused Code:

1. **Remove `auth.ts`** - Server-side NextAuth not used
2. **Remove `stores.ts`** - In-memory stores not used
3. **Update comments** - Remove references to Hasura/Neon

---

*Last updated: Generated by data flow analysis*
