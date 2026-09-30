# Round 9 — Frontend / UI Layer: Architectural Blueprint

> [!IMPORTANT]
> This is a **design document only** — no implementation code, no task prompts.
> Every decision here must be resolved and signed off before implementation
> begins. Ambiguities flagged as ⚠️ TEAM DECISION require an explicit sign-off.

> [!NOTE]
> **SCOPE**: Auth/login screens (tenant + platform admin) and core entity CRUD
> screens. Billing/invoicing UI is a later, separate round — not scoped here.
> Platform admin management screens (tenant CRUD, admin CRUD) are included
> because the API surface already exists ([`/api/platform/tenants`](file:///home/nickson/Projects/MIS/app/api/platform/tenants/route.ts),
> [`/api/platform/admins`](file:///home/nickson/Projects/MIS/app/api/platform/admins/route.ts)).

---

## Table of Contents

1. [Q1 — Entity CRUD Rendering Model](#q1--entity-crud-rendering-model)
2. [Q2 — Login Screen Structure](#q2--login-screen-structure)
3. [Q3 — Workflow Shape for Round 9](#q3--workflow-shape-for-round-9)
4. [Q4 — State / Data-Fetching Approach](#q4--state--data-fetching-approach)
5. [Q5 — Component and Page Structure](#q5--component-and-page-structure)
6. [Permission Enforcement Strategy](#permission-enforcement-strategy)
7. [Middleware Implications](#middleware-implications)
8. [Scope Boundary — Explicitly Out of Round 9](#scope-boundary--explicitly-out-of-round-9)

---

## Q1 — Entity CRUD Rendering Model

### Problem

The MIS has two structurally distinct entity categories that need CRUD screens:

**Fixed hard-table entities** (known at build time):
- Users ([`lib/users/users.ts`](file:///home/nickson/Projects/MIS/lib/users/users.ts))
- Roles ([`lib/roles/roles.ts`](file:///home/nickson/Projects/MIS/lib/roles/roles.ts))
- Organizations (via [`lib/platform/tenants.ts`](file:///home/nickson/Projects/MIS/lib/platform/tenants.ts))
- Platform Admins (via [`lib/platform/platformAdmins.ts`](file:///home/nickson/Projects/MIS/lib/platform/platformAdmins.ts))

**Schema-registry entities** (defined at runtime per tenant):
- Entity Types → Field Definitions → Entity Records
- The schema is tenant-defined: a school's "Student" has different fields than a clinic's "Patient"
- Fields have types (`text`, `integer`, `decimal`, `boolean`, `date`, `datetime`, `enum`, `json`, `reference`, `file`), constraints, and display ordering ([`lib/entities/records.ts`](file:///home/nickson/Projects/MIS/lib/entities/records.ts#L67-L99))

The question: does the frontend need a genuine **dynamic form/table renderer** that reads `field_definitions` at runtime and builds UI accordingly, or can entity CRUD screens be hardcoded per-entity-type for a first pass?

### Options Evaluated

| Criterion | (A) Hardcoded per-entity-type | (B) Dynamic rendering from field_definitions |
|---|---|---|
| **Correctness** | ❌ **Impossible for schema-registry entities.** The field set is tenant-defined at runtime. There is no way to write a hardcoded "Patient" form — Tenant A's Patient has `blood_type`, Tenant B's doesn't. The hardcoded components would need to enumerate every possible entity type across every tenant, which is the entire point the schema registry was built to avoid. | ✅ Correct by construction. The form and table are built from the same `field_definitions` that the server validates against. |
| **Fixed hard-table entities** | ✅ Straightforward — Users, Roles, Org settings have known, stable column sets. Hardcoded forms with good UX. | ⚠️ Overkill — fixed entities don't go through the schema registry. Forcing them through a dynamic renderer adds indirection with no benefit. |
| **Development cost** | ⚠️ Low for fixed entities, but the "hardcoded" approach simply cannot work for custom entities, so it doesn't eliminate the dynamic renderer — it only defers it. | ⚠️ Higher upfront cost. Must handle all 10 `field_type` variants (text, integer, decimal, boolean, date, datetime, enum, json, reference, file), display ordering, required/optional states, constraints (min, max, pattern, enum_values). |
| **Schema version handling** | N/A for fixed entities. | ⚠️ Must handle records at mixed schema versions. A record at v1 may lack fields added in v2. The form must load field_definitions at the record's pinned `schema_version` for editing, and at `current_version` for creation. This mirrors what [`loadFieldDefinitions`](file:///home/nickson/Projects/MIS/lib/entities/records.ts#L156-L180) already does server-side. |
| **Maintenance** | ❌ Every entity type a tenant creates requires zero frontend changes — if and only if the dynamic renderer exists. Without it, new entity types are API-only with no UI. | ✅ Zero per-entity-type maintenance. New entity types get forms and tables automatically. |

### ⚠️ TEAM DECISION #1 — Entity CRUD Rendering Model

**The analysis eliminates the "pure hardcoded" option** — schema-registry entities are tenant-defined at runtime; there is no entity type to hardcode against. The decision is:

| Approach | What it means | Trade-off |
|---|---|---|
| **(A) Two-track: hardcoded for fixed entities, dynamic for schema-registry entities** | Build explicit `UserForm`, `RoleForm`, etc. for fixed entities. Build a `DynamicEntityForm` / `DynamicEntityTable` pair that reads field_definitions. | Clean UX for fixed entities (custom layouts, inline help), higher code volume but each piece is simple. Dynamic renderer is still required but only serves schema-registry entities. |
| **(B) Unified dynamic renderer for everything** | All CRUD goes through the dynamic renderer, including users and roles. | Less code, but fixed entities lose custom layout control. User management (with its role assignment, active/inactive toggle, password reset) doesn't fit neatly into a generic field-based form. |

**Recommendation: (A) Two-track.** Fixed entities have domain-specific UX needs (role assignment on users, permission composition on roles, org_type selection on organizations) that don't map to generic form fields. The dynamic renderer serves entity types + entity records exclusively.

**Dynamic renderer scope for Round 9:**

Build form field components for these field types in priority order:

| Priority | field_type | Form widget | Notes |
|---|---|---|---|
| P0 | `text` | `<input type="text">` | With min/max length, pattern constraint |
| P0 | `integer` | `<input type="number" step="1">` | With min/max |
| P0 | `decimal` | `<input type="number">` | With min/max |
| P0 | `boolean` | `<input type="checkbox">` or toggle | |
| P0 | `enum` | `<select>` | Options from `constraints.enum_values` |
| P0 | `date` | `<input type="date">` | |
| P0 | `datetime` | `<input type="datetime-local">` | |
| P1 | `reference` | `<select>` with record search | Requires fetching records of the referenced entity type |
| P1 | `json` | `<textarea>` with JSON validation | |
| P2 | `file` | File upload widget | Requires file storage — **stub only in Round 9** |

---

## Q2 — Login Screen Structure

### Existing implementation

Two structurally separate login API routes already exist:
- **Tenant login**: Not yet implemented as an API route (no `app/api/auth/login/route.ts` found — [`middleware.ts`](file:///home/nickson/Projects/MIS/middleware.ts#L43) lists `/api/auth` as public but no route exists yet). The `createSession()` function in [`session.ts`](file:///home/nickson/Projects/MIS/lib/auth/session.ts#L116-L130) produces tenant JWTs.
- **Platform admin login**: [`app/api/platform/login/route.ts`](file:///home/nickson/Projects/MIS/app/api/platform/login/route.ts) — uses `_adminPoolInternal` to query `platform_admins`, calls `createPlatformAdminSession()`.

The two session types are structurally incompatible:
- `SessionPayload` carries `{ userId, tenantId, sessionKind?: 'tenant' }` — tenant-scoped.
- `PlatformAdminSessionPayload` carries `{ platformAdminId, sessionKind: 'platform_admin' }` — no tenantId.

Both share the same `mis_session` cookie name and the same `SESSION_SECRET` for signing.

### Options Evaluated

| Criterion | (A) Single login page with mode toggle | (B) Two fully separate login pages |
|---|---|---|
| **Session safety** | ❌ **Risk.** A single login page must branch on whether to call `/api/auth/login` or `/api/platform/login`. If the wrong branch fires (e.g., a platform admin accidentally submits to the tenant endpoint), the error is confusing. More critically, the form must somehow know whether to collect a `tenantId` (or org slug) — tenant login requires identifying which organization the user belongs to; platform admin login does not. | ✅ **Clean.** Each page knows exactly which API endpoint to call and what fields to collect. No branching, no risk of session model confusion. |
| **URL structure** | `/login` with a tab/toggle | `/login` (tenant), `/platform/login` (platform admin) |
| **Middleware compatibility** | ⚠️ Middleware already lists both `/login` and `/platform/login` as public prefixes. A single `/login` page would work, but the `/platform/login` prefix is already in [`PUBLIC_ROUTE_PREFIXES`](file:///home/nickson/Projects/MIS/middleware.ts#L44) — removing it would be a breaking change. | ✅ Matches the existing middleware configuration exactly. Both prefixes are already public. |
| **Tenant identification** | ❌ A single page must ask "which organization?" before showing the password form. This adds a step (org slug input or dropdown) that platform admins don't need. | ✅ Tenant login page can prompt for org slug + email + password. Platform admin page prompts for email + password only. |
| **Layout reuse** | ✅ Shared card/branding component, only the form fields differ. | ✅ Same — shared layout component, different form content. Can still share a `LoginCard` component. |
| **Discoverability** | ⚠️ Platform admins might navigate to `/login` and be confused by tenant-oriented language. | ✅ `/platform/login` is a deliberate, typed URL that platform admins bookmark. Tenant users never see it. |

### ⚠️ TEAM DECISION #2 — Login Screen Structure

**Recommendation: (B) Two fully separate login pages at `/login` and `/platform/login`**, sharing a `LoginCard` layout component.

The two session types are structurally incompatible by design (Round 6 blueprint, locked decision). The UI should mirror this structural separation rather than paper over it with a toggle.

**Tenant login additional question**: The tenant login flow requires identifying which organization the user belongs to. Two sub-options:

| Sub-option | Mechanism | Trade-off |
|---|---|---|
| **(B1) Slug-in-URL** | `/login/[orgSlug]` — e.g., `/login/acme-school` | Clean per-tenant branding. Tenants share login links. Requires a slug resolution step before auth. |
| **(B2) Email-only** | `/login` — user enters email, server resolves tenant from `users.email` + `users.tenant_id` | Simpler URL, but email is not globally unique across tenants (two tenants can have the same email). The `UNIQUE (tenant_id, email)` constraint means email alone is ambiguous. |
| **(B3) Org slug field + email** | `/login` — form has org slug, email, and password fields | No ambiguity. Slightly more friction (3 fields). |

**Recommendation: (B3) Org slug field + email + password** on a single `/login` page. This avoids the ambiguity problem in B2 and the URL complexity of B1. The org slug can auto-fill from a query parameter (`/login?org=acme-school`) for shared links.

> [!IMPORTANT]
> **Round 9 must also create the tenant login API route** (`app/api/auth/login/route.ts`).
> The middleware already lists `/api/auth` as a public prefix, but the route
> does not exist yet. It should mirror the platform login route's pattern:
> resolve org by slug → find user by `(tenant_id, email)` → verify password →
> `createSession()` → `setSessionCookie()`.

---

## Q3 — Workflow Shape for Round 9

### Context

Rounds 1–8 used: **Opus blueprint → Sonnet/Gemini implementation → cross-model review**. This works well for backend code where correctness is binary (SQL executes or it doesn't, types compile or they don't) and where mistakes are expensive to detect (a subtle RLS policy bug is invisible without integration tests).

UI work has different error economics:

| Error type | Backend (Rounds 1–8) | Frontend (Round 9) |
|---|---|---|
| **Logic errors** | Expensive — silent data corruption, security holes | Moderate — visible to the user, caught by manual testing |
| **Layout/visual errors** | N/A | Cheap to detect (look at the screen), cheap to fix (adjust CSS) |
| **Integration errors** | Expensive — wrong SQL, missing RLS, broken FK | Moderate — wrong API call shape, missing error handling |
| **Architecture errors** | Very expensive — wrong abstraction, missed constraint | Moderate — wrong component boundary, fixable by refactoring |

### Options Evaluated

| Criterion | (A) Same Opus-blueprint → implementation → review | (B) Blueprint → iterative implementation with visual feedback | (C) Skip blueprint, go straight to implementation |
|---|---|---|---|
| **Architectural soundness** | ✅ Blueprint catches structural mistakes (component boundaries, data flow, session handling) before any code is written. | ✅ Blueprint still exists — the first pass is design-reviewed. Iteration happens within the approved architecture. | ❌ No guardrails. Risk of building the wrong abstractions and discovering it late. |
| **Visual quality** | ❌ A cross-model review cannot evaluate visual quality — it can only review code structure. The first time anyone sees the UI is after the full implementation pass. If the layout is wrong, the entire pass may need rework. | ✅ Visual feedback after each component/page. Catches layout and UX issues early, when they're cheap to fix. | ✅ Same. |
| **Round-trip cost** | ❌ Three full model passes (blueprint, implementation, review) before any visual output. For UI work, this is slow feedback. | ⚠️ Two passes minimum (blueprint, implementation), with iteration replacing the formal review. | ✅ Fastest to first output. |
| **Structural risk** | ✅ Lowest — blueprint locks architecture before code. | ✅ Same structural safety as (A), with cheaper visual iteration. | ❌ Highest structural risk. |

### ⚠️ TEAM DECISION #3 — Workflow Shape for Round 9

**Recommendation: (B) Blueprint (this document) → iterative implementation with visual feedback.**

Specifically:
1. This blueprint is reviewed and approved (we are here now).
2. Implementation proceeds component-by-component, with browser screenshots after each major page.
3. The cross-model formal review is replaced by visual QA + TypeScript compilation check + testing against the live API.

**Why not (A):** The cross-model code review step in Rounds 1–8 caught SQL bugs, RLS gaps, and type errors. In a UI round, the equivalent bugs are visual (wrong layout, broken interaction, missing loading state) and are better caught by looking at the running application than by reading JSX.

**Why not (C):** This blueprint is still necessary. The session handling, permission enforcement, and data-fetching architecture have structural consequences that are expensive to discover during implementation.

---

## Q4 — State / Data-Fetching Approach

### Existing patterns

The codebase is Next.js 16 (App Router). All existing code is API Route Handlers — no pages, no Server Components, no Server Actions exist yet. The project uses:
- `pg` (Node.js only — cannot run in Edge/Client)
- `jose` (Edge-compatible, used in middleware)
- No client-side state management library (no React Query, no SWR, no Zustand)
- No form library (no React Hook Form, no Formik)

### Options Evaluated

| Criterion | (A) Server Components + Server Actions | (B) Client-side fetching against Route Handlers | (C) Hybrid |
|---|---|---|---|
| **Session access** | ✅ Server Components can call `cookies()` to read the JWT and verify it server-side. Data fetching happens before render — no loading spinner for initial data. | ⚠️ Every page is a client component. Session verification requires calling an API endpoint from the client, adding a round-trip. Or: read the cookie client-side — but it's `httpOnly`, so this is impossible. | ✅ Server Components for initial data load (session + first paint). Client components for mutations and interactive updates. |
| **Data freshness** | ✅ Every navigation fetches fresh data (Server Components re-render on navigation). | ⚠️ Requires manual `fetch` + state management. Stale data until re-fetched. | ✅ Fresh on navigation (Server Component), optimistic updates for mutations (Client Component). |
| **Permission checks** | ✅ Server Components can call `getEffectivePermissions()` directly — no need to expose a "get my permissions" API endpoint. The permission set shapes what the component renders (hide buttons the user can't use). | ❌ Must expose a `/api/me/permissions` endpoint. Client fetches permissions, stores them, and conditionally renders UI. Duplicates permission logic in the client — violates the constraint "the UI layer must not duplicate or shadow server-side permission logic." | ✅ Permissions resolved server-side in the Server Component. Passed to client components as props. Client components use them for conditional rendering only (show/hide), never for authorization decisions. |
| **Form mutations** | ⚠️ Server Actions handle form submission but have limited support for optimistic UI, progress indicators, and client-side validation before submit. | ✅ Client-side `fetch()` to existing Route Handlers. Full control over loading states, error handling, optimistic updates. | ✅ Server Actions for simple mutations (delete, status toggle). Client-side `fetch()` for complex forms (entity record create/edit with live validation). |
| **Existing Route Handlers** | ⚠️ Server Actions would bypass the existing Route Handlers entirely — they call `lib/` functions directly. The 30 existing Route Handlers become unused dead code for UI-driven operations. | ✅ Reuses every existing Route Handler. No dead code. | ✅ Route Handlers remain the API surface. Server Components call `lib/` functions directly for read operations (same as Route Handlers do internally). |
| **Bundle size** | ✅ Server Components ship zero JavaScript to the client. | ❌ All rendering logic ships to the client. | ⚠️ Mixed — only interactive components ship JS. |

### ⚠️ TEAM DECISION #4 — State / Data-Fetching Approach

**Recommendation: (C) Hybrid — Server Components for data loading + permission resolution, Client Components for interactive UI.**

The pattern:

```
┌─────────────────────────────────────────────────────────────┐
│  Server Component (page.tsx)                                │
│  ├── cookies() → verifySession() → session                  │
│  ├── getEffectivePermissions(session) → permissions          │
│  ├── lib/ calls for initial data (list, get)                │
│  └── Renders <ClientComponent data={...} permissions={...}> │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Client Component ('use client')                            │
│  ├── Receives data + permissions as props (initial state)   │
│  ├── Handles user interaction (form input, modal open)      │
│  ├── Mutations via fetch() to /api/... Route Handlers       │
│  └── Uses router.refresh() to re-trigger Server Component   │
│      after successful mutation                              │
└─────────────────────────────────────────────────────────────┘
```

**Key rules:**
1. **Permissions are resolved once in the Server Component** and passed down as a serializable object (`{ canCreate: boolean, canUpdate: boolean, ... }`), not the full `EffectivePermissions` Set/Map (which is not serializable).
2. **Client components never import from `lib/auth/permissions.ts`** — they receive permission booleans as props.
3. **Mutations go through existing Route Handlers** via `fetch()` — this keeps the API surface as the single source of truth for authorization and validation.
4. **`router.refresh()`** after mutations triggers the Server Component to re-render with fresh data — no client-side cache to manage.

> [!IMPORTANT]
> **No new client-side libraries** for Round 9 (no React Query, no SWR,
> no Zustand, no React Hook Form). The hybrid Server Component + `fetch()`
> pattern handles all data needs with the built-in `useState`/`useTransition`
> hooks. This keeps the dependency surface minimal. If the team finds
> this insufficient during implementation, a library can be added — but
> the default is to start without one.

---

## Q5 — Component and Page Structure

### ⚠️ TEAM DECISION #5 — Directory Layout

**Proposed layout** under `app/`, consistent with the existing `app/api/` structure:

```
app/
├── (auth)/                          # Route group — shared auth layout (no /auth in URL)
│   ├── layout.tsx                   # Centered card layout, branding
│   ├── login/
│   │   └── page.tsx                 # Tenant login (org slug + email + password)
│   └── platform/
│       └── login/
│           └── page.tsx             # Platform admin login (email + password)
│
├── (tenant)/                        # Route group — tenant-authenticated shell
│   ├── layout.tsx                   # Sidebar nav + top bar + session guard
│   ├── dashboard/
│   │   └── page.tsx                 # Tenant dashboard (landing after login)
│   ├── users/
│   │   └── page.tsx                 # User list + invite
│   ├── roles/
│   │   └── page.tsx                 # Role list + create + permission assignment
│   ├── entities/
│   │   ├── page.tsx                 # Entity type list
│   │   └── [entityTypeSlug]/
│   │       ├── page.tsx             # Entity records list for this type
│   │       └── [recordId]/
│   │           └── page.tsx         # Single entity record detail/edit
│   └── settings/
│       └── page.tsx                 # Organization settings (name, metadata)
│
├── (platform)/                      # Route group — platform admin shell
│   ├── layout.tsx                   # Platform admin nav + session guard
│   ├── platform/
│   │   ├── dashboard/
│   │   │   └── page.tsx             # Platform dashboard
│   │   ├── tenants/
│   │   │   └── page.tsx             # Tenant list + create
│   │   └── admins/
│   │       └── page.tsx             # Platform admin list + create
│
├── api/                             # [EXISTING — untouched]
│   ├── auth/
│   │   └── login/
│   │       └── route.ts             # [NEW] Tenant login API
│   ├── platform/                    # [EXISTING]
│   ├── users/                       # [EXISTING]
│   ├── roles/                       # [EXISTING]
│   └── ...
│
├── layout.tsx                       # [EXISTING] Root layout (fonts, global CSS)
├── page.tsx                         # [MODIFY] Redirect to /login or /dashboard
└── globals.css                      # [MODIFY] Design system tokens
```

**Route group rationale:**
- `(auth)` — Login pages share a centered-card layout. No sidebar, no nav.
- `(tenant)` — All tenant-authenticated pages share a sidebar layout with navigation.
- `(platform)` — Platform admin pages share a separate nav layout (different sidebar items, different branding cue).
- Route groups use parentheses `()` — they don't affect the URL path.

### Component boundaries

```
components/
├── ui/                              # Generic, reusable UI primitives
│   ├── Button.tsx
│   ├── Input.tsx
│   ├── Select.tsx
│   ├── Checkbox.tsx
│   ├── Modal.tsx
│   ├── Table.tsx                    # Generic table shell (header, rows, pagination)
│   ├── Card.tsx
│   ├── Badge.tsx
│   ├── Toast.tsx
│   ├── LoadingSpinner.tsx
│   └── EmptyState.tsx
│
├── auth/
│   ├── LoginCard.tsx                # Shared layout wrapper for both login pages
│   ├── TenantLoginForm.tsx          # Client component: org slug + email + password
│   └── PlatformLoginForm.tsx        # Client component: email + password
│
├── entities/
│   ├── EntityTypeList.tsx           # Client component: list entity types, create new
│   ├── EntityRecordTable.tsx        # Client component: renders records for a type
│   │                                #   Columns derived from field_definitions
│   ├── EntityRecordForm.tsx         # Client component: create/edit form
│   │                                #   Fields derived from field_definitions
│   └── fields/                      # Field-type-specific form widgets
│       ├── TextField.tsx
│       ├── NumberField.tsx
│       ├── BooleanField.tsx
│       ├── EnumField.tsx
│       ├── DateField.tsx
│       ├── DateTimeField.tsx
│       ├── ReferenceField.tsx
│       ├── JsonField.tsx
│       └── FileField.tsx            # Stub for Round 9
│
├── users/
│   ├── UserTable.tsx                # Client component: user list with actions
│   └── UserInviteForm.tsx           # Client component: invite user form
│
├── roles/
│   ├── RoleTable.tsx                # Client component: role list
│   ├── RoleForm.tsx                 # Client component: create/edit role
│   └── PermissionAssignment.tsx     # Client component: assign permissions to role
│
├── platform/
│   ├── TenantTable.tsx              # Client component: list tenants
│   ├── TenantCreateForm.tsx         # Client component: create tenant
│   ├── AdminTable.tsx               # Client component: list platform admins
│   └── AdminCreateForm.tsx          # Client component: create platform admin
│
└── layout/
    ├── TenantSidebar.tsx            # Sidebar nav for tenant pages
    ├── PlatformSidebar.tsx          # Sidebar nav for platform admin pages
    ├── TopBar.tsx                   # Top bar with user menu, logout
    └── SessionGuard.tsx             # Server component: verifies session, redirects
```

### Data flow for an entity record list page

```
app/(tenant)/entities/[entityTypeSlug]/page.tsx (Server Component)
  │
  ├── 1. cookies() → verifySession() → SessionPayload
  ├── 2. Resolve entityTypeSlug → entityTypeId via DB query
  ├── 3. getEffectivePermissions(session.tenantId, session.userId)
  ├── 4. canOnEntityType(perms, entityTypeId, 'read') → 403 if denied
  ├── 5. Load field_definitions for this entity type (current_version)
  ├── 6. Load entity records (paginated)
  ├── 7. Compute permission booleans:
  │      { canCreate, canUpdate, canDelete } from canOnEntityType()
  │
  └── 8. Render:
         <EntityRecordTable
           records={records}
           fieldDefinitions={fieldDefs}
           permissions={{ canCreate, canUpdate, canDelete }}
           entityTypeId={entityTypeId}
           entityTypeSlug={slug}
         />
```

### Data flow for entity record create/edit

```
components/entities/EntityRecordForm.tsx ('use client')
  │
  ├── Props: fieldDefinitions[], existingRecord?, entityTypeId, entityTypeSlug
  │
  ├── 1. Build form state from fieldDefinitions:
  │      - One state entry per active field_definition
  │      - Default values from field_definitions.default_value
  │      - For edit: pre-fill from existingRecord.data
  │
  ├── 2. Client-side validation (mirrors server validateData logic):
  │      - Required field presence
  │      - Type checks (integer is integer, date is valid ISO)
  │      - Constraints (min, max, pattern, enum_values)
  │      ⚠ This is NOT authorization — it's input validation UX.
  │         The server re-validates everything.
  │
  ├── 3. Submit via fetch():
  │      - POST /api/entities/{entityTypeSlug}/records       (create)
  │      - PUT  /api/entities/{entityTypeSlug}/records/{id}  (update)
  │      ⚠ These Route Handlers don't exist yet — see §New Route Handlers below.
  │
  └── 4. On success: router.refresh() to re-render the Server Component
```

> [!WARNING]
> **Entity record API routes don't exist yet.** The current API surface has
> routes for users, roles, reports, billing, and platform admin — but no
> routes for entity type management or entity record CRUD. Round 9 must
> create these:
>
> | Route | Method | Purpose |
> |---|---|---|
> | `/api/entities` | GET, POST | List/create entity types |
> | `/api/entities/[slug]` | GET, PUT, DELETE | Get/update/delete entity type |
> | `/api/entities/[slug]/fields` | GET, POST | List/create field definitions |
> | `/api/entities/[slug]/records` | GET, POST | List/create entity records |
> | `/api/entities/[slug]/records/[id]` | GET, PUT, DELETE | Get/update/delete record |
> | `/api/auth/login` | POST | Tenant login (new) |

---

## Permission Enforcement Strategy

> [!IMPORTANT]
> **Load-bearing constraint**: Permission checks (`getEffectivePermissions`,
> `can`, `canOnEntityType`) currently live server-side only — the UI layer
> must not duplicate or shadow this logic.

### How permissions flow to the UI

```
Server Component (page.tsx)
  │
  ├── const session = await verifySession(...)
  ├── const perms = await getEffectivePermissions(session.tenantId, session.userId)
  │
  ├── // Authorization gate: if user can't read this page's data, redirect/403
  │   if (!canOnEntityType(perms, entityTypeId, 'read')) {
  │     redirect('/dashboard');  // or render a 403 component
  │   }
  │
  ├── // Compute UI-level permission flags (booleans, serializable)
  │   const uiPerms = {
  │     canCreate: canOnEntityType(perms, entityTypeId, 'create'),
  │     canUpdate: canOnEntityType(perms, entityTypeId, 'update'),
  │     canDelete: canOnEntityType(perms, entityTypeId, 'delete'),
  │   };
  │
  └── return <EntityRecordTable permissions={uiPerms} ... />
```

```
Client Component (EntityRecordTable.tsx)
  │
  ├── // Use permission booleans for CONDITIONAL RENDERING only:
  │   {permissions.canCreate && <Button>New Record</Button>}
  │   {permissions.canDelete && <Button variant="danger">Delete</Button>}
  │
  └── // The client NEVER makes an authorization decision.
      // If a hidden button is somehow triggered, the Route Handler
      // rejects the request with 403 — the server is the authority.
```

### What the client MUST NOT do

- ❌ Import `getEffectivePermissions`, `can`, `canOnEntityType`
- ❌ Store permissions in client state and re-check them
- ❌ Make authorization decisions based on client-side data
- ❌ Gate API calls client-side based on permissions (the server does this)

### What the client MAY do

- ✅ Hide/show UI elements based on permission booleans from props
- ✅ Display "you don't have permission" messages based on 403 responses from the API
- ✅ Perform input validation (field type, required, constraints) — this is UX, not authorization

---

## Middleware Implications

[`middleware.ts`](file:///home/nickson/Projects/MIS/middleware.ts) currently:
1. Checks if the route is in `PUBLIC_ROUTE_PREFIXES` → pass through.
2. Verifies the JWT via `getSessionFromRequest()` (which calls `verifySession()`).
3. Redirects to `/login` if no valid session.

**Changes needed for Round 9:**

### 1. Session kind routing

The middleware currently calls `getSessionFromRequest()` which returns a `SessionPayload` (tenant session) or null. It does **not** call `verifyAnySession()`. This means:

- A platform admin with a valid JWT will pass the middleware check (the JWT is signed with the same secret), but `getSessionFromRequest()` will return null because the payload lacks `userId`/`tenantId`.
- The platform admin gets redirected to `/login` when trying to access `/platform/dashboard`.

**Fix**: Middleware should call `verifyAnySession()` instead of `getSessionFromRequest()` and:
- If `kind === 'tenant'` and route starts with `/platform/` → redirect to `/dashboard` (wrong session type for this area)
- If `kind === 'platform_admin'` and route does NOT start with `/platform/` → redirect to `/platform/dashboard`
- If `null` → redirect to `/login` (or `/platform/login` if route starts with `/platform/`)

> [!WARNING]
> This is a **behavioral change** to middleware.ts. `getSessionFromRequest()`
> returns `SessionPayload | null`; the new flow returns `AnySessionPayload | null`.
> The middleware does not query the DB (Edge runtime constraint) — it only
> reads the JWT claims to determine session kind.

### 2. Public route additions

No new public route prefixes needed. The existing list covers:
- `/login` — tenant login page ✅
- `/platform/login` — platform admin login page ✅
- `/api/auth` — tenant login API ✅ (once created)
- `/api/platform/login` — platform admin login API ✅

---

## Scope Boundary — Explicitly Out of Round 9

| Feature | Reason for deferral |
|---|---|
| **Billing/invoicing UI** | Separate round — explicitly excluded per the user's scoping instruction. |
| **Report builder/viewer UI** | Reports have their own visual complexity (charts, data tables, export). Separate round after CRUD screens are stable. |
| **Event subscription management UI** | Config screens for workflow hooks can come after entity CRUD is in place. |
| **File upload for `file` field_type** | Requires a file storage backend (S3/GCS/Vercel Blob). The `FileField` component is a stub that displays "File upload not yet available." |
| **SSO/OAuth login** | `password_hash` is nullable (SSO-only users exist in the schema), but no OAuth provider is configured. Password login only for Round 9. |
| **Tenant branding/theming** | Per-tenant logo, colors, etc. are not part of the first UI pass. |
| **Responsive/mobile layout** | Desktop-first for Round 9. Responsive refinement is a polish pass. |
| **Dark mode** | Design system tokens should support it (CSS custom properties), but implementation is deferred. |
| **i18n / localization** | English only for Round 9. |
| **Entity type schema management UI** | Creating/editing entity types and field_definitions via the UI. This is important but complex (drag-and-drop field ordering, field type selection, constraint configuration). Can be API-only for Round 9 and get a UI in a later round. |

> [!IMPORTANT]
> **Entity type schema management UI** (creating entity types, adding fields)
> is listed as out-of-scope above. This means Round 9 users can **view and
> operate on** entity records for types that already exist (created via API),
> but cannot create new entity types or modify schemas through the UI. Flag
> for TEAM DECISION if this is unacceptable.

---

## Verification Plan

### Automated
- `npx tsc --noEmit` — TypeScript compilation with zero errors.
- `npx next build` — Production build succeeds.
- `npx eslint app/ components/` — Zero lint errors.

### Manual
1. **Tenant login flow**: Navigate to `/login`, enter org slug + email + password, verify redirect to `/dashboard`.
2. **Platform admin login flow**: Navigate to `/platform/login`, enter email + password, verify redirect to `/platform/dashboard`.
3. **Session isolation**: Login as tenant user, navigate to `/platform/dashboard` → verify redirect to `/dashboard`. Login as platform admin, navigate to `/dashboard` → verify redirect to `/platform/dashboard`.
4. **Entity record CRUD**: Navigate to entity type list → select a type → view records → create a record (all field types) → edit → delete. Verify validation errors display correctly.
5. **Permission enforcement**: Login as a user WITHOUT entity `create` permission → verify "New Record" button is hidden. Attempt a direct `POST` to the API → verify 403 response.
6. **User/Role management**: List users, invite a user, toggle active/inactive. List roles, create a role, assign permissions.

---

*End of Round 9 Frontend/UI Layer Blueprint.*
