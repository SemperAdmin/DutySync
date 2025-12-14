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
| **Duty Types** | `public/data/unit/{ruc}/duty-types.json` | `dutysync_duty_types` | `/admin/duty-types` |
| **Duty Values** | `public/data/unit/{ruc}/duty-types.json` | `dutysync_duty_values` | `/admin/duty-types` |
| **Duty Requirements** | `public/data/unit/{ruc}/duty-types.json` | `dutysync_duty_requirements` | `/admin/duty-types` |
| **Duty Slots** | `public/data/unit/{ruc}/duty-roster.json` | `dutysync_duty_slots` | `/admin/scheduler`, `/roster` |
| **Non-Availability** | `public/data/unit/{ruc}/non-availability.json` | `dutysync_non_availability` | `/admin/non-availability` |
| **Qualifications** | `public/data/unit/{ruc}/qualifications.json` | `dutysync_qualifications` | `/admin/personnel` |

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

     UI PAGES                CLIENT STORES            LOCALSTORAGE          JSON SEED FILES
     (scheduler, duties)     (client-stores.ts)       (browser)             (public/data/unit/{ruc}/)
          │                        │                       │                       │
          │  INITIAL LOAD (PULL)   │                       │                       │
          │  loadSeedDataIfNeeded()│                       │                       │
          │◄───────────────────────┤◄──────────────────────┤◄──────────────────────┤
          │                        │  Loads from JSON →    │  duty-types.json      │
          │                        │  localStorage         │  duty-roster.json     │
          │                        │                       │  non-availability.json│
          │                        │                       │  qualifications.json  │
          │                        │                       │                       │
          │  CREATE/UPDATE         │                       │                       │
          │  createDutyType()      │                       │                       │
          │  createDutySlot()      │                       │                       │
          │  createNonAvailability()                       │                       │
          ├───────────────────────►│                       │                       │
          │                        ├──────────────────────►│                       │
          │                        │  dutysync_duty_types  │                       │
          │                        │  dutysync_duty_slots  │                       │
          │                        │  dutysync_non_availability                    │
          │                        │                       │                       │
          │  EXPORT/PUSH           │                       │                       │
          │  exportDutyTypes()     │                       │                       │
          │  pushUnitSeedFile()    ├──────────────────────────────────────────────►│
          │                        │                       │  Updates JSON files   │
          │                        │                       │                       │

LOCALSTORAGE KEYS:
  - dutysync_duty_types       → DutyType[]
  - dutysync_duty_values      → DutyValue[]
  - dutysync_duty_requirements → DutyRequirement[]
  - dutysync_duty_slots       → DutySlot[]
  - dutysync_non_availability → NonAvailability[]
  - dutysync_qualifications   → Qualification[]

✅ NOW CONNECTED TO:
  - JSON seed files (public/data/unit/{ruc}/*.json)
  - GitHub API for persistence (github-api.ts)
```

---

## Identified Issues & Gaps

### Data Flow Status

| Issue | Location | Impact | Status |
|-------|----------|--------|--------|
| **Duty data persistence** | `client-stores.ts` | Load from JSON on init, export to push | ✅ FIXED |
| **Non-availability persistence** | `client-stores.ts` | Load from JSON on init, export to push | ✅ FIXED |
| **Qualifications persistence** | `client-stores.ts` | Load from JSON on init, export to push | ✅ FIXED |
| **Two auth systems** | `auth.ts` vs `client-auth.tsx` | Server auth unused, client auth works | 🟡 UNUSED CODE |
| **In-memory stores unused** | `stores.ts` | Map stores exist but not used by UI | 🟡 UNUSED CODE |
| **Role updates async** | `client-auth.tsx` | Memory updated immediately, GitHub async | 🟡 RACE CONDITION |

### New Export Functions Added

| Function | File | Purpose |
|----------|------|---------|
| `exportDutyTypes(unitId?)` | `client-stores.ts` | Export duty types, values, requirements |
| `exportDutyRoster(unitId?)` | `client-stores.ts` | Export duty slots/schedule |
| `exportNonAvailability(unitId?)` | `client-stores.ts` | Export leave/TAD requests |
| `exportQualifications(unitId?)` | `client-stores.ts` | Export personnel certifications |
| `pushAllUnitSeedFiles(ruc, ...)` | `github-api.ts` | Push all unit data to GitHub |
| `pushUnitSeedFile(ruc, type, data)` | `github-api.ts` | Push single file to GitHub |

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
| `unit/{ruc}/duty-types.json` | Duty types, values, requirements | `pushUnitSeedFile()` |
| `unit/{ruc}/duty-roster.json` | Scheduled duty assignments | `pushUnitSeedFile()` |
| `unit/{ruc}/non-availability.json` | Leave/TAD requests | `pushUnitSeedFile()` |
| `unit/{ruc}/qualifications.json` | Personnel certifications | `pushUnitSeedFile()` |
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
│  Duty Types ────► GitHub API ──────────────► public/data/unit/*/duty-types │
│  Duty Roster ───► GitHub API ──────────────► public/data/unit/*/duty-roster│
│  Non-Availability GitHub API ──────────────► public/data/unit/*/non-avail  │
│  Qualifications ► GitHub API ──────────────► public/data/unit/*/quals      │
│                                                                             │
│                                                                             │
│  SESSION DATA (survives page refresh, loaded from JSON on init):            │
│  ══════════════════════════════════════════════════════════════            │
│                                                                             │
│  Current User ──► localStorage ────────────► dutysync_user                 │
│  All Data ──────► localStorage (cache) ────► dutysync_*                    │
│                                                                             │
│                                                                             │
│  AUTO-SAVE (enabled by default):                                           │
│  ═══════════════════════════════                                           │
│                                                                             │
│  CRUD operations → triggerAutoSave() → 5s debounce → GitHub push           │
│                                                                             │
│  Status indicator in header shows: idle/pending/saving/saved/error         │
│  Admins can toggle auto-save on/off and trigger manual saves               │
│                                                                             │
│  Files: src/lib/auto-save.ts, src/hooks/useAutoSave.ts,                    │
│         src/components/AutoSaveStatus.tsx                                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Remaining Recommendations

### To Clean Up Unused Code:

1. **Remove `auth.ts`** - Server-side NextAuth not used
2. **Remove `stores.ts`** - In-memory Map stores not used
3. **Update comments** - Remove references to Hasura/Neon

### Future Enhancements:

1. ~~**Add auto-save** - Periodically push localStorage changes to GitHub~~ ✅ DONE
2. **Add UI export button** - Let admins manually trigger exports
3. **Add import from JSON** - Let admins restore from seed files

---

*Last updated: 2024-12-14 - Added auto-save functionality*
